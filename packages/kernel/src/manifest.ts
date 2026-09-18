import type { ManifestMigrationResult, ManifestMigrationStep } from "./types.js";

export const LATEST_PROJECT_SCHEMA_VERSION = 1;

type JsonObject = Record<string, unknown>;

interface MigrationDefinition extends ManifestMigrationStep {
  migrate(document: JsonObject): JsonObject;
}

const projectMigrations: MigrationDefinition[] = [
  {
    from: 0,
    to: 1,
    description: "Introduce schemaVersion and the structured Flower version object",
    migrate(document) {
      const migrated = structuredClone(document);
      const legacyVersion =
        typeof migrated.frameworkVersion === "string"
          ? migrated.frameworkVersion
          : "0.1.0";

      delete migrated.frameworkVersion;
      migrated.schemaVersion = 1;
      migrated.mode = migrated.mode ?? "project";
      migrated.flower = migrated.flower ?? {
        version: legacyVersion,
        channel: "development"
      };
      return migrated;
    }
  }
];

function asObject(document: unknown): JsonObject {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new TypeError("Project manifest must be a JSON object");
  }
  return document as JsonObject;
}

export function projectSchemaVersion(document: unknown): number {
  const object = asObject(document);
  if (object.schemaVersion === undefined) return 0;
  if (!Number.isInteger(object.schemaVersion) || Number(object.schemaVersion) < 0) {
    throw new TypeError("schemaVersion must be a non-negative integer");
  }
  return Number(object.schemaVersion);
}

export function migrateProjectManifest(
  document: unknown,
  targetVersion = LATEST_PROJECT_SCHEMA_VERSION
): ManifestMigrationResult {
  let migrated = structuredClone(asObject(document));
  const fromVersion = projectSchemaVersion(migrated);
  let currentVersion = fromVersion;
  const steps: ManifestMigrationStep[] = [];

  if (currentVersion > targetVersion) {
    throw new Error(
      `Project schema version ${currentVersion} is newer than supported version ${targetVersion}`
    );
  }

  while (currentVersion < targetVersion) {
    const migration = projectMigrations.find((candidate) => candidate.from === currentVersion);
    if (!migration) {
      throw new Error(`No project manifest migration exists from version ${currentVersion}`);
    }
    migrated = migration.migrate(migrated);
    currentVersion = migration.to;
    steps.push({
      from: migration.from,
      to: migration.to,
      description: migration.description
    });
  }

  return {
    fromVersion,
    toVersion: currentVersion,
    changed: steps.length > 0,
    document: migrated,
    steps
  };
}
