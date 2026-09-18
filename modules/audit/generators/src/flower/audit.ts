/** Flower-managed audit integration contract. Durable storage arrives in F4. */
export const flowerAuditModule = Object.freeze({
  id: {{moduleIdJson}},
  version: {{moduleVersionJson}},
  capabilities: ["audit-event", "audit-trail"] as const,
  dependencies: ["rbac"] as const,
  scope: "organization" as const,
  requiredChecks: ["audit-contract"] as const
});

export type FlowerAuditModule = typeof flowerAuditModule;
