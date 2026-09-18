/** Flower-managed durable rate-limit and usage-quota integration contract. */
export const flowerLimitsModule = Object.freeze({
  id: {{moduleIdJson}},
  version: {{moduleVersionJson}},
  capabilities: ["durable-rate-limit", "usage-quota", "counter-retention"] as const,
  dependencies: ["organizations"] as const,
  storage: "postgresql" as const,
  fallback: "fail-closed" as const,
  subjectProtection: "hmac-sha256" as const,
  databaseFunctions: [
    "flower_private.consume_rate_limit",
    "flower_private.consume_usage_quota",
    "flower_private.prune_limit_counters"
  ] as const,
  requiredChecks: ["durable-limits-contract"] as const
});

export type FlowerLimitsModule = typeof flowerLimitsModule;
