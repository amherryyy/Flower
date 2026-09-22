import { describe, expect, it } from "vitest";
import {
  resolveFrameworkVersion,
  type FlowerRelease,
  type ModuleManifest
} from "../packages/kernel/src/index.js";

function moduleManifest(id: string, version: string, compatibleFlower: string): ModuleManifest {
  return {
    schemaVersion: 1,
    id,
    version,
    compatibleFlower,
    dependsOn: {},
    conflictsWith: [],
    provides: [],
    configurationSchema: "./schemas/config.json",
    migrations: [],
    generatedPaths: [],
    requiredChecks: []
  };
}

const releases: FlowerRelease[] = [
  { version: "0.1.0", channel: "stable" },
  { version: "0.1.1", channel: "stable" },
  { version: "0.2.0-preview.1", channel: "preview" },
  { version: "0.2.0", channel: "stable" },
  { version: "0.3.0-dev.1", channel: "development" }
];

describe("F6 framework version resolution", () => {
  it("selects the highest channel-eligible release compatible with installed modules", () => {
    const input = {
      currentVersion: "0.1.0",
      channel: "development" as const,
      releases,
      installedModules: { auth: "1.0.0" },
      moduleCatalog: [moduleManifest("auth", "1.0.0", ">=0.1.0 <0.3.0-dev.1")]
    };
    const first = resolveFrameworkVersion(input);
    const second = resolveFrameworkVersion({
      ...input,
      releases: [...releases].reverse(),
      moduleCatalog: [...input.moduleCatalog].reverse()
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ valid: true, state: "update", targetVersion: "0.2.0" });
    expect(first.candidates.map(({ version, compatible }) => [version, compatible])).toEqual([
      ["0.3.0-dev.1", false],
      ["0.2.0", true],
      ["0.2.0-preview.1", true],
      ["0.1.1", true],
      ["0.1.0", true]
    ]);
  });

  it("enforces stable and preview channel boundaries", () => {
    const stable = resolveFrameworkVersion({ currentVersion: "0.1.0", channel: "stable", releases });
    const preview = resolveFrameworkVersion({ currentVersion: "0.1.0", channel: "preview", releases });

    expect(stable.targetVersion).toBe("0.2.0");
    expect(stable.candidates.map(({ channel }) => channel)).not.toContain("preview");
    expect(preview.candidates.map(({ version }) => version)).toContain("0.2.0-preview.1");
    expect(preview.candidates.map(({ channel }) => channel)).not.toContain("development");
  });

  it("never silently falls back from an explicit incompatible target", () => {
    const result = resolveFrameworkVersion({
      currentVersion: "0.1.0",
      channel: "development",
      requestedVersion: "0.3.0-dev.1",
      releases,
      installedModules: { auth: "1.0.0" },
      moduleCatalog: [moduleManifest("auth", "1.0.0", ">=0.1.0 <0.3.0-dev.1")]
    });

    expect(result.valid).toBe(false);
    expect(result.state).toBe("blocked");
    expect(result.targetVersion).toBeUndefined();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.modules[0]).toMatchObject({
      moduleId: "auth",
      compatible: false,
      reason: "flower-version-unsupported"
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "update.noCompatibleRelease" }));
  });

  it("rejects downgrades, missing releases, and channel escalation", () => {
    const downgrade = resolveFrameworkVersion({
      currentVersion: "0.2.0",
      channel: "development",
      requestedVersion: "0.1.1",
      releases
    });
    const missing = resolveFrameworkVersion({
      currentVersion: "0.1.0",
      channel: "stable",
      requestedVersion: "0.4.0",
      releases
    });
    const escalation = resolveFrameworkVersion({
      currentVersion: "0.1.0",
      channel: "stable",
      requestedVersion: "0.2.0-preview.1",
      releases
    });

    expect(downgrade.diagnostics).toContainEqual(expect.objectContaining({ code: "update.downgradeUnsupported" }));
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: "update.releaseNotFound" }));
    expect(escalation.diagnostics).toContainEqual(expect.objectContaining({ code: "update.channelBlocked" }));
  });

  it("fails closed for ambiguous or invalid catalogs and missing installed packages", () => {
    const ambiguous = resolveFrameworkVersion({
      currentVersion: "0.1.0",
      channel: "development",
      releases: [...releases, { version: "0.2.0", channel: "preview" }]
    });
    expect(ambiguous.diagnostics).toContainEqual(expect.objectContaining({ code: "update.duplicateRelease" }));

    const duplicatePackage = resolveFrameworkVersion({
      currentVersion: "0.1.0",
      channel: "stable",
      releases,
      moduleCatalog: [
        moduleManifest("auth", "1.0.0", ">=0.1.0 <0.3.0"),
        moduleManifest("auth", "1.0.0", ">=0.1.0 <0.3.0")
      ]
    });
    expect(duplicatePackage.diagnostics).toContainEqual(expect.objectContaining({ code: "update.duplicateModulePackage" }));

    const missingPackage = resolveFrameworkVersion({
      currentVersion: "0.1.0",
      channel: "stable",
      releases,
      installedModules: { auth: "1.0.0" }
    });
    expect(missingPackage.valid).toBe(false);
    expect(missingPackage.candidates.every(({ modules }) => modules[0]?.reason === "package-not-found")).toBe(true);

    const invalid = resolveFrameworkVersion({
      currentVersion: "0.1.0",
      channel: "stable",
      releases: [{ version: "0.2", channel: "stable" }],
      moduleCatalog: [moduleManifest("auth", "bad", "latest")]
    });
    expect(invalid.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "update.invalidReleaseVersion",
      "update.invalidModuleVersion",
      "update.invalidModuleCompatibility"
    ]));

    const mislabeled = resolveFrameworkVersion({
      currentVersion: "0.1.0",
      channel: "stable",
      releases: [{ version: "0.2.0-preview.1", channel: "stable" }]
    });
    expect(mislabeled.diagnostics).toContainEqual(expect.objectContaining({ code: "update.invalidStablePrerelease" }));
  });

  it("returns unchanged when no newer eligible release exists", () => {
    const result = resolveFrameworkVersion({
      currentVersion: "0.2.0",
      channel: "stable",
      releases: releases.filter(({ version }) => version !== "0.2.0")
    });
    expect(result).toMatchObject({ valid: true, state: "unchanged", targetVersion: "0.2.0" });
  });
});
