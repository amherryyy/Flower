import type { PostgresMigrationClient } from "./postgres-migration.js";
import type { MigrationDescriptor, VerifiedModulePackage } from "./types.js";

export interface RlsDiagnostic {
  code: "rls.missingTable" | "rls.disabled" | "rls.publicPrivilege" | "rls.unexpectedPolicy" | "rls.missingPolicy" | "rls.invalidInspection";
  table: string;
  message: string;
}

export interface RlsInspectionResult {
  valid: boolean;
  diagnostics: RlsDiagnostic[];
}

interface RlsCatalogRow extends Record<string, unknown> {
  relation_exists: unknown;
  rls_enabled: unknown;
  policy_count: unknown;
  public_select: unknown;
  public_insert: unknown;
  public_update: unknown;
  public_delete: unknown;
}

const INSPECT_RLS_SQL = `
select
  to_regclass($1) is not null as relation_exists,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass($1)), false) as rls_enabled,
  coalesce((select count(*)::int from pg_policies where schemaname = $2 and tablename = $3), 0) as policy_count,
  coalesce(has_table_privilege('public', to_regclass($1), 'select'), false) as public_select,
  coalesce(has_table_privilege('public', to_regclass($1), 'insert'), false) as public_insert,
  coalesce(has_table_privilege('public', to_regclass($1), 'update'), false) as public_update,
  coalesce(has_table_privilege('public', to_regclass($1), 'delete'), false) as public_delete;
`;

function expectations(packages: readonly VerifiedModulePackage[]): Map<string, MigrationDescriptor["rls"]["mode"]> {
  const result = new Map<string, MigrationDescriptor["rls"]["mode"]>();
  for (const modulePackage of packages) {
    for (const migration of modulePackage.migrations) {
      for (const table of migration.descriptor.rls.tables) {
        result.set(table, migration.descriptor.rls.mode);
      }
    }
  }
  return result;
}

export async function inspectPostgresRlsBaseline(
  client: PostgresMigrationClient,
  packages: readonly VerifiedModulePackage[]
): Promise<RlsInspectionResult> {
  const expected = expectations(packages);

  const diagnostics: RlsDiagnostic[] = [];
  for (const [table, mode] of [...expected].sort(([left], [right]) => left.localeCompare(right))) {
    const [schemaName, tableName] = table.split(".") as [string, string];
    const result = await client.query<RlsCatalogRow>(INSPECT_RLS_SQL, [table, schemaName, tableName]);
    const row = result.rows[0];
    if (!row || typeof row.relation_exists !== "boolean" || typeof row.rls_enabled !== "boolean" || typeof row.policy_count !== "number") {
      diagnostics.push({ code: "rls.invalidInspection", table, message: "PostgreSQL returned an invalid RLS inspection row" });
      continue;
    }
    if (!row.relation_exists) {
      diagnostics.push({ code: "rls.missingTable", table, message: `Expected table '${table}' does not exist` });
      continue;
    }
    if (!row.rls_enabled) diagnostics.push({ code: "rls.disabled", table, message: `RLS is disabled for '${table}'` });
    for (const privilege of ["public_select", "public_insert", "public_update", "public_delete"] as const) {
      if (row[privilege] === true) {
        diagnostics.push({ code: "rls.publicPrivilege", table, message: `Role public retains ${privilege.slice("public_".length).toUpperCase()} on '${table}'` });
      }
    }
    if (mode === "deny-by-default" && row.policy_count !== 0) {
      diagnostics.push({ code: "rls.unexpectedPolicy", table, message: `Fail-closed table '${table}' unexpectedly has ${row.policy_count} policies` });
    }
    if (mode === "policies-required" && row.policy_count === 0) {
      diagnostics.push({ code: "rls.missingPolicy", table, message: `Table '${table}' requires at least one RLS policy` });
    }
  }
  return { valid: diagnostics.length === 0, diagnostics };
}
