import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectPostgresRlsBaseline,
  loadModuleCatalog,
  type PostgresMigrationClient,
  type PostgresQueryResult
} from "../packages/kernel/src/index.js";

const root = path.resolve(import.meta.dirname, "..");

async function json(filePath: string): Promise<object> {
  return JSON.parse(await readFile(filePath, "utf8")) as object;
}

async function catalog() {
  return loadModuleCatalog(
    path.join(root, "modules"),
    await json(path.join(root, "schemas/module/v1.json")),
    await json(path.join(root, "schemas/migration/v1.json"))
  );
}

interface TableState {
  relation_exists: boolean;
  rls_enabled: boolean;
  policy_count: number;
  public_select: boolean;
  public_insert: boolean;
  public_update: boolean;
  public_delete: boolean;
}

class RlsCatalogClient implements PostgresMigrationClient {
  readonly states = new Map<string, TableState>();

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    _text: string,
    values: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    const table = values[0] as string;
    const state = this.states.get(table) ?? {
      relation_exists: true,
      rls_enabled: true,
      policy_count: 1,
      public_select: false,
      public_insert: false,
      public_update: false,
      public_delete: false
    };
    return { rows: [state as unknown as Row] };
  }
}

describe("PostgreSQL RLS baseline inspection", () => {
  it("accepts the declared fail-closed official baseline", async () => {
    await expect(inspectPostgresRlsBaseline(new RlsCatalogClient(), await catalog())).resolves.toEqual({
      valid: true,
      diagnostics: []
    });
  });

  it("reports missing tables, disabled RLS, public privileges, and unexpected policies", async () => {
    const client = new RlsCatalogClient();
    client.states.set("public.audit_events", {
      relation_exists: false,
      rls_enabled: false,
      policy_count: 0,
      public_select: false,
      public_insert: false,
      public_update: false,
      public_delete: false
    });
    client.states.set("public.organizations", {
      relation_exists: true,
      rls_enabled: false,
      policy_count: 0,
      public_select: false,
      public_insert: true,
      public_update: false,
      public_delete: false
    });
    client.states.set("public.roles", {
      relation_exists: true,
      rls_enabled: true,
      policy_count: 0,
      public_select: false,
      public_insert: false,
      public_update: false,
      public_delete: false
    });

    const result = await inspectPostgresRlsBaseline(client, await catalog());
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "rls.missingTable",
      "rls.disabled",
      "rls.publicPrivilege",
      "rls.missingPolicy"
    ]));
  });

  it("uses the latest descriptor expectation when a table advances to policies-required", async () => {
    const modules = await catalog();
    const client = new RlsCatalogClient();
    client.states.set("public.audit_events", {
      relation_exists: true,
      rls_enabled: true,
      policy_count: 0,
      public_select: false,
      public_insert: false,
      public_update: false,
      public_delete: false
    });
    const result = await inspectPostgresRlsBaseline(client, modules);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "rls.missingPolicy",
      table: "public.audit_events"
    }));
  });
});
