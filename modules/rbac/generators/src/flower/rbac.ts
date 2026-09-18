/** Flower-managed RBAC integration contract. Runtime enforcement arrives in F4. */
export const flowerRbacModule = Object.freeze({
  id: {{moduleIdJson}},
  version: {{moduleVersionJson}},
  capabilities: ["authorization", "permission", "role"] as const,
  dependencies: ["organizations"] as const,
  scope: "organization" as const,
  requiredChecks: ["rbac-contract"] as const
});

export type FlowerRbacModule = typeof flowerRbacModule;
