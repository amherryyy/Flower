import { describe, expect, it } from "vitest";
import {
  officialRlsBehaviorScenarios,
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
  it("provides canonical live cases for the official tenant model", () => {
    const scenarios = officialRlsBehaviorScenarios({
      organizationId: "00000000-0000-4000-8000-000000000001",
      ownerUserId: "00000000-0000-4000-8000-000000000002",
      memberUserId: "00000000-0000-4000-8000-000000000003",
      outsiderUserId: "00000000-0000-4000-8000-000000000004",
      auditEventId: "00000000-0000-4000-8000-000000000005",
      roleId: "00000000-0000-4000-8000-000000000006"
    });
    expect(scenarios.map(({ id }) => id)).toEqual([
      "member-sees-organization",
      "outsider-cannot-see-organization",
      "owner-with-permission-sees-audit",
      "member-without-permission-cannot-see-audit",
      "anonymous-cannot-read-organizations",
      "member-cannot-write-role-table",
      "last-owner-cannot-remove-self"
    ]);
    expect(scenarios.every(({ values }) => values?.length || values === undefined)).toBe(true);
  });

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
