import { createHmac } from "node:crypto";
import type { PostgresMigrationClient } from "./postgres-migration.js";

export type RateLimitScope = "ip" | "user" | "organization";
export type UsageQuotaScope = "user" | "organization";
export type UsageQuotaPeriod = "day" | "month";

export interface RateLimitCheck {
  scope: RateLimitScope;
  subjectHash: string;
  operation: string;
  windowSeconds: number;
  limit: number;
  cost?: number;
}

export interface UsageQuotaCheck {
  scope: UsageQuotaScope;
  subjectId: string;
  metric: string;
  period: UsageQuotaPeriod;
  limit: number;
  cost?: number;
}

export interface DurableUsagePolicyRequest {
  rateLimit: RateLimitCheck;
  quota?: UsageQuotaCheck;
}

export interface DurableUsagePolicyDecision {
  allowed: boolean;
  deniedBy?: "rate-limit" | "quota";
  rateLimit: { remaining: number; resetAt: string };
  quota?: { remaining: number; resetAt: string };
}

interface CounterRow extends Record<string, unknown> {
  allowed: unknown;
  remaining: unknown;
  reset_at: unknown;
}

export class UsagePolicyError extends Error {
  readonly code: "usage.invalidRequest" | "usage.invalidResponse" | "usage.unavailable";
  readonly cause?: unknown;

  constructor(message: string, code: UsagePolicyError["code"], cause?: unknown) {
    super(message);
    this.name = "UsagePolicyError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new UsagePolicyError(`${field} must be a positive safe integer`, "usage.invalidRequest");
  }
}

function assertIdentifier(value: string, field: string): void {
  if (!/^[a-z][a-z0-9_.:-]{0,99}$/.test(value)) {
    throw new UsagePolicyError(`${field} must be a lowercase stable identifier`, "usage.invalidRequest");
  }
}

function validateRequest(request: DurableUsagePolicyRequest): void {
  if (!["ip", "user", "organization"].includes(request.rateLimit.scope)) {
    throw new UsagePolicyError("rateLimit.scope is unsupported", "usage.invalidRequest");
  }
  if (!/^[a-f0-9]{64}$/.test(request.rateLimit.subjectHash)) {
    throw new UsagePolicyError("rateLimit.subjectHash must be a lowercase SHA-256 digest", "usage.invalidRequest");
  }
  assertIdentifier(request.rateLimit.operation, "rateLimit.operation");
  assertPositiveInteger(request.rateLimit.windowSeconds, "rateLimit.windowSeconds");
  assertPositiveInteger(request.rateLimit.limit, "rateLimit.limit");
  assertPositiveInteger(request.rateLimit.cost ?? 1, "rateLimit.cost");
  if ([request.rateLimit.windowSeconds, request.rateLimit.limit, request.rateLimit.cost ?? 1].some((value) => value > 2_147_483_647)) {
    throw new UsagePolicyError("Rate-limit integer values exceed PostgreSQL integer capacity", "usage.invalidRequest");
  }
  if (request.quota) {
    if (!["user", "organization"].includes(request.quota.scope)) {
      throw new UsagePolicyError("quota.scope is unsupported", "usage.invalidRequest");
    }
    if (!["day", "month"].includes(request.quota.period)) {
      throw new UsagePolicyError("quota.period is unsupported", "usage.invalidRequest");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.quota.subjectId)) {
      throw new UsagePolicyError("quota.subjectId must be a UUID", "usage.invalidRequest");
    }
    assertIdentifier(request.quota.metric, "quota.metric");
    assertPositiveInteger(request.quota.limit, "quota.limit");
    assertPositiveInteger(request.quota.cost ?? 1, "quota.cost");
  }
}

function counterValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function counterResult(row: CounterRow | undefined, label: string): { allowed: boolean; remaining: number; resetAt: string } {
  const remaining = counterValue(row?.remaining);
  const date = row?.reset_at instanceof Date ? row.reset_at : typeof row?.reset_at === "string" ? new Date(row.reset_at) : undefined;
  if (typeof row?.allowed !== "boolean" || remaining === undefined || !date || Number.isNaN(date.valueOf())) {
    throw new UsagePolicyError(`PostgreSQL returned an invalid ${label} result`, "usage.invalidResponse");
  }
  return { allowed: row.allowed, remaining, resetAt: date.toISOString() };
}

export function hashRateLimitSubject(subject: string, secret: string): string {
  if (subject.length === 0) throw new UsagePolicyError("Rate-limit subject must not be empty", "usage.invalidRequest");
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new UsagePolicyError("Rate-limit hashing secret must be at least 32 bytes", "usage.invalidRequest");
  }
  return createHmac("sha256", secret).update(subject, "utf8").digest("hex");
}

export async function enforceDurableUsagePolicy(
  client: PostgresMigrationClient,
  request: DurableUsagePolicyRequest
): Promise<DurableUsagePolicyDecision> {
  validateRequest(request);
  try {
    const rateResponse = await client.query<CounterRow>(
      "select allowed, remaining, reset_at from flower_private.consume_rate_limit($1, $2, $3, $4, $5, $6);",
      [
        request.rateLimit.scope,
        request.rateLimit.subjectHash,
        request.rateLimit.operation,
        request.rateLimit.windowSeconds,
        request.rateLimit.limit,
        request.rateLimit.cost ?? 1
      ]
    );
    const rateCounter = counterResult(rateResponse.rows[0], "rate-limit");
    const rateLimit = { remaining: rateCounter.remaining, resetAt: rateCounter.resetAt };
    if (!rateCounter.allowed) return { allowed: false, deniedBy: "rate-limit", rateLimit };
    if (!request.quota) return { allowed: true, rateLimit };

    const quotaResponse = await client.query<CounterRow>(
      "select allowed, remaining, reset_at from flower_private.consume_usage_quota($1, $2, $3, $4, $5, $6);",
      [request.quota.scope, request.quota.subjectId, request.quota.metric, request.quota.period, request.quota.limit, request.quota.cost ?? 1]
    );
    const quotaCounter = counterResult(quotaResponse.rows[0], "quota");
    const quota = { remaining: quotaCounter.remaining, resetAt: quotaCounter.resetAt };
    return quotaCounter.allowed
      ? { allowed: true, rateLimit, quota }
      : { allowed: false, deniedBy: "quota", rateLimit, quota };
  } catch (error) {
    if (error instanceof UsagePolicyError) throw error;
    throw new UsagePolicyError("Durable usage policy storage is unavailable", "usage.unavailable", error);
  }
}
