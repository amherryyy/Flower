/** Flower-managed append-only audit integration contract. */
export const flowerAuditModule = Object.freeze({
  id: {{moduleIdJson}},
  version: {{moduleVersionJson}},
  capabilities: ["audit-event", "audit-trail", "append-only-storage", "sensitive-payload-rejection"] as const,
  dependencies: ["rbac"] as const,
  scope: "organization" as const,
  databaseFunction: "flower_private.append_audit_event" as const,
  requiredChecks: ["audit-contract"] as const
});

export type FlowerAuditModule = typeof flowerAuditModule;
