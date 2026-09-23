import { normalizeProjectPath } from "./ownership.js";
import { compareSemVer, isValidSemVer } from "./semver.js";
import { sha256 } from "./template.js";
import type {
  UpdateDatabaseMigration,
  UpdateDependencyChange,
  UpdateGeneratedFileChange,
  UpdateManifestMigration,
  UpdateOwnershipConflict,
  UpdatePlan,
  UpdatePlanInput,
  UpdatePlanPreconditions,
  UpdateRequirement,
  UpdateVerificationCommand,
  VersionModuleCompatibility
} from "./types.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;

export class UpdatePlanError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "UpdatePlanError";
    this.code = code;
  }
}

function identity(payload: Omit<UpdatePlan, "planId" | "digest">): Pick<UpdatePlan, "planId" | "digest"> {
  const digest = sha256(JSON.stringify(payload));
  return { planId: `update-${digest.slice("sha256:".length, "sha256:".length + 16)}`, digest };
}

function assertDigest(value: string | undefined, label: string, required = true): void {
  if ((required && value === undefined) || (value !== undefined && !DIGEST.test(value))) {
    throw new UpdatePlanError(`${label} must be a SHA-256 digest`, "update.invalidDigest");
  }
}

function assertUnique<T>(values: readonly T[], key: (value: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const identity = key(value);
    if (!identity || seen.has(identity)) {
      throw new UpdatePlanError(`${label} contains a missing or duplicate identity '${identity}'`, "update.duplicatePlanEntry");
    }
    seen.add(identity);
  }
}

function safePath(value: string): string {
  let normalized: string;
  try {
    normalized = normalizeProjectPath(value);
  } catch {
    throw new UpdatePlanError(`Update path is not canonical: ${value}`, "update.unsafePath");
  }
  if (normalized !== value || normalized === "." || normalized.startsWith("../")) {
    throw new UpdatePlanError(`Update path is not canonical: ${value}`, "update.unsafePath");
  }
  return normalized;
}

function normalizeDependencies(input: readonly UpdateDependencyChange[]): UpdateDependencyChange[] {
  assertUnique(input, ({ name }) => name, "Dependency changes");
  return input.map((change) => {
    if (!change.name.trim()) throw new UpdatePlanError("Dependency name cannot be empty", "update.invalidDependencyChange");
    if (change.kind === "add" && (change.fromVersion !== undefined || !change.toVersion)) {
      throw new UpdatePlanError(`Added dependency '${change.name}' must have only a target version`, "update.invalidDependencyChange");
    }
    if (change.kind === "remove" && (!change.fromVersion || change.toVersion !== undefined)) {
      throw new UpdatePlanError(`Removed dependency '${change.name}' must have only a current version`, "update.invalidDependencyChange");
    }
    if (change.kind === "update" && (!change.fromVersion || !change.toVersion || change.fromVersion === change.toVersion)) {
      throw new UpdatePlanError(`Updated dependency '${change.name}' must have distinct current and target versions`, "update.invalidDependencyChange");
    }
    return { ...change };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeManifestMigrations(input: readonly UpdateManifestMigration[]): UpdateManifestMigration[] {
  assertUnique(input, ({ id }) => id, "Manifest migrations");
  return input.map((migration) => {
    if (!Number.isSafeInteger(migration.fromVersion) || !Number.isSafeInteger(migration.toVersion) ||
      migration.fromVersion < 1 || migration.toVersion <= migration.fromVersion) {
      throw new UpdatePlanError(`Manifest migration '${migration.id}' has an invalid version transition`, "update.invalidManifestMigration");
    }
    return { ...migration };
  }).sort((left, right) => left.manifest.localeCompare(right.manifest) || left.fromVersion - right.fromVersion || left.id.localeCompare(right.id));
}

function normalizeGeneratedFiles(input: readonly UpdateGeneratedFileChange[]): UpdateGeneratedFileChange[] {
  assertUnique(input, ({ path }) => path, "Generated-file changes");
  return input.map((file) => {
    const path = safePath(file.path);
    assertDigest(file.baseDigest, `${path} base digest`, false);
    assertDigest(file.currentDigest, `${path} current digest`, false);
    assertDigest(file.targetDigest, `${path} target digest`, false);
    if (file.kind === "create" && (file.currentDigest !== undefined || file.targetDigest === undefined)) {
      throw new UpdatePlanError(`Generated create '${path}' requires only a target digest`, "update.invalidGeneratedFile");
    }
    if (file.kind === "remove" && (file.currentDigest === undefined || file.targetDigest !== undefined)) {
      throw new UpdatePlanError(`Generated removal '${path}' requires a current digest and no target digest`, "update.invalidGeneratedFile");
    }
    if (["replace", "merge"].includes(file.kind) &&
      (file.baseDigest === undefined || file.currentDigest === undefined || file.targetDigest === undefined)) {
      throw new UpdatePlanError(`Generated ${file.kind} '${path}' requires base, current, and target digests`, "update.invalidGeneratedFile");
    }
    if (file.kind === "replace" && file.currentDigest !== file.baseDigest) {
      throw new UpdatePlanError(`Generated replacement '${path}' has project drift and requires conflict handling`, "update.generatedFileDrift");
    }
    return { ...file, path };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeDatabaseMigrations(input: readonly UpdateDatabaseMigration[]): UpdateDatabaseMigration[] {
  assertUnique(input, ({ id }) => id, "Database migrations");
  return input.map((migration) => {
    if (!migration.moduleId.trim() || !isValidSemVer(migration.moduleVersion)) {
      throw new UpdatePlanError(`Database migration '${migration.id}' has invalid module metadata`, "update.invalidDatabaseMigration");
    }
    assertDigest(migration.digest, `${migration.id} migration digest`);
    return { ...migration };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeConflicts(input: readonly UpdateOwnershipConflict[]): UpdateOwnershipConflict[] {
  assertUnique(input, (conflict) => `${conflict.path}\0${conflict.reason}`, "Ownership conflicts");
  return input.map((conflict) => ({ ...conflict, path: safePath(conflict.path) }))
    .sort((left, right) => left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason));
}

function normalizeRequirements(input: readonly UpdateRequirement[], label: string): UpdateRequirement[] {
  assertUnique(input, ({ id }) => id, label);
  return input.map((requirement) => {
    if (!requirement.description.trim()) throw new UpdatePlanError(`${label} description cannot be empty`, "update.invalidRequirement");
    return { ...requirement };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeVerification(input: readonly UpdateVerificationCommand[]): UpdateVerificationCommand[] {
  assertUnique(input, ({ id }) => id, "Verification commands");
  return input.map((verification) => {
    if (!verification.command.trim()) throw new UpdatePlanError(`Verification '${verification.id}' command cannot be empty`, "update.invalidVerification");
    return { ...verification };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeCompatibility(input: readonly VersionModuleCompatibility[]): VersionModuleCompatibility[] {
  assertUnique(input, ({ moduleId }) => moduleId, "Module compatibility evidence");
  return input.map((entry) => ({ ...entry })).sort((left, right) => left.moduleId.localeCompare(right.moduleId));
}

function normalizePreconditions(input: UpdatePlanPreconditions): UpdatePlanPreconditions {
  assertDigest(input.projectManifestDigest, "Project manifest digest");
  assertDigest(input.lockDigest, "Lock digest");
  assertDigest(input.ownershipDigest, "Ownership digest");
  assertDigest(input.generatedStateDigest, "Generated state digest", false);
  return { ...input };
}

export function createUpdatePlan(input: UpdatePlanInput): UpdatePlan {
  const resolution = input.resolution;
  if (!resolution.valid || resolution.state === "blocked" || !resolution.targetVersion) {
    throw new UpdatePlanError("A valid framework version resolution is required", "update.invalidResolution");
  }
  if (!isValidSemVer(resolution.currentVersion) || !isValidSemVer(resolution.targetVersion) ||
    compareSemVer(resolution.targetVersion, resolution.currentVersion) < 0 ||
    (resolution.state === "update") !== (resolution.targetVersion !== resolution.currentVersion)) {
    throw new UpdatePlanError("Framework version resolution is internally inconsistent", "update.invalidResolution");
  }
  const selected = resolution.candidates.find(({ version }) => version === resolution.targetVersion);
  if ((resolution.state === "update" && !selected) || (selected !== undefined && !selected.compatible)) {
    throw new UpdatePlanError("Selected framework version lacks compatible resolution evidence", "update.invalidResolution");
  }

  const dependencyChanges = normalizeDependencies(input.dependencyChanges ?? []);
  const manifestMigrations = normalizeManifestMigrations(input.manifestMigrations ?? []);
  const generatedFiles = normalizeGeneratedFiles(input.generatedFiles ?? []);
  const databaseMigrations = normalizeDatabaseMigrations(input.databaseMigrations ?? []);
  const ownershipConflicts = normalizeConflicts(input.ownershipConflicts ?? []);
  const explicitApprovals = normalizeRequirements(input.requiredApprovals ?? [], "Required approvals");
  const databaseApprovals: UpdateRequirement[] = databaseMigrations
    .filter(({ destructive }) => destructive !== "none")
    .map(({ id, destructive }) => ({
      id: `database:${id}`,
      description: `${destructive === "destructive" ? "Destructive" : "Review-required"} database migration '${id}'`
    }));
  const requiredApprovals = normalizeRequirements([...explicitApprovals, ...databaseApprovals], "Required approvals");
  const verificationCommands = normalizeVerification(input.verificationCommands ?? []);
  const rollbackLimitations = normalizeRequirements(input.rollbackLimitations ?? [], "Rollback limitations");
  const moduleCompatibility = normalizeCompatibility(selected?.modules ?? []);

  const hasActions = dependencyChanges.length + manifestMigrations.length + generatedFiles.length + databaseMigrations.length > 0 ||
    resolution.targetVersion !== resolution.currentVersion;
  const payload: Omit<UpdatePlan, "planId" | "digest"> = {
    schemaVersion: 1,
    command: "update",
    state: ownershipConflicts.length > 0 ? "blocked" : hasActions ? "apply" : "unchanged",
    currentVersion: resolution.currentVersion,
    targetVersion: resolution.targetVersion,
    channel: resolution.channel,
    moduleCompatibility,
    dependencyChanges,
    manifestMigrations,
    generatedFiles,
    databaseMigrations,
    ownershipConflicts,
    requiredApprovals,
    verificationCommands,
    rollbackLimitations,
    preconditions: normalizePreconditions(input.preconditions)
  };
  return { ...identity(payload), ...payload };
}

export function verifyUpdatePlan(plan: UpdatePlan): void {
  const { planId, digest, ...payload } = plan;
  const expected = identity(payload);
  if (planId !== expected.planId || digest !== expected.digest) {
    throw new UpdatePlanError("Update plan digest is invalid", "update.invalidPlan");
  }
}
