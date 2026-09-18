import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  resolveModules,
  satisfiesSemVer,
  validateModuleManifest,
  type ModuleManifest
} from "../packages/kernel/src/index.js";

async function schema(): Promise<object> {
  return JSON.parse(await readFile(new URL("../schemas/module/v1.json", import.meta.url), "utf8")) as object;
}

function moduleManifest(id: string, overrides: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    $schema: "https://flower.dev/schemas/module/v1.json",
    schemaVersion: 1,
    id,
    version: "1.0.0",
    compatibleFlower: ">=0.1.0 <0.2.0",
    dependsOn: {},
    conflictsWith: [],
    provides: [`${id}-capability`],
    configurationSchema: "./schemas/config.json",
    migrations: [],
    generatedPaths: [`src/flower/${id}.ts`],
    requiredChecks: [`${id}-contract`],
    ...overrides
  };
}

describe("module manifest validation", () => {
  it("accepts a complete versioned module contract", async () => {
    const result = validateModuleManifest(await schema(), moduleManifest("auth", {
      migrations: ["auth-001"]
    }));
    expect(result).toEqual({ valid: true, diagnostics: [] });
  });

  it("rejects semantic self-dependencies and dependency/conflict overlap", async () => {
    const result = validateModuleManifest(await schema(), moduleManifest("auth", {
      dependsOn: { auth: "^1.0.0", organizations: "^1.0.0" },
      conflictsWith: ["auth", "organizations"]
    }));
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "module.selfDependency",
      "module.selfConflict",
      "module.dependencyConflict"
    ]));
  });
});

describe("module dependency resolution", () => {
  const auth = moduleManifest("auth");
  const organizations = moduleManifest("organizations", { dependsOn: { auth: "^1.0.0" } });
  const rbac = moduleManifest("rbac", { dependsOn: { organizations: ">=1.0.0 <2.0.0" } });

  it("resolves transitive dependencies in deterministic installation order", () => {
    const first = resolveModules([rbac, auth, organizations], ["rbac"]);
    const second = resolveModules([organizations, rbac, auth], ["rbac"]);
    expect(first).toEqual(second);
    expect(first.valid).toBe(true);
    expect(first.resolved).toEqual(["auth", "organizations", "rbac"]);
    expect(first.actions.map((action) => `${action.kind}:${action.moduleId}`)).toEqual([
      "install:auth",
      "install:organizations",
      "install:rbac"
    ]);
  });

  it("retains an already installed module at the resolved version", () => {
    const result = resolveModules([auth, organizations], ["organizations"], { auth: "1.0.0" });
    expect(result.valid).toBe(true);
    expect(result.actions).toContainEqual({ kind: "retain", moduleId: "auth", version: "1.0.0" });
  });

  it("fails closed for missing dependencies and incompatible versions", () => {
    const missing = resolveModules([organizations], ["organizations"]);
    expect(missing.valid).toBe(false);
    expect(missing.actions).toEqual([]);
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: "module.notFound" }));

    const mismatched = resolveModules([
      moduleManifest("auth", { version: "2.0.0" }),
      organizations
    ], ["organizations"]);
    expect(mismatched.valid).toBe(false);
    expect(mismatched.diagnostics).toContainEqual(expect.objectContaining({ code: "module.dependencyVersionMismatch" }));
  });

  it("reports Flower incompatibility, conflicts, installed mismatches, and cycles", () => {
    const future = moduleManifest("future", { compatibleFlower: ">=1.0.0" });
    const audit = moduleManifest("audit", { conflictsWith: ["legacy-audit"] });
    const cycleA = moduleManifest("cycle-a", { dependsOn: { "cycle-b": "1.0.0" } });
    const cycleB = moduleManifest("cycle-b", { dependsOn: { "cycle-a": "1.0.0" } });
    const result = resolveModules(
      [future, audit, cycleA, cycleB],
      ["future", "audit", "cycle-a"],
      { "legacy-audit": "1.0.0", audit: "0.9.0" }
    );
    expect(result.valid).toBe(false);
    expect(result.actions).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "module.incompatibleFlower",
      "module.conflict",
      "module.installedVersionMismatch",
      "module.dependencyCycle"
    ]));
  });
});

describe("semantic version ranges", () => {
  it("supports the bounded range forms used by Flower modules", () => {
    expect(satisfiesSemVer("1.4.2", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfiesSemVer("1.4.2", "^1.2.0")).toBe(true);
    expect(satisfiesSemVer("0.2.4", "^0.2.1")).toBe(true);
    expect(satisfiesSemVer("1.3.0", "~1.2.0")).toBe(false);
    expect(satisfiesSemVer("2.0.0", "^1.2.0 || >=2.0.0 <3.0.0")).toBe(true);
    expect(() => satisfiesSemVer("1.0.0", ">=1.0.0 ||")).toThrow(/empty alternative/);
    expect(() => satisfiesSemVer("1.0.0", "latest")).toThrow(/Unsupported/);
  });
});
