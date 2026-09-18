import { describe, expect, it } from "vitest";
import {
  enforceDurableUsagePolicy,
  hashRateLimitSubject,
  UsagePolicyError,
  type PostgresMigrationClient,
  type PostgresQueryResult
} from "../packages/kernel/src/index.js";

class UsageClient implements PostgresMigrationClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly responses: Array<Record<string, unknown>> = [];
  error?: Error;

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ text, values });
    if (this.error) throw this.error;
    return { rows: [this.responses.shift() as Row] };
  }
}

const secret = "a-server-only-rate-limit-pepper-at-least-32-bytes";
const subjectHash = hashRateLimitSubject("203.0.113.7", secret);
const baseRequest = {
  rateLimit: {
    scope: "ip" as const,
    subjectHash,
    operation: "auth.sign-in",
    windowSeconds: 60,
    limit: 10
  }
};

describe("durable rate limits and usage quotas", () => {
  it("HMACs sensitive subjects deterministically without retaining the input", () => {
    expect(subjectHash).toMatch(/^[a-f0-9]{64}$/);
    expect(subjectHash).toBe(hashRateLimitSubject("203.0.113.7", secret));
    expect(subjectHash).not.toContain("203.0.113.7");
    expect(() => hashRateLimitSubject("subject", "short")).toThrowError(
      expect.objectContaining({ code: "usage.invalidRequest" })
    );
  });

  it("allows a request after consuming both durable counters", async () => {
    const client = new UsageClient();
    client.responses.push(
      { allowed: true, remaining: 9, reset_at: "2026-09-19T01:01:00.000Z" },
      { allowed: true, remaining: "950", reset_at: new Date("2026-09-20T00:00:00.000Z") }
    );
    const result = await enforceDurableUsagePolicy(client, {
      ...baseRequest,
      quota: {
        scope: "organization",
        subjectId: "123e4567-e89b-42d3-a456-426614174000",
        metric: "ai.tokens",
        period: "day",
        limit: 1000,
        cost: 50
      }
    });
    expect(result).toEqual({
      allowed: true,
      rateLimit: { remaining: 9, resetAt: "2026-09-19T01:01:00.000Z" },
      quota: { remaining: 950, resetAt: "2026-09-20T00:00:00.000Z" }
    });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.text).toContain("consume_rate_limit");
    expect(client.calls[1]?.text).toContain("consume_usage_quota");
  });

  it("does not attempt quota consumption after rate-limit denial", async () => {
    const client = new UsageClient();
    client.responses.push({ allowed: false, remaining: 0, reset_at: "2026-09-19T01:01:00.000Z" });
    const result = await enforceDurableUsagePolicy(client, {
      ...baseRequest,
      quota: {
        scope: "user",
        subjectId: "123e4567-e89b-42d3-a456-426614174000",
        metric: "ai.requests",
        period: "month",
        limit: 100
      }
    });
    expect(result).toEqual(expect.objectContaining({ allowed: false, deniedBy: "rate-limit" }));
    expect(client.calls).toHaveLength(1);
  });

  it("returns an explicit quota denial after retaining the rate-limit charge", async () => {
    const client = new UsageClient();
    client.responses.push(
      { allowed: true, remaining: 8, reset_at: "2026-09-19T01:01:00.000Z" },
      { allowed: false, remaining: "0", reset_at: "2026-10-01T00:00:00.000Z" }
    );
    const result = await enforceDurableUsagePolicy(client, {
      ...baseRequest,
      quota: {
        scope: "user",
        subjectId: "123e4567-e89b-42d3-a456-426614174000",
        metric: "ai.tokens",
        period: "month",
        limit: 5000
      }
    });
    expect(result).toEqual(expect.objectContaining({ allowed: false, deniedBy: "quota" }));
    expect(client.calls).toHaveLength(2);
  });

  it("rejects malformed requests before touching storage", async () => {
    const client = new UsageClient();
    await expect(enforceDurableUsagePolicy(client, {
      rateLimit: { ...baseRequest.rateLimit, subjectHash: "raw-ip-address" }
    })).rejects.toEqual(expect.objectContaining({ code: "usage.invalidRequest" }));
    expect(client.calls).toHaveLength(0);
  });

  it("fails closed when durable storage is unavailable", async () => {
    const client = new UsageClient();
    client.error = new Error("database offline");
    await expect(enforceDurableUsagePolicy(client, baseRequest)).rejects.toEqual(
      expect.objectContaining<Partial<UsagePolicyError>>({ code: "usage.unavailable" })
    );
  });
});
