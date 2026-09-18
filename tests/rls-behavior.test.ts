import { describe, expect, it } from "vitest";
import {
  runPostgresRlsScenarios,
  type PostgresMigrationClient,
  type PostgresQueryResult
} from "../packages/kernel/src/index.js";

class BehaviorClient implements PostgresMigrationClient {
  queries: string[] = [];
  userId = "";

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.queries.push(text);
    if (text.startsWith("select set_config")) this.userId = values[0] as string;
    if (text === "select member_visibility;") {
      return { rows: [{ visible: this.userId === "member-user" } as unknown as Row] };
    }
    if (text === "insert protected_resource;") {
      const error = new Error("new row violates row-level security policy") as Error & { code: string };
      error.code = "42501";
      throw error;
    }
    return { rows: [] };
  }
}

describe("PostgreSQL RLS behavior scenarios", () => {
  it("isolates and evaluates member, cross-tenant, anonymous, and denied-write cases", async () => {
    const client = new BehaviorClient();
    const result = await runPostgresRlsScenarios(client, [
      {
        id: "member-can-read",
        role: "authenticated",
        userId: "member-user",
        sql: "select member_visibility;",
        expected: { kind: "scalar-equals", value: true }
      },
      {
        id: "cross-tenant-hidden",
        role: "authenticated",
        userId: "other-user",
        sql: "select member_visibility;",
        expected: { kind: "scalar-equals", value: false }
      },
      {
        id: "anonymous-hidden",
        role: "anon",
        userId: null,
        sql: "select member_visibility;",
        expected: { kind: "scalar-equals", value: false }
      },
      {
        id: "member-write-denied",
        role: "authenticated",
        userId: "member-user",
        sql: "insert protected_resource;",
        expected: { kind: "error", sqlState: "42501" }
      }
    ]);

    expect(result).toEqual({
      valid: true,
      scenarios: [
        { id: "member-can-read", passed: true },
        { id: "cross-tenant-hidden", passed: true },
        { id: "anonymous-hidden", passed: true },
        { id: "member-write-denied", passed: true }
      ],
      diagnostics: []
    });
    expect(client.queries.filter((query) => query === "begin;")).toHaveLength(4);
    expect(client.queries.filter((query) => query === "rollback;")).toHaveLength(4);
  });

  it("rejects unsafe role names without sending SQL", async () => {
    const client = new BehaviorClient();
    const result = await runPostgresRlsScenarios(client, [{
      id: "unsafe-role",
      role: "authenticated; reset role",
      userId: null,
      sql: "select member_visibility;",
      expected: { kind: "scalar-equals", value: false }
    }]);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "rls.invalidScenario" }));
    expect(client.queries).toEqual([]);
  });

  it("reports unexpected results and authorization errors", async () => {
    const result = await runPostgresRlsScenarios(new BehaviorClient(), [
      {
        id: "wrong-scalar",
        role: "authenticated",
        userId: "other-user",
        sql: "select member_visibility;",
        expected: { kind: "scalar-equals", value: true }
      },
      {
        id: "expected-error",
        role: "authenticated",
        userId: "member-user",
        sql: "select member_visibility;",
        expected: { kind: "error", sqlState: "42501" }
      }
    ]);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["rls.unexpectedResult", "rls.expectedDenial"]);
  });
});
