import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMigrationPlan,
  loadModuleCatalog,
  verifyMigrationPlan,
  type AppliedMigration,
  type MigrationPlanAction
} from "../packages/kernel/src/index.js";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function json(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

async function migrationCatalog(): Promise<Awaited<ReturnType<typeof loadModuleCatalog>>> {
  const parent = await mkdtemp(path.join(tmpdir(), "flower-migrations-"));
  temporaryDirectories.push(parent);
  const catalogRoot = path.join(parent, "catalog");
  await cp(path.join(root, "tests/fixtures/module-catalog"), catalogRoot, { recursive: true });

  const definitions = [
    { moduleId: "auth", migrations: ["auth-001"] },
    { moduleId: "organizations", migrations: ["organizations-001", "organizations-002"] }
  ];
  for (const definition of definitions) {
    const moduleRoot = path.join(catalogRoot, definition.moduleId);
    const manifestPath = path.join(moduleRoot, "flower.module.json");
    const manifest = await json(manifestPath);
    manifest.migrations = definition.migrations;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await mkdir(path.join(moduleRoot, "migrations"));
    for (const migrationId of definition.migrations) {
      await writeFile(path.join(moduleRoot, "migrations", `${migrationId}.sql`), `-- ${migrationId}\nselect 1;\n`);
      await writeFile(path.join(moduleRoot, "migrations", `${migrationId}.json`), `${JSON.stringify({
        $schema: "https://flower.dev/schemas/migration/v1.json",
        schemaVersion: 1,
        id: migrationId,
        provider: "postgresql",
        transaction: "required",
        destructive: "none",
        dependsOn: [],
        verificationQueries: [{ id: "smoke", sql: "select true as verified;", expected: true }],
        rollbackGuidance: "Test fixture rollback guidance.",
        rls: { tables: [], mode: "not-applicable" }
      }, null, 2)}\n`);
    }
  }

  const schema = await json(path.join(root, "schemas/module/v1.json"));
  const migrationSchema = await json(path.join(root, "schemas/migration/v1.json"));
  return loadModuleCatalog(catalogRoot, schema, migrationSchema);
}

function applied(action: MigrationPlanAction): AppliedMigration {
  return {
    id: action.id,
    moduleId: action.moduleId,
    moduleVersion: action.moduleVersion,
    sourceDigest: action.sourceDigest
  };
}

describe("migration package verification", () => {
  it("loads non-empty declared SQL and includes it in the package digest", async () => {
    const catalog = await migrationCatalog();
    const auth = catalog.find(({ manifest }) => manifest.id === "auth")!;
    expect(auth.migrations).toEqual([
      expect.objectContaining({ id: "auth-001", sourceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) })
    ]);
    const digestBefore = auth.digest;
    await writeFile(auth.migrations[0]!.sourcePath, "select 2;\n");
    const schema = await json(path.join(root, "schemas/module/v1.json"));
    const migrationSchema = await json(path.join(root, "schemas/migration/v1.json"));
    const reloaded = await loadModuleCatalog(path.dirname(auth.root), schema, migrationSchema);
    expect(reloaded.find(({ manifest }) => manifest.id === "auth")!.digest).not.toBe(digestBefore);
  });

  it("rejects missing, empty, and undeclared SQL files", async () => {
    const missingCatalog = await migrationCatalog();
    const missing = missingCatalog.find(({ manifest }) => manifest.id === "auth")!;
    await rm(missing.migrations[0]!.sourcePath);
    const schema = await json(path.join(root, "schemas/module/v1.json"));
    const migrationSchema = await json(path.join(root, "schemas/migration/v1.json"));
    await expect(loadModuleCatalog(path.dirname(missing.root), schema, migrationSchema)).rejects.toThrow();

    const emptyCatalog = await migrationCatalog();
    const empty = emptyCatalog.find(({ manifest }) => manifest.id === "auth")!;
    await writeFile(empty.migrations[0]!.sourcePath, "  \n");
    await expect(loadModuleCatalog(path.dirname(empty.root), schema, migrationSchema)).rejects.toThrow(/is empty/);

    const extraCatalog = await migrationCatalog();
    const extra = extraCatalog.find(({ manifest }) => manifest.id === "auth")!;
    await writeFile(path.join(extra.root, "migrations", "auth-999.sql"), "select 1;\n");
    await expect(loadModuleCatalog(path.dirname(extra.root), schema, migrationSchema)).rejects.toThrow(/not declared/);
  });
});

describe("deterministic migration planning", () => {
  it("orders dependency migrations and emits only the unapplied suffix", async () => {
    const catalog = await migrationCatalog();
    const initial = createMigrationPlan(catalog, ["organizations"]);
    expect(initial.state).toBe("apply");
    expect(initial.resolvedModules).toEqual(["auth", "organizations"]);
    expect(initial.actions.map(({ ordinal, id }) => `${ordinal}:${id}`)).toEqual([
      "1:auth-001",
      "2:organizations-001",
      "3:organizations-002"
    ]);
    verifyMigrationPlan(initial);

    const resumed = createMigrationPlan(catalog, ["organizations"], initial.actions.slice(0, 2).map(applied));
    expect(resumed.actions.map(({ id }) => id)).toEqual(["organizations-002"]);
    expect(resumed.actions[0]?.ordinal).toBe(3);

    const complete = createMigrationPlan(catalog, ["organizations"], initial.actions.map(applied));
    expect(complete.state).toBe("unchanged");
    expect(complete.actions).toEqual([]);
  });

  it("fails closed for unknown, reordered, drifted, and duplicate history", async () => {
    const catalog = await migrationCatalog();
    const plan = createMigrationPlan(catalog, ["organizations"]);
    const first = applied(plan.actions[0]!);
    const second = applied(plan.actions[1]!);

    expect(() => createMigrationPlan(catalog, ["organizations"], [{ ...first, id: "unknown-001" }])).toThrowError(
      expect.objectContaining({ code: "migration.unknownHistory" })
    );
    expect(() => createMigrationPlan(catalog, ["organizations"], [second])).toThrowError(
      expect.objectContaining({ code: "migration.historyOutOfOrder" })
    );
    expect(() => createMigrationPlan(catalog, ["organizations"], [{ ...first, sourceDigest: "sha256:changed" }])).toThrowError(
      expect.objectContaining({ code: "migration.historyDrift" })
    );
    expect(() => createMigrationPlan(catalog, ["organizations"], [first, first])).toThrowError(
      expect.objectContaining({ code: "migration.duplicateHistory" })
    );
  });

  it("detects plan tampering", async () => {
    const plan = createMigrationPlan(await migrationCatalog(), ["organizations"]);
    plan.actions[0]!.id = "changed-001";
    expect(() => verifyMigrationPlan(plan)).toThrowError(expect.objectContaining({ code: "migration.invalidPlan" }));
  });
});
