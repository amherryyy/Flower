import type { PostgresMigrationClient } from "./postgres-migration.js";

export type RlsScenarioExpectation =
  | { kind: "scalar-equals"; value: boolean | string | number | null }
  | { kind: "error"; sqlState?: string };

export interface RlsBehaviorScenario {
  id: string;
  role: string;
  userId: string | null;
  sql: string;
  values?: readonly unknown[];
  expected: RlsScenarioExpectation;
}

export interface RlsBehaviorDiagnostic {
  code: "rls.invalidScenario" | "rls.unexpectedResult" | "rls.expectedDenial" | "rls.unexpectedError" | "rls.rollbackFailed";
  scenarioId: string;
  message: string;
}

export interface RlsBehaviorResult {
  valid: boolean;
  scenarios: Array<{ id: string; passed: boolean }>;
  diagnostics: RlsBehaviorDiagnostic[];
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export async function runPostgresRlsScenarios(
  client: PostgresMigrationClient,
  scenarios: readonly RlsBehaviorScenario[]
): Promise<RlsBehaviorResult> {
  const diagnostics: RlsBehaviorDiagnostic[] = [];
  const results: Array<{ id: string; passed: boolean }> = [];
  const seen = new Set<string>();
  for (const scenario of scenarios) {
    let passed = false;
    if (seen.has(scenario.id) || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(scenario.id) || !/^[a-z_][a-z0-9_]*$/.test(scenario.role)) {
      diagnostics.push({ code: "rls.invalidScenario", scenarioId: scenario.id, message: "Scenario id or database role is invalid or duplicated" });
      results.push({ id: scenario.id, passed: false });
      continue;
    }
    seen.add(scenario.id);
    await client.query("begin;");
    try {
      await client.query(`set local role "${scenario.role}";`);
      await client.query("select set_config('request.jwt.claim.sub', $1, true);", [scenario.userId ?? ""]);
      const queryResult = await client.query(scenario.sql, scenario.values);
      if (scenario.expected.kind === "error") {
        diagnostics.push({ code: "rls.expectedDenial", scenarioId: scenario.id, message: "Scenario succeeded but an authorization error was expected" });
      } else {
        const row = queryResult.rows[0];
        const values = row ? Object.values(row) : [];
        passed = queryResult.rows.length === 1 && values.length === 1 && Object.is(values[0], scenario.expected.value);
        if (!passed) {
          diagnostics.push({ code: "rls.unexpectedResult", scenarioId: scenario.id, message: "Scenario result did not match its expected scalar" });
        }
      }
    } catch (error) {
      if (scenario.expected.kind === "error" && (!scenario.expected.sqlState || scenario.expected.sqlState === errorCode(error))) {
        passed = true;
      } else {
        diagnostics.push({
          code: "rls.unexpectedError",
          scenarioId: scenario.id,
          message: error instanceof Error ? error.message : "Scenario query failed"
        });
      }
    } finally {
      try {
        await client.query("rollback;");
      } catch (error) {
        passed = false;
        diagnostics.push({
          code: "rls.rollbackFailed",
          scenarioId: scenario.id,
          message: error instanceof Error ? error.message : "Scenario rollback failed"
        });
      }
    }
    results.push({ id: scenario.id, passed });
  }
  return { valid: diagnostics.length === 0 && results.every(({ passed }) => passed), scenarios: results, diagnostics };
}
