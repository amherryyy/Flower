import { readFile } from "node:fs/promises";
import { MigrationPlanError, verifyMigrationPlan } from "./migration.js";
import { sha256 } from "./template.js";
import type { AppliedMigration, MigrationPlan, VerifiedModulePackage } from "./types.js";

export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
}

export interface PostgresMigrationClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>>;
}

export interface MigrationExecutionResult {
  status: "completed" | "unchanged";
  planId: string;
  appliedMigrations: string[];
}

export class MigrationExecutionError extends Error {
  readonly code: string;
  readonly rollbackComplete: boolean;

  constructor(message: string, code: string, rollbackComplete = true) {
    super(message);
    this.name = "MigrationExecutionError";
    this.code = code;
    this.rollbackComplete = rollbackComplete;
  }
}

interface HistoryRow extends Record<string, unknown> {
  id: unknown;
  module_id: unknown;
  module_version: unknown;
  source_digest: unknown;
}

const HISTORY_RELATION = "flower_internal.schema_migrations";

const CREATE_HISTORY_SQL = `
create schema if not exists flower_internal;
create table if not exists flower_internal.schema_migrations (
  sequence bigint generated always as identity unique,
  id text primary key,
  module_id text not null,
  module_version text not null,
  source_digest text not null,
  plan_id text not null,
  applied_at timestamptz not null default statement_timestamp()
);
`;

const SELECT_HISTORY_SQL = `
select id, module_id, module_version, source_digest
from flower_internal.schema_migrations
order by sequence;
`;

function historyRow(row: HistoryRow, index: number): AppliedMigration {
  for (const field of ["id", "module_id", "module_version", "source_digest"] as const) {
    if (typeof row[field] !== "string" || row[field].length === 0) {
      throw new MigrationExecutionError(
        `Migration history row ${index + 1} has an invalid '${field}' value`,
        "migration.invalidHistoryRow"
      );
    }
  }
  return {
    id: row.id as string,
    moduleId: row.module_id as string,
    moduleVersion: row.module_version as string,
    sourceDigest: row.source_digest as string
  };
}

async function selectHistory(client: PostgresMigrationClient): Promise<AppliedMigration[]> {
  const result = await client.query<HistoryRow>(SELECT_HISTORY_SQL);
  return result.rows.map(historyRow);
}

export async function readPostgresMigrationHistory(client: PostgresMigrationClient): Promise<AppliedMigration[]> {
  const relation = await client.query<{ relation: unknown }>(
    "select to_regclass($1)::text as relation;",
    [HISTORY_RELATION]
  );
  const value = relation.rows[0]?.relation;
  if (value === null || value === undefined) return [];
  if (typeof value !== "string" || value !== HISTORY_RELATION) {
    throw new MigrationExecutionError("PostgreSQL returned an invalid migration history relation", "migration.invalidHistoryRelation");
  }
  return selectHistory(client);
}

function historiesMatch(left: readonly AppliedMigration[], right: readonly AppliedMigration[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other !== undefined &&
      entry.id === other.id &&
      entry.moduleId === other.moduleId &&
      entry.moduleVersion === other.moduleVersion &&
      entry.sourceDigest === other.sourceDigest;
  });
}

function executableSql(source: string): string {
  let output = "";
  let index = 0;
  let blockDepth = 0;
  let dollarDelimiter: string | undefined;
  let state: "normal" | "single" | "double" | "line-comment" | "block-comment" | "dollar" = "normal";
  while (index < source.length) {
    const current = source[index]!;
    const next = source[index + 1];
    if (state === "normal") {
      if (current === "'" || current === '"') {
        state = current === "'" ? "single" : "double";
        output += " ";
        index += 1;
        continue;
      }
      if (current === "-" && next === "-") {
        state = "line-comment";
        output += "  ";
        index += 2;
        continue;
      }
      if (current === "/" && next === "*") {
        state = "block-comment";
        blockDepth = 1;
        output += "  ";
        index += 2;
        continue;
      }
      if (current === "$") {
        const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
        if (match) {
          state = "dollar";
          dollarDelimiter = match[0];
          output += " ".repeat(match[0].length);
          index += match[0].length;
          continue;
        }
      }
      output += current;
      index += 1;
      continue;
    }
    if (state === "line-comment") {
      if (current === "\n") {
        state = "normal";
        output += "\n";
      } else output += " ";
      index += 1;
      continue;
    }
    if (state === "block-comment") {
      if (current === "/" && next === "*") {
        blockDepth += 1;
        output += "  ";
        index += 2;
      } else if (current === "*" && next === "/") {
        blockDepth -= 1;
        output += "  ";
        index += 2;
        if (blockDepth === 0) state = "normal";
      } else {
        output += current === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    if (state === "dollar") {
      if (dollarDelimiter && source.startsWith(dollarDelimiter, index)) {
        output += " ".repeat(dollarDelimiter.length);
        index += dollarDelimiter.length;
        dollarDelimiter = undefined;
        state = "normal";
      } else {
        output += current === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    const quote = state === "single" ? "'" : '"';
    if (current === quote && next === quote) {
      output += "  ";
      index += 2;
    } else if (current === quote) {
      state = "normal";
      output += " ";
      index += 1;
    } else {
      output += current === "\n" ? "\n" : " ";
      index += 1;
    }
  }
  return output;
}

function assertNoTransactionControl(id: string, source: string): void {
  const sql = executableSql(source);
  if (/(?:^|;)\s*(?:begin\b|start\s+transaction\b|commit\b|end\b|rollback\b|abort\b|savepoint\b|release\s+savepoint\b|prepare\s+transaction\b)/iu.test(sql)) {
    throw new MigrationExecutionError(
      `Migration '${id}' contains transaction-control SQL; Flower owns the transaction boundary`,
      "migration.transactionControl"
    );
  }
}

export async function applyPostgresMigrationPlan(
  plan: MigrationPlan,
  packages: readonly VerifiedModulePackage[],
  client: PostgresMigrationClient
): Promise<MigrationExecutionResult> {
  try {
    verifyMigrationPlan(plan);
  } catch (error) {
    if (error instanceof MigrationPlanError) {
      throw new MigrationExecutionError(error.message, error.code);
    }
    throw error;
  }

  const packagesById = new Map(packages.map((modulePackage) => [modulePackage.manifest.id, modulePackage]));
  const sources = new Map<string, string>();
  const pendingIds = new Set(plan.actions.map(({ id }) => id));
  for (const plannedMigration of [...plan.applied, ...plan.actions]) {
    const modulePackage = packagesById.get(plannedMigration.moduleId);
    const migration = modulePackage?.migrations.find((candidate) => candidate.id === plannedMigration.id);
    if (
      !modulePackage ||
      modulePackage.manifest.version !== plannedMigration.moduleVersion ||
      !migration ||
      migration.sourceDigest !== plannedMigration.sourceDigest
    ) {
      throw new MigrationExecutionError(`Migration package changed after planning: ${plannedMigration.id}`, "migration.packageChanged");
    }
    const source = await readFile(migration.sourcePath);
    if (sha256(source) !== plannedMigration.sourceDigest) {
      throw new MigrationExecutionError(`Migration source changed after planning: ${plannedMigration.id}`, "migration.packageChanged");
    }
    if (pendingIds.has(plannedMigration.id)) {
      const sql = source.toString("utf8");
      assertNoTransactionControl(plannedMigration.id, sql);
      sources.set(plannedMigration.id, sql);
    }
  }

  let transactionStarted = false;
  try {
    await client.query("begin;");
    transactionStarted = true;
    await client.query("select pg_advisory_xact_lock(hashtextextended('flower:migrations', 0));");
    await client.query(CREATE_HISTORY_SQL);
    const currentHistory = await selectHistory(client);
    if (!historiesMatch(currentHistory, plan.applied)) {
      throw new MigrationExecutionError("Migration history changed after planning", "migration.historyChanged");
    }

    for (const action of plan.actions) {
      await client.query(sources.get(action.id)!);
      await client.query(
        `insert into flower_internal.schema_migrations
          (id, module_id, module_version, source_digest, plan_id)
         values ($1, $2, $3, $4, $5);`,
        [action.id, action.moduleId, action.moduleVersion, action.sourceDigest, plan.planId]
      );
    }
    await client.query("commit;");
    return {
      status: plan.actions.length === 0 ? "unchanged" : "completed",
      planId: plan.planId,
      appliedMigrations: plan.actions.map(({ id }) => id)
    };
  } catch (error) {
    if (!transactionStarted) {
      if (error instanceof MigrationExecutionError) throw error;
      throw new MigrationExecutionError(
        error instanceof Error ? `Unable to start migration transaction: ${error.message}` : "Unable to start migration transaction",
        "migration.transactionFailed"
      );
    }
    try {
      await client.query("rollback;");
    } catch (rollbackError) {
      const original = error instanceof Error ? error.message : "Migration execution failed";
      const rollback = rollbackError instanceof Error ? rollbackError.message : "rollback failed";
      throw new MigrationExecutionError(`${original}; rollback also failed: ${rollback}`, "migration.rollbackFailed", false);
    }
    if (error instanceof MigrationExecutionError) throw error;
    throw new MigrationExecutionError(
      error instanceof Error ? `Migration execution failed and was rolled back: ${error.message}` : "Migration execution failed and was rolled back",
      "migration.executionFailed"
    );
  }
}
