import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { mergeGeneratedText } from "./generated-text-merge.js";
import {
  applyVersionedManifestMigrationPlan,
  createModuleUpdateMigrationPlan,
  createVersionedManifestMigrationPlan
} from "./metadata-migration.js";
import { classifyPath, normalizeProjectPath, validateOwnershipManifest } from "./ownership.js";
import { compareSemVer } from "./semver.js";
import { sha256 } from "./template.js";
import { createUpdatePlan } from "./update-plan.js";
import { resolveFrameworkVersion } from "./update-version.js";
import { validateDocument } from "./validation.js";
import type {
  ManifestDocumentKind,
  OwnershipManifest,
  ProjectManifest,
  UpdateGeneratedFileChange,
  UpdateManifestMigration,
  UpdateModuleMigration,
  UpdateOwnershipConflict,
  UpdatePlan,
  VerifiedReleasePackage
} from "./types.js";

const MANIFEST_PATHS: Record<Exclude<ManifestDocumentKind, "module">, string> = {
  project: ".flower/project.json",
  lock: ".flower/lock.json",
  ownership: ".flower/ownership.json"
};

interface LockDocument {
  lockVersion: number;
  flowerVersion: string;
  modules: Record<string, string>;
  generatedFiles?: Record<string, string>;
}

export interface ReleaseUpdatePlanningOptions {
  projectSchema: object;
  ownershipSchema: object;
}

export class ReleaseUpdatePlanningError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ReleaseUpdatePlanningError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function absolutePath(root: string, relativePath: string): string {
  let normalized: string;
  try {
    normalized = normalizeProjectPath(relativePath);
  } catch {
    throw new ReleaseUpdatePlanningError(`Update path is unsafe: ${relativePath}`, "update.unsafePath");
  }
  if (!normalized || normalized !== relativePath) {
    throw new ReleaseUpdatePlanningError(`Update path is unsafe: ${relativePath}`, "update.unsafePath");
  }
  const absolute = path.resolve(root, ...normalized.split("/"));
  const relation = path.relative(root, absolute);
  if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
    throw new ReleaseUpdatePlanningError(`Update path escapes the project: ${relativePath}`, "update.unsafePath");
  }
  return absolute;
}

async function projectFile(root: string, relativePath: string, optional = false): Promise<Buffer | undefined> {
  const absolute = absolutePath(root, relativePath);
  try {
    const details = await lstat(absolute);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new ReleaseUpdatePlanningError(`Project file is unsafe: ${relativePath}`, "update.unsafePath");
    }
    return await readFile(absolute);
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof ReleaseUpdatePlanningError) throw error;
    throw new ReleaseUpdatePlanningError(`Required project file is missing: ${relativePath}`, "update.projectFileMissing");
  }
}

function json(bytes: Buffer, relativePath: string): Record<string, unknown> {
  try {
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!isRecord(value)) throw new Error("document is not an object");
    return value;
  } catch (error) {
    throw new ReleaseUpdatePlanningError(
      `Project document '${relativePath}' is invalid: ${error instanceof Error ? error.message : "invalid JSON"}`,
      "update.projectDocumentInvalid"
    );
  }
}

function grouped<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const output = new Map<string, T[]>();
  for (const value of values) {
    const identity = key(value);
    output.set(identity, [...(output.get(identity) ?? []), value]);
  }
  return output;
}

function sameStringRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function ownershipConflict(
  ownership: OwnershipManifest,
  updatePath: string,
  reason: string
): UpdateOwnershipConflict {
  const classification = classifyPath(ownership, updatePath);
  return {
    path: updatePath,
    owner: classification.rule?.owner ?? "project",
    policy: classification.rule?.policy ?? "never-overwrite",
    reason
  };
}

function assertGeneratedOwnership(
  current: OwnershipManifest,
  final: OwnershipManifest,
  updatePath: string,
  conflicts: UpdateOwnershipConflict[]
): boolean {
  const classifications = [classifyPath(current, updatePath), classifyPath(final, updatePath)];
  const blocked = classifications.some(({ rule, conflict }) =>
    conflict || rule?.owner !== "generated" || rule.policy === "never-overwrite"
  );
  if (blocked) conflicts.push(ownershipConflict(current, updatePath, "generated-path-not-replaceable"));
  return !blocked;
}

function validateLock(document: Record<string, unknown>): asserts document is Record<string, unknown> & LockDocument {
  if (!Number.isSafeInteger(document.lockVersion) || typeof document.flowerVersion !== "string" || !isRecord(document.modules) ||
      Object.values(document.modules).some((version) => typeof version !== "string")) {
    throw new ReleaseUpdatePlanningError("Flower lock document is invalid", "update.projectDocumentInvalid");
  }
}

function assertOwnershipShape(document: Record<string, unknown>): asserts document is Record<string, unknown> & OwnershipManifest {
  if (!Array.isArray(document.rules) || document.rules.some((rule) =>
    !isRecord(rule) || typeof rule.pattern !== "string" || typeof rule.owner !== "string" || typeof rule.policy !== "string"
  )) {
    throw new ReleaseUpdatePlanningError("Migrated ownership manifest is invalid", "update.releasePostconditionFailed");
  }
}

export async function createReleasePackageUpdatePlan(
  projectRootInput: string,
  release: VerifiedReleasePackage,
  options: ReleaseUpdatePlanningOptions
): Promise<UpdatePlan> {
  const projectRoot = path.resolve(projectRootInput);
  const rootDetails = await lstat(projectRoot);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new ReleaseUpdatePlanningError("Update target is not a regular directory", "update.unsafeTarget");
  }
  const [projectBytes, lockBytes, ownershipBytes] = await Promise.all([
    projectFile(projectRoot, MANIFEST_PATHS.project),
    projectFile(projectRoot, MANIFEST_PATHS.lock),
    projectFile(projectRoot, MANIFEST_PATHS.ownership)
  ]) as [Buffer, Buffer, Buffer];
  const projectDocument = json(projectBytes, MANIFEST_PATHS.project);
  const lockDocument = json(lockBytes, MANIFEST_PATHS.lock);
  const ownershipDocument = json(ownershipBytes, MANIFEST_PATHS.ownership);
  const projectValidation = validateDocument(options.projectSchema, projectDocument, "project");
  const ownershipValidation = validateOwnershipManifest(options.ownershipSchema, ownershipDocument);
  if (!projectValidation.valid || !ownershipValidation.valid) {
    throw new ReleaseUpdatePlanningError(
      [...projectValidation.diagnostics, ...ownershipValidation.diagnostics].map(({ path: diagnosticPath, message }) => `${diagnosticPath} ${message}`).join("; "),
      "update.projectDocumentInvalid"
    );
  }
  validateLock(lockDocument);
  const project = projectDocument as unknown as ProjectManifest;
  const projectModules = project.modules ?? {};
  const ownership = ownershipDocument as unknown as OwnershipManifest;
  if (project.flower.version !== release.manifest.sourceVersion || lockDocument.flowerVersion !== release.manifest.sourceVersion) {
    throw new ReleaseUpdatePlanningError(
      `Release package starts at ${release.manifest.sourceVersion}, but the project and lock must both match it`,
      "update.releaseSourceMismatch"
    );
  }
  if (!sameStringRecord(projectModules, lockDocument.modules)) {
    throw new ReleaseUpdatePlanningError("Project and lock module versions disagree", "update.moduleStateMismatch");
  }

  const documents: Record<Exclude<ManifestDocumentKind, "module">, Record<string, unknown>> = {
    project: projectDocument,
    lock: lockDocument,
    ownership: ownershipDocument
  };
  const manifestSteps: UpdateManifestMigration[] = [];
  const migratedDocuments = { ...documents };
  for (const [kindValue, definitions] of grouped(release.manifestMigrations, ({ manifest }) => manifest)) {
    const kind = kindValue as Exclude<ManifestDocumentKind, "module">;
    const source = documents[kind];
    const targetVersion = Math.max(...definitions.map(({ toVersion }) => toVersion));
    const migrationPlan = createVersionedManifestMigrationPlan(kind, source, targetVersion, release.manifestMigrations);
    manifestSteps.push(...migrationPlan.steps.map((step) => ({ ...step, manifest: kind })));
    migratedDocuments[kind] = applyVersionedManifestMigrationPlan(migrationPlan, source, release.manifestMigrations).document;
  }
  const migratedProject = migratedDocuments.project as unknown as ProjectManifest;
  const migratedProjectModules = migratedProject.modules ?? {};
  const migratedLock = migratedDocuments.lock;
  validateLock(migratedLock);
  assertOwnershipShape(migratedDocuments.ownership);
  if (migratedProject.flower?.version !== release.manifest.targetVersion || migratedLock.flowerVersion !== release.manifest.targetVersion) {
    throw new ReleaseUpdatePlanningError("Release migrations do not set the project and lock target version", "update.releasePostconditionFailed");
  }

  const moduleSteps: UpdateModuleMigration[] = [];
  for (const [moduleId, definitions] of grouped(release.moduleMigrations, ({ moduleId }) => moduleId)) {
    const installedVersion = projectModules[moduleId];
    const lockedVersion = lockDocument.modules[moduleId];
    if (!installedVersion || installedVersion !== lockedVersion) {
      throw new ReleaseUpdatePlanningError(`Module '${moduleId}' is missing or inconsistent`, "update.moduleStateMismatch");
    }
    const documentPath = release.moduleDocuments.find((entry) => entry.moduleId === moduleId)?.path;
    if (!documentPath) throw new ReleaseUpdatePlanningError(`Module '${moduleId}' has no configuration path`, "update.moduleDocumentMissing");
    const moduleBytes = await projectFile(projectRoot, documentPath) as Buffer;
    const moduleDocument = json(moduleBytes, documentPath);
    const targetVersion = [...definitions].sort((left, right) => compareSemVer(left.toVersion, right.toVersion)).at(-1)!.toVersion;
    const migrationPlan = createModuleUpdateMigrationPlan(moduleId, installedVersion, targetVersion, moduleDocument, release.moduleMigrations);
    moduleSteps.push(...migrationPlan.steps.map((step) => ({ ...step, moduleId })));
    if (migratedProjectModules[moduleId] !== targetVersion || migratedLock.modules[moduleId] !== targetVersion) {
      throw new ReleaseUpdatePlanningError(`Release manifests do not set module '${moduleId}' to ${targetVersion}`, "update.releasePostconditionFailed");
    }
  }

  const ownershipConflicts: UpdateOwnershipConflict[] = [];
  const generatedFiles: UpdateGeneratedFileChange[] = [];
  const finalOwnership = migratedDocuments.ownership;
  for (const artifact of release.manifest.generatedFiles) {
    const updatePath = normalizeProjectPath(artifact.path);
    const owned = assertGeneratedOwnership(ownership, finalOwnership, updatePath, ownershipConflicts);
    const current = await projectFile(projectRoot, updatePath, artifact.kind === "create");
    const source = release.generatedSources.find(({ path: sourcePath }) => sourcePath === updatePath);
    if (artifact.kind === "create") {
      if (current) ownershipConflicts.push(ownershipConflict(ownership, updatePath, "generated-create-target-exists"));
      else if (owned) generatedFiles.push({ path: updatePath, kind: "create", targetDigest: sha256(source!.target!) });
      continue;
    }
    if (!current) throw new ReleaseUpdatePlanningError(`Generated file '${updatePath}' is missing`, "update.projectFileMissing");
    if (artifact.kind === "remove") {
      if (owned) generatedFiles.push({ path: updatePath, kind: "remove", currentDigest: sha256(current) });
      continue;
    }
    if (source?.base === undefined || source.target === undefined) {
      throw new ReleaseUpdatePlanningError(`Generated sources are missing for '${updatePath}'`, "update.releaseGeneratedInvalid");
    }
    let currentText: string;
    try {
      currentText = new TextDecoder("utf-8", { fatal: true }).decode(current);
    } catch {
      throw new ReleaseUpdatePlanningError(`Generated file '${updatePath}' is not UTF-8 text`, "update.generatedMergeBinary");
    }
    const merged = mergeGeneratedText(source.base, currentText, source.target);
    if (artifact.kind === "replace" && merged.currentDigest !== merged.baseDigest) {
      ownershipConflicts.push(ownershipConflict(ownership, updatePath, "generated-file-drift"));
      continue;
    }
    if (artifact.kind === "merge" && merged.status === "conflict") {
      ownershipConflicts.push(ownershipConflict(ownership, updatePath, "generated-merge-conflict"));
    }
    if (!owned || ["unchanged", "preserve", "converged"].includes(merged.status)) continue;
    generatedFiles.push({
      path: updatePath,
      kind: artifact.kind === "replace" ? "replace" : merged.status === "replace" ? "replace" : "merge",
      baseDigest: merged.baseDigest,
      currentDigest: merged.currentDigest,
      targetDigest: merged.targetDigest
    });
  }

  const resolution = resolveFrameworkVersion({
    currentVersion: release.manifest.sourceVersion,
    requestedVersion: release.manifest.targetVersion,
    channel: project.flower.channel,
    releases: [{ version: release.manifest.targetVersion, channel: release.manifest.channel }]
  });
  return createUpdatePlan({
    resolution,
    preconditions: {
      projectManifestDigest: sha256(projectBytes),
      lockDigest: sha256(lockBytes),
      ownershipDigest: sha256(ownershipBytes),
      releasePackageDigest: release.digest
    },
    dependencyChanges: release.manifest.dependencyChanges,
    manifestMigrations: manifestSteps,
    moduleMigrations: moduleSteps,
    generatedFiles,
    databaseMigrations: release.manifest.databaseMigrations.map(({ source: _source, ...migration }) => migration),
    ownershipConflicts,
    requiredApprovals: release.manifest.requiredApprovals,
    verificationCommands: release.manifest.verificationCommands,
    rollbackLimitations: release.manifest.rollbackLimitations
  });
}
