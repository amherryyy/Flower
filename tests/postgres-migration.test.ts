import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyNodePostgresMigrationPlan,
  applyPostgresMigrationPlan,
  createMigrationPlan,
  loadModuleCatalog,
  readPostgresMigrationHistory,
  type AppliedMigration,
  type PostgresMigrationClient,
  type PostgresQueryResult
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
  const parent = await mkdtemp(path.join(tmpdir(), "flower-postgres-migrations-"));
  temporaryDirectories.push(parent);
  const catalogRoot = path.join(parent, "catalog");
  await cp(path.join(root, "tests/fixtures/module-catalog"), catalogRoot, { recursive: true });
  for (const definition of [
    { moduleId: "auth", migrations: ["auth-001"] },
    { moduleId: "organizations", migrations: ["organizations-001", "organizations-002"] }
  ]) {
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
  return loadModuleCatalog(
    catalogRoot,
    await json(path.join(root, "schemas/module/v1.json")),
    await json(path.join(root, "schemas/migration/v1.json"))
  );
}

class FakePostgres implements PostgresMigrationClient {
  history: AppliedMigration[] = [];
  historyTableExists = false;
  queries: Array<{ text: string; values: readonly unknown[] }> = [];
  failWhenSqlIncludes?: string;
  verificationValue = true;
  private snapshot?: { history: AppliedMigration[]; historyTableExists: boolean };

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values });
    const normalized = text.trim().toLowerCase();
    if (this.failWhenSqlIncludes && text.includes(this.failWhenSqlIncludes)) {
      throw new Error(`forced failure: ${this.failWhenSqlIncludes}`);
    }
    if (normalized === "begin;") {
      this.snapshot = { history: structuredClone(this.history), historyTableExists: this.historyTableExists };
    } else if (normalized.includes("create table if not exists flower_internal.schema_migrations")) {
      this.historyTableExists = true;
    } else if (normalized.startsWith("insert into flower_internal.schema_migrations")) {
      this.history.push({
        id: values[0] as string,
        moduleId: values[1] as string,
        moduleVersion: values[2] as string,
        sourceDigest: values[3] as string
      });
    } else if (normalized === "rollback;") {
      if (this.snapshot) {
        this.history = this.snapshot.history;
        this.historyTableExists = this.snapshot.historyTableExists;
      }
      this.snapshot = undefined;
    } else if (normalized === "commit;") {
      this.snapshot = undefined;
    }

    let rows: Array<Record<string, unknown>> = [];
    if (normalized.startsWith("select to_regclass")) {
      rows = [{ relation: this.historyTableExists ? "flower_internal.schema_migrations" : null }];
    } else if (normalized.includes("from flower_internal.schema_migrations")) {
      rows = this.history.map((entry) => ({
        id: entry.id,
        module_id: entry.moduleId,
        module_version: entry.moduleVersion,
        source_digest: entry.sourceDigest
      }));
    } else if (normalized === "select true as verified;") {
      rows = [{ verified: this.verificationValue }];
    }
    return { rows: rows as Row[] };
  }
}

class FakePoolClient extends FakePostgres {
  releasedWith?: Error;

  release(error?: Error): void {
    this.releasedWith = error;
  }
}

class FakePool {
  readonly client = new FakePoolClient();
  connections = 0;

  async connect(): Promise<FakePoolClient> {
    this.connections += 1;
    return this.client;
  }
}

describe("PostgreSQL migration history", () => {
  it("discovers an absent history table without writing", async () => {
    const client = new FakePostgres();
    await expect(readPostgresMigrationHistory(client)).resolves.toEqual([]);
    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]?.text).toContain("to_regclass");
    expect(client.historyTableExists).toBe(false);
  });

  it("maps persisted rows into planner history", async () => {
    const catalog = await migrationCatalog();
    const action = createMigrationPlan(catalog, ["auth"]).actions[0]!;
    const client = new FakePostgres();
    client.historyTableExists = true;
    client.history = [{
      id: action.id,
      moduleId: action.moduleId,
      moduleVersion: action.moduleVersion,
      sourceDigest: action.sourceDigest
    }];
    await expect(readPostgresMigrationHistory(client)).resolves.toEqual(client.history);
  });
});

describe("transactional PostgreSQL migration execution", () => {
  it("keeps the whole transaction on one checked-out node-postgres client", async () => {
    const catalog = await migrationCatalog();
    const plan = createMigrationPlan(catalog, ["organizations"]);
    const pool = new FakePool();

    await expect(applyNodePostgresMigrationPlan(pool, plan, catalog)).resolves.toEqual(expect.objectContaining({
      status: "completed"
    }));
    expect(pool.connections).toBe(1);
    expect(pool.client.releasedWith).toBeUndefined();
    expect(pool.client.queries[0]?.text).toBe("begin;");
    expect(pool.client.queries.at(-1)?.text).toBe("commit;");
  });

  it("discards a pooled connection after execution failure", async () => {
    const catalog = await migrationCatalog();
    const plan = createMigrationPlan(catalog, ["organizations"]);
    const pool = new FakePool();
    pool.client.failWhenSqlIncludes = "-- organizations-002";

    await expect(applyNodePostgresMigrationPlan(pool, plan, catalog)).rejects.toMatchObject({
      code: "migration.executionFailed"
    });
    expect(pool.client.releasedWith).toBeInstanceOf(Error);
  });

  it("locks, applies SQL in order, and records history atomically", async () => {
    const catalog = await migrationCatalog();
    const plan = createMigrationPlan(catalog, ["organizations"]);
    const client = new FakePostgres();
    const result = await applyPostgresMigrationPlan(plan, catalog, client);

    expect(result).toEqual({
      status: "completed",
      planId: plan.planId,
      appliedMigrations: ["auth-001", "organizations-001", "organizations-002"]
    });
    expect(client.history.map(({ id }) => id)).toEqual(result.appliedMigrations);
    expect(client.queries[0]?.text).toBe("begin;");
    expect(client.queries[1]?.text).toContain("pg_advisory_xact_lock");
    expect(client.queries.at(-1)?.text).toBe("commit;");
    const executedSql = client.queries.filter(({ text }) => text.includes("select 1;")).map(({ text }) => text.split("\n")[0]);
    expect(executedSql).toEqual(["-- auth-001", "-- organizations-001", "-- organizations-002"]);
  });

  it("verifies an unchanged plan inside the lock without reapplying SQL", async () => {
    const catalog = await migrationCatalog();
    const client = new FakePostgres();
    const first = createMigrationPlan(catalog, ["organizations"]);
    await applyPostgresMigrationPlan(first, catalog, client);
    client.queries = [];
    const history = await readPostgresMigrationHistory(client);
    client.queries = [];
    const repeated = createMigrationPlan(catalog, ["organizations"], history);

    await expect(applyPostgresMigrationPlan(repeated, catalog, client)).resolves.toEqual({
      status: "unchanged",
      planId: repeated.planId,
      appliedMigrations: []
    });
    expect(client.queries.some(({ text }) => text.includes("select 1;"))).toBe(false);
    expect(client.queries.at(-1)?.text).toBe("commit;");
  });

  it("rejects stale history after acquiring the transaction lock", async () => {
    const catalog = await migrationCatalog();
    const plan = createMigrationPlan(catalog, ["organizations"]);
    const client = new FakePostgres();
    client.historyTableExists = true;
    client.history = [{
      id: plan.actions[0]!.id,
      moduleId: plan.actions[0]!.moduleId,
      moduleVersion: plan.actions[0]!.moduleVersion,
      sourceDigest: plan.actions[0]!.sourceDigest
    }];

    await expect(applyPostgresMigrationPlan(plan, catalog, client)).rejects.toMatchObject({
      code: "migration.historyChanged",
      rollbackComplete: true
    });
    expect(client.queries.at(-1)?.text).toBe("rollback;");
    expect(client.history).toHaveLength(1);
  });

  it("rolls back SQL and history together when a migration fails", async () => {
    const catalog = await migrationCatalog();
    const plan = createMigrationPlan(catalog, ["organizations"]);
    const client = new FakePostgres();
    client.failWhenSqlIncludes = "-- organizations-002";

    await expect(applyPostgresMigrationPlan(plan, catalog, client)).rejects.toMatchObject({
      code: "migration.executionFailed",
      rollbackComplete: true
    });
    expect(client.queries.at(-1)?.text).toBe("rollback;");
    expect(client.history).toEqual([]);
    expect(client.historyTableExists).toBe(false);
  });

  it("rolls back when a declared verification query fails", async () => {
    const catalog = await migrationCatalog();
    const plan = createMigrationPlan(catalog, ["auth"]);
    const client = new FakePostgres();
    client.verificationValue = false;

    await expect(applyPostgresMigrationPlan(plan, catalog, client)).rejects.toMatchObject({
      code: "migration.verificationFailed",
      rollbackComplete: true
    });
    expect(client.queries.at(-1)?.text).toBe("rollback;");
    expect(client.history).toEqual([]);
  });

  it("requires explicit approval for destructive migrations", async () => {
    const catalog = await migrationCatalog();
    const auth = catalog.find(({ manifest }) => manifest.id === "auth")!;
    const descriptorPath = auth.migrations[0]!.descriptorPath;
    const descriptor = await json(descriptorPath);
    descriptor.destructive = "destructive";
    await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
    const reloaded = await loadModuleCatalog(
      path.dirname(auth.root),
      await json(path.join(root, "schemas/module/v1.json")),
      await json(path.join(root, "schemas/migration/v1.json"))
    );
    const plan = createMigrationPlan(reloaded, ["auth"]);

    await expect(applyPostgresMigrationPlan(plan, reloaded, new FakePostgres())).rejects.toMatchObject({
      code: "migration.approvalRequired"
    });
    await expect(applyPostgresMigrationPlan(plan, reloaded, new FakePostgres(), {
      approvedDestructiveMigrationIds: ["auth-001"]
    })).resolves.toEqual(expect.objectContaining({ status: "completed" }));
  });

  it("detects source changes before opening a transaction", async () => {
    const catalog = await migrationCatalog();
    const plan = createMigrationPlan(catalog, ["organizations"]);
    await writeFile(catalog[0]!.migrations[0]!.sourcePath, "select 99;\n");
    const client = new FakePostgres();

    await expect(applyPostgresMigrationPlan(plan, catalog, client)).rejects.toMatchObject({ code: "migration.packageChanged" });
    expect(client.queries).toEqual([]);
  });

  it("rechecks already-applied package sources before accepting a no-op", async () => {
    const catalog = await migrationCatalog();
    const initial = createMigrationPlan(catalog, ["auth"]);
    const client = new FakePostgres();
    await applyPostgresMigrationPlan(initial, catalog, client);
    const history = await readPostgresMigrationHistory(client);
    const unchanged = createMigrationPlan(catalog, ["auth"], history);
    await writeFile(catalog[0]!.migrations[0]!.sourcePath, "select 99;\n");
    client.queries = [];

    await expect(applyPostgresMigrationPlan(unchanged, catalog, client)).rejects.toMatchObject({
      code: "migration.packageChanged"
    });
    expect(client.queries).toEqual([]);
  });

  it("rejects migration-owned transaction control before opening a transaction", async () => {
    const catalog = await migrationCatalog();
    const auth = catalog.find(({ manifest }) => manifest.id === "auth")!;
    await writeFile(auth.migrations[0]!.sourcePath, "-- COMMIT in a comment is harmless\nselect 'BEGIN';\ncommit;\n");
    const reloaded = await loadModuleCatalog(
      path.dirname(auth.root),
      await json(path.join(root, "schemas/module/v1.json")),
      await json(path.join(root, "schemas/migration/v1.json"))
    );
    const plan = createMigrationPlan(reloaded, ["auth"]);
    const client = new FakePostgres();

    await expect(applyPostgresMigrationPlan(plan, reloaded, client)).rejects.toMatchObject({
      code: "migration.transactionControl"
    });
    expect(client.queries).toEqual([]);
  });
});
