import { describe, expect, it } from "vitest";
import {
  createUpdatePlan,
  resolveFrameworkVersion,
  sha256,
  UpdatePlanError,
  verifyUpdatePlan,
  type ModuleManifest,
  type UpdatePlanInput
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

const digest = (value: string): string => sha256(value);

function updateInput(): UpdatePlanInput {
  const resolution = resolveFrameworkVersion({
    currentVersion: "0.1.0",
    channel: "stable",
    releases: [
      { version: "0.1.0", channel: "stable" },
      { version: "0.2.0", channel: "stable" }
    ],
    installedModules: { auth: "1.0.0" },
    moduleCatalog: [moduleManifest("auth", "1.0.0", ">=0.1.0 <0.3.0")]
  });
  return {
    resolution,
    preconditions: {
      projectManifestDigest: digest("project"),
      lockDigest: digest("lock"),
      ownershipDigest: digest("ownership"),
      generatedStateDigest: digest("generated-state")
    },
    dependencyChanges: [
      { name: "@flower/kernel", kind: "update", fromVersion: "0.1.0", toVersion: "0.2.0" },
      { name: "@flower/config", kind: "add", toVersion: "0.2.0" }
    ],
    manifestMigrations: [
      { id: "project-v1-v2", manifest: "project", fromVersion: 1, toVersion: 2 }
    ],
    generatedFiles: [
      {
        path: "src/flower/modules.ts",
        kind: "replace",
        baseDigest: digest("old base"),
        currentDigest: digest("old base"),
        targetDigest: digest("new base")
      }
    ],
    databaseMigrations: [
      {
        id: "auth-002",
        moduleId: "auth",
        moduleVersion: "1.1.0",
        digest: digest("auth migration"),
        destructive: "review"
      }
    ],
    requiredApprovals: [
      { id: "generated-files", description: "Review generated integration diffs" }
    ],
    verificationCommands: [
      { id: "typecheck", command: "npm run typecheck" },
      { id: "tests", command: "npm test" }
    ],
    rollbackLimitations: [
      { id: "database", description: "Applied database migrations require module rollback guidance" }
    ]
  };
}

describe("F6 update planning", () => {
  it("creates a deterministic, complete plan regardless of catalog input ordering", () => {
    const input = updateInput();
    const first = createUpdatePlan(input);
    const second = createUpdatePlan({
      ...input,
      dependencyChanges: [...input.dependencyChanges!].reverse(),
      verificationCommands: [...input.verificationCommands!].reverse(),
      resolution: {
        ...input.resolution,
        candidates: [...input.resolution.candidates].reverse()
      }
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      command: "update",
      state: "apply",
      currentVersion: "0.1.0",
      targetVersion: "0.2.0"
    });
    expect(first.planId).toMatch(/^update-[a-f0-9]{16}$/);
    expect(first.moduleCompatibility).toEqual([
      expect.objectContaining({ moduleId: "auth", moduleVersion: "1.0.0", compatible: true })
    ]);
    expect(first.dependencyChanges.map(({ name }) => name)).toEqual(["@flower/config", "@flower/kernel"]);
    expect(first.requiredApprovals).toContainEqual({
      id: "database:auth-002",
      description: "Review-required database migration 'auth-002'"
    });
    expect(() => verifyUpdatePlan(first)).not.toThrow();
  });

  it("returns unchanged for an unchanged resolution with no planned actions", () => {
    const resolution = resolveFrameworkVersion({
      currentVersion: "0.2.0",
      channel: "stable",
      releases: [{ version: "0.2.0", channel: "stable" }]
    });
    const plan = createUpdatePlan({
      resolution,
      preconditions: {
        projectManifestDigest: digest("project"),
        lockDigest: digest("lock"),
        ownershipDigest: digest("ownership")
      }
    });
    expect(plan.state).toBe("unchanged");
    expect(plan.targetVersion).toBe("0.2.0");
  });

  it("emits a digest-protected blocked plan when ownership conflicts remain", () => {
    const input = updateInput();
    const plan = createUpdatePlan({
      ...input,
      ownershipConflicts: [{
        path: "src/domain/account.ts",
        owner: "project",
        policy: "never-overwrite",
        reason: "The update would replace project-owned code"
      }]
    });
    expect(plan.state).toBe("blocked");
    expect(plan.ownershipConflicts).toHaveLength(1);
    expect(() => verifyUpdatePlan(plan)).not.toThrow();
  });

  it("detects every mutation bound into the plan identity", () => {
    const plan = createUpdatePlan(updateInput());
    const tampered = {
      ...plan,
      verificationCommands: [{ id: "tests", command: "npm test -- --changed" }]
    };
    expect(() => verifyUpdatePlan(tampered)).toThrowError(
      expect.objectContaining({ code: "update.invalidPlan" })
    );
  });

  it("rejects blocked version resolutions, ambiguous entries, invalid digests, and unsafe paths", () => {
    const input = updateInput();
    const blocked = resolveFrameworkVersion({
      currentVersion: "0.1.0",
      channel: "stable",
      requestedVersion: "0.3.0",
      releases: [{ version: "0.2.0", channel: "stable" }]
    });
    expect(() => createUpdatePlan({ ...input, resolution: blocked })).toThrowError(
      expect.objectContaining({ code: "update.invalidResolution" })
    );
    expect(() => createUpdatePlan({
      ...input,
      dependencyChanges: [
        { name: "same", kind: "add", toVersion: "1.0.0" },
        { name: "same", kind: "add", toVersion: "2.0.0" }
      ]
    })).toThrowError(expect.objectContaining({ code: "update.duplicatePlanEntry" }));
    expect(() => createUpdatePlan({
      ...input,
      preconditions: { ...input.preconditions, lockDigest: "sha256:nope" }
    })).toThrowError(expect.objectContaining({ code: "update.invalidDigest" }));
    expect(() => createUpdatePlan({
      ...input,
      generatedFiles: [{ path: "../outside.ts", kind: "create", targetDigest: digest("target") }]
    })).toThrowError(expect.objectContaining({ code: "update.unsafePath" }));
    expect(() => createUpdatePlan({
      ...input,
      generatedFiles: [{
        path: "src/flower/modules.ts",
        kind: "replace",
        baseDigest: digest("base"),
        currentDigest: digest("project edit"),
        targetDigest: digest("target")
      }]
    })).toThrowError(expect.objectContaining({ code: "update.generatedFileDrift" }));
  });

  it("requires compatible evidence for the selected update target", () => {
    const input = updateInput();
    const resolution = {
      ...input.resolution,
      candidates: input.resolution.candidates.map((candidate) =>
        candidate.version === input.resolution.targetVersion ? { ...candidate, compatible: false } : candidate
      )
    };
    expect(() => createUpdatePlan({ ...input, resolution })).toThrow(UpdatePlanError);
  });
});
