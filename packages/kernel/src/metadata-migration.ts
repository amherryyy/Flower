import { compareSemVer, isValidSemVer } from "./semver.js";
import { sha256 } from "./template.js";
import type {
  ManifestDocumentKind,
  MetadataMigrationApplicationResult,
  ModuleUpdateMigrationDefinition,
  ModuleUpdateMigrationPlan,
  VersionedManifestMigrationDefinition,
  VersionedManifestMigrationPlan
} from "./types.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;

type JsonObject = Record<string, unknown>;

export class MetadataMigrationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "MetadataMigrationError";
    this.code = code;
  }
}

function asObject(document: unknown): JsonObject {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new MetadataMigrationError("Migration document must be a JSON object", "update.invalidMigrationDocument");
  }
  return document as JsonObject;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  throw new MetadataMigrationError("Migration document must contain only JSON values", "update.invalidMigrationDocument");
}

function documentDigest(document: unknown): string {
  return sha256(JSON.stringify(canonicalValue(asObject(document))));
}

function planIdentity<T extends { command: string }>(payload: T): { planId: string; digest: string } {
  const digest = sha256(JSON.stringify(payload));
  return {
    planId: `${payload.command}-${digest.slice("sha256:".length, "sha256:".length + 16)}`,
    digest
  };
}

function versionField(kind: ManifestDocumentKind): "schemaVersion" | "lockVersion" | "version" {
  if (kind === "lock") return "lockVersion";
  if (kind === "ownership") return "version";
  return "schemaVersion";
}

function manifestVersion(kind: ManifestDocumentKind, document: unknown): number {
  const value = asObject(document)[versionField(kind)];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new MetadataMigrationError(`${kind} manifest has an invalid version`, "update.invalidManifestVersion");
  }
  return Number(value);
}

function manifestRegistry(definitions: readonly VersionedManifestMigrationDefinition[]): Map<string, VersionedManifestMigrationDefinition> {
  const registry = new Map<string, VersionedManifestMigrationDefinition>();
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (!definition.id.trim() || ids.has(`${definition.manifest}/${definition.id}`) ||
      !Number.isSafeInteger(definition.fromVersion) || definition.fromVersion < 0 ||
      definition.toVersion !== definition.fromVersion + 1 || !DIGEST.test(definition.digest)) {
      throw new MetadataMigrationError(`Invalid manifest migration '${definition.id}'`, "update.invalidManifestMigrationDefinition");
    }
    const key = `${definition.manifest}@${definition.fromVersion}`;
    if (registry.has(key)) {
      throw new MetadataMigrationError(`Ambiguous manifest migration from '${key}'`, "update.ambiguousManifestMigration");
    }
    ids.add(`${definition.manifest}/${definition.id}`);
    registry.set(key, definition);
  }
  return registry;
}

function moduleRegistry(definitions: readonly ModuleUpdateMigrationDefinition[]): Map<string, ModuleUpdateMigrationDefinition> {
  const registry = new Map<string, ModuleUpdateMigrationDefinition>();
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (!definition.id.trim() || !definition.moduleId.trim() || ids.has(`${definition.moduleId}/${definition.id}`) ||
      !isValidSemVer(definition.fromVersion) || !isValidSemVer(definition.toVersion) ||
      compareSemVer(definition.toVersion, definition.fromVersion) <= 0 || !DIGEST.test(definition.digest)) {
      throw new MetadataMigrationError(`Invalid module migration '${definition.id}'`, "update.invalidModuleMigrationDefinition");
    }
    const key = `${definition.moduleId}@${definition.fromVersion}`;
    if (registry.has(key)) {
      throw new MetadataMigrationError(`Ambiguous module migration from '${key}'`, "update.ambiguousModuleMigration");
    }
    ids.add(`${definition.moduleId}/${definition.id}`);
    registry.set(key, definition);
  }
  return registry;
}

export function createVersionedManifestMigrationPlan(
  manifest: ManifestDocumentKind,
  document: unknown,
  targetVersion: number,
  definitions: readonly VersionedManifestMigrationDefinition[]
): VersionedManifestMigrationPlan {
  if (!Number.isSafeInteger(targetVersion) || targetVersion < 0) {
    throw new MetadataMigrationError("Target manifest version is invalid", "update.invalidManifestVersion");
  }
  const fromVersion = manifestVersion(manifest, document);
  if (fromVersion > targetVersion) {
    throw new MetadataMigrationError("Manifest migrations cannot downgrade", "update.manifestDowngradeUnsupported");
  }
  const registry = manifestRegistry(definitions);
  const steps: VersionedManifestMigrationPlan["steps"] = [];
  let version = fromVersion;
  while (version < targetVersion) {
    const definition = registry.get(`${manifest}@${version}`);
    if (!definition) {
      throw new MetadataMigrationError(`No ${manifest} manifest migration exists from version ${version}`, "update.missingManifestMigration");
    }
    steps.push({ id: definition.id, fromVersion: definition.fromVersion, toVersion: definition.toVersion, digest: definition.digest });
    version = definition.toVersion;
  }
  const payload: Omit<VersionedManifestMigrationPlan, "planId" | "digest"> = {
    schemaVersion: 1,
    command: "manifest-migrate",
    state: steps.length > 0 ? "apply" : "unchanged",
    manifest,
    fromVersion,
    toVersion: targetVersion,
    sourceDigest: documentDigest(document),
    steps
  };
  return { ...planIdentity(payload), ...payload };
}

export function verifyVersionedManifestMigrationPlan(plan: VersionedManifestMigrationPlan): void {
  const { planId, digest, ...payload } = plan;
  const expected = planIdentity(payload);
  if (planId !== expected.planId || digest !== expected.digest) {
    throw new MetadataMigrationError("Manifest migration plan digest is invalid", "update.invalidManifestMigrationPlan");
  }
  let version = plan.fromVersion;
  const shapeValid = Number.isSafeInteger(version) && Number.isSafeInteger(plan.toVersion) &&
    version >= 0 && plan.toVersion >= version && DIGEST.test(plan.sourceDigest) &&
    plan.state === (plan.steps.length > 0 ? "apply" : "unchanged") &&
    plan.steps.every((step) => {
      const valid = Boolean(step.id.trim()) && step.fromVersion === version &&
        step.toVersion === step.fromVersion + 1 && DIGEST.test(step.digest);
      version = step.toVersion;
      return valid;
    }) && version === plan.toVersion;
  if (!shapeValid) {
    throw new MetadataMigrationError("Manifest migration plan chain is invalid", "update.invalidManifestMigrationPlan");
  }
}

export function applyVersionedManifestMigrationPlan(
  plan: VersionedManifestMigrationPlan,
  document: unknown,
  definitions: readonly VersionedManifestMigrationDefinition[]
): MetadataMigrationApplicationResult {
  verifyVersionedManifestMigrationPlan(plan);
  if (manifestVersion(plan.manifest, document) !== plan.fromVersion || documentDigest(document) !== plan.sourceDigest) {
    throw new MetadataMigrationError("Manifest changed after migration planning", "update.manifestChanged");
  }
  const registry = manifestRegistry(definitions);
  let migrated = structuredClone(asObject(document));
  const applied: string[] = [];
  for (const step of plan.steps) {
    const definition = registry.get(`${plan.manifest}@${step.fromVersion}`);
    if (!definition || definition.id !== step.id || definition.toVersion !== step.toVersion || definition.digest !== step.digest) {
      throw new MetadataMigrationError(`Manifest migration '${step.id}' changed after planning`, "update.manifestMigrationChanged");
    }
    migrated = asObject(definition.migrate(structuredClone(migrated)));
    if (manifestVersion(plan.manifest, migrated) !== step.toVersion) {
      throw new MetadataMigrationError(`Manifest migration '${step.id}' did not set version ${step.toVersion}`, "update.manifestMigrationPostcondition");
    }
    applied.push(step.id);
  }
  return { changed: applied.length > 0, document: migrated, applied };
}

export function createModuleUpdateMigrationPlan(
  moduleId: string,
  fromVersion: string,
  toVersion: string,
  document: unknown,
  definitions: readonly ModuleUpdateMigrationDefinition[]
): ModuleUpdateMigrationPlan {
  if (!moduleId.trim() || !isValidSemVer(fromVersion) || !isValidSemVer(toVersion)) {
    throw new MetadataMigrationError("Module migration request is invalid", "update.invalidModuleMigrationRequest");
  }
  if (compareSemVer(fromVersion, toVersion) > 0) {
    throw new MetadataMigrationError("Module migrations cannot downgrade", "update.moduleDowngradeUnsupported");
  }
  const registry = moduleRegistry(definitions);
  const steps: ModuleUpdateMigrationPlan["steps"] = [];
  let version = fromVersion;
  while (compareSemVer(version, toVersion) < 0) {
    const definition = registry.get(`${moduleId}@${version}`);
    if (!definition) {
      throw new MetadataMigrationError(`No '${moduleId}' module migration exists from ${version}`, "update.missingModuleMigration");
    }
    if (compareSemVer(definition.toVersion, toVersion) > 0) {
      throw new MetadataMigrationError(`Module migration '${definition.id}' overshoots ${toVersion}`, "update.moduleMigrationOvershoot");
    }
    steps.push({ id: definition.id, fromVersion: definition.fromVersion, toVersion: definition.toVersion, digest: definition.digest });
    version = definition.toVersion;
  }
  const payload: Omit<ModuleUpdateMigrationPlan, "planId" | "digest"> = {
    schemaVersion: 1,
    command: "module-update-migrate",
    state: steps.length > 0 ? "apply" : "unchanged",
    moduleId,
    fromVersion,
    toVersion,
    sourceDigest: documentDigest(document),
    steps
  };
  return { ...planIdentity(payload), ...payload };
}

export function verifyModuleUpdateMigrationPlan(plan: ModuleUpdateMigrationPlan): void {
  const { planId, digest, ...payload } = plan;
  const expected = planIdentity(payload);
  if (planId !== expected.planId || digest !== expected.digest) {
    throw new MetadataMigrationError("Module migration plan digest is invalid", "update.invalidModuleMigrationPlan");
  }
  let version = plan.fromVersion;
  const shapeValid = Boolean(plan.moduleId.trim()) && isValidSemVer(version) && isValidSemVer(plan.toVersion) &&
    compareSemVer(version, plan.toVersion) <= 0 && DIGEST.test(plan.sourceDigest) &&
    plan.state === (plan.steps.length > 0 ? "apply" : "unchanged") &&
    plan.steps.every((step) => {
      const valid = Boolean(step.id.trim()) && step.fromVersion === version &&
        isValidSemVer(step.fromVersion) && isValidSemVer(step.toVersion) &&
        compareSemVer(step.toVersion, step.fromVersion) > 0 &&
        compareSemVer(step.toVersion, plan.toVersion) <= 0 && DIGEST.test(step.digest);
      version = step.toVersion;
      return valid;
    }) && version === plan.toVersion;
  if (!shapeValid) {
    throw new MetadataMigrationError("Module migration plan chain is invalid", "update.invalidModuleMigrationPlan");
  }
}

export function applyModuleUpdateMigrationPlan(
  plan: ModuleUpdateMigrationPlan,
  document: unknown,
  definitions: readonly ModuleUpdateMigrationDefinition[]
): MetadataMigrationApplicationResult {
  verifyModuleUpdateMigrationPlan(plan);
  if (documentDigest(document) !== plan.sourceDigest) {
    throw new MetadataMigrationError("Module configuration changed after migration planning", "update.moduleConfigurationChanged");
  }
  const registry = moduleRegistry(definitions);
  let migrated = structuredClone(asObject(document));
  const applied: string[] = [];
  for (const step of plan.steps) {
    const definition = registry.get(`${plan.moduleId}@${step.fromVersion}`);
    if (!definition || definition.id !== step.id || definition.toVersion !== step.toVersion || definition.digest !== step.digest) {
      throw new MetadataMigrationError(`Module migration '${step.id}' changed after planning`, "update.moduleMigrationChanged");
    }
    migrated = asObject(definition.migrate(structuredClone(migrated)));
    applied.push(step.id);
  }
  return { changed: applied.length > 0, document: migrated, applied };
}
