import { applyPostgresMigrationPlan, type MigrationExecutionOptions, type MigrationExecutionResult, type PostgresMigrationClient, type PostgresQueryResult } from "./postgres-migration.js";
import type { MigrationPlan, VerifiedModulePackage } from "./types.js";

export interface NodePostgresPoolClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[] }>;
  release(error?: Error): void;
}

export interface NodePostgresPool {
  connect(): Promise<NodePostgresPoolClient>;
}

export async function withNodePostgresMigrationClient<Result>(
  pool: NodePostgresPool,
  operation: (client: PostgresMigrationClient) => Promise<Result>
): Promise<Result> {
  const pooledClient = await pool.connect();
  const client: PostgresMigrationClient = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[]
    ): Promise<PostgresQueryResult<Row>> {
      const result = await pooledClient.query<Row>(text, values ? [...values] : undefined);
      return { rows: result.rows };
    }
  };
  let releaseError: Error | undefined;
  try {
    return await operation(client);
  } catch (error) {
    releaseError = error instanceof Error ? error : new Error("PostgreSQL migration operation failed");
    throw error;
  } finally {
    pooledClient.release(releaseError);
  }
}

export async function applyNodePostgresMigrationPlan(
  pool: NodePostgresPool,
  plan: MigrationPlan,
  packages: readonly VerifiedModulePackage[],
  options: MigrationExecutionOptions = {}
): Promise<MigrationExecutionResult> {
  return withNodePostgresMigrationClient(pool, (client) => applyPostgresMigrationPlan(plan, packages, client, options));
}
