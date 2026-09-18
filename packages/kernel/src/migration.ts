import { resolveModules } from "./module.js";
import { sha256 } from "./template.js";
import type {
  AppliedMigration,
  Diagnostic,
  MigrationPlan,
  MigrationPlanAction,
  VerifiedModuleMigration,
  VerifiedModulePackage
} from "./types.js";

export class MigrationPlanError extends Error {
  readonly code: string;
  readonly diagnostics: Diagnostic[];

  constructor(message: string, code: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.name = "MigrationPlanError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

function planIdentity(payload: Omit<MigrationPlan, "planId" | "digest">): { planId: string; digest: string } {
  const digest = sha256(JSON.stringify(payload));
  return { planId: digest.slice("sha256:".length, "sha256:".length + 16), digest };
}

function migrationById(packages: readonly VerifiedModulePackage[]): Map<string, {
  modulePackage: VerifiedModulePackage;
  migration: VerifiedModuleMigration;
}> {
  const registry = new Map<string, { modulePackage: VerifiedModulePackage; migration: VerifiedModuleMigration }>();
  for (const modulePackage of [...packages].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))) {
    if (modulePackage.manifest.migrations.length !== modulePackage.migrations.length) {
      throw new MigrationPlanError(
        `Module '${modulePackage.manifest.id}' has an incomplete verified migration package`,
        "migration.incompletePackage"
      );
    }
    modulePackage.manifest.migrations.forEach((migrationId, index) => {
      const migration = modulePackage.migrations[index];
      if (!migration || migration.id !== migrationId) {
        throw new MigrationPlanError(
          `Module '${modulePackage.manifest.id}' migration registry does not match its manifest`,
          "migration.packageOrderMismatch"
        );
      }
      const existing = registry.get(migrationId);
      if (existing) {
        throw new MigrationPlanError(
          `Migration id '${migrationId}' is declared by both '${existing.modulePackage.manifest.id}' and '${modulePackage.manifest.id}'`,
          "migration.duplicateId"
        );
      }
      registry.set(migrationId, { modulePackage, migration });
    });
  }
  return registry;
}

function assertHistory(
  applied: readonly AppliedMigration[],
  ordered: readonly MigrationPlanAction[],
  registry: ReadonlyMap<string, { modulePackage: VerifiedModulePackage; migration: VerifiedModuleMigration }>
): void {
  const seen = new Set<string>();
  for (const [index, entry] of applied.entries()) {
    if (seen.has(entry.id)) {
      throw new MigrationPlanError(`Applied migration '${entry.id}' appears more than once`, "migration.duplicateHistory");
    }
    seen.add(entry.id);
    const known = registry.get(entry.id);
    if (!known) {
      throw new MigrationPlanError(`Applied migration '${entry.id}' is not present in the verified catalog`, "migration.unknownHistory");
    }
    const expected = ordered[index];
    if (!expected || expected.id !== entry.id) {
      throw new MigrationPlanError(
        `Applied migration '${entry.id}' is not the expected migration at ordinal ${index + 1}`,
        "migration.historyOutOfOrder"
      );
    }
    if (
      entry.moduleId !== expected.moduleId ||
      entry.moduleVersion !== expected.moduleVersion ||
      entry.sourceDigest !== expected.sourceDigest
    ) {
      throw new MigrationPlanError(
        `Applied migration '${entry.id}' no longer matches its verified package metadata`,
        "migration.historyDrift"
      );
    }
  }
}

export function createMigrationPlan(
  packages: readonly VerifiedModulePackage[],
  requestedModulesInput: readonly string[],
  appliedInput: readonly AppliedMigration[] = []
): MigrationPlan {
  const packagesById = new Map(packages.map((modulePackage) => [modulePackage.manifest.id, modulePackage]));
  if (packagesById.size !== packages.length) {
    throw new MigrationPlanError("Migration catalog contains duplicate module ids", "migration.duplicateModule");
  }
  const registry = migrationById(packages);
  const requestedModules = [...new Set(requestedModulesInput)].sort();
  const resolution = resolveModules(packages.map(({ manifest }) => manifest), requestedModules);
  if (!resolution.valid) {
    throw new MigrationPlanError("Module graph cannot produce a migration plan", "migration.invalidModuleGraph", resolution.diagnostics);
  }

  const ordered: MigrationPlanAction[] = [];
  for (const moduleId of resolution.resolved) {
    const modulePackage = packagesById.get(moduleId);
    if (!modulePackage) {
      throw new MigrationPlanError(`Resolved module '${moduleId}' has no verified package`, "migration.missingPackage");
    }
    for (const migration of modulePackage.migrations) {
      ordered.push({
        ordinal: ordered.length + 1,
        id: migration.id,
        moduleId,
        moduleVersion: modulePackage.manifest.version,
        sourceDigest: migration.sourceDigest
      });
    }
  }

  const applied = appliedInput.map((entry) => ({ ...entry }));
  assertHistory(applied, ordered, registry);
  const actions = ordered.slice(applied.length);
  const payload: Omit<MigrationPlan, "planId" | "digest"> = {
    schemaVersion: 1,
    command: "migrate",
    state: actions.length === 0 ? "unchanged" : "apply",
    requestedModules,
    resolvedModules: resolution.resolved,
    applied,
    actions
  };
  return { ...planIdentity(payload), ...payload };
}

export function verifyMigrationPlan(plan: MigrationPlan): void {
  const { planId, digest, ...payload } = plan;
  const expected = planIdentity(payload);
  if (planId !== expected.planId || digest !== expected.digest) {
    throw new MigrationPlanError("Migration plan digest is invalid", "migration.invalidPlan");
  }
}
