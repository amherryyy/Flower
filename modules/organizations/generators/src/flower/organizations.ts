/** Flower-managed organization integration contract. Runtime enforcement arrives in F4. */
export const flowerOrganizationsModule = Object.freeze({
  id: {{moduleIdJson}},
  version: {{moduleVersionJson}},
  capabilities: ["organization", "membership"] as const,
  dependencies: ["auth"] as const,
  membershipModel: "explicit" as const,
  requiredChecks: ["organization-contract"] as const
});

export type FlowerOrganizationsModule = typeof flowerOrganizationsModule;
