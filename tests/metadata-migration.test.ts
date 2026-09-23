import { describe, expect, it } from "vitest";
import {
  applyModuleUpdateMigrationPlan,
  applyVersionedManifestMigrationPlan,
  createModuleUpdateMigrationPlan,
  createVersionedManifestMigrationPlan,
  sha256,
  verifyModuleUpdateMigrationPlan,
  verifyVersionedManifestMigrationPlan,
  type ModuleUpdateMigrationDefinition,
  type VersionedManifestMigrationDefinition
} from "../packages/kernel/src/index.js";

const manifestMigrations: VersionedManifestMigrationDefinition[] = [
  {
    id: "project-v1-v2",
    manifest: "project",
    fromVersion: 1,
    toVersion: 2,
    digest: sha256("project-v1-v2"),
    migrate(document) {
      return { ...document, schemaVersion: 2, updatePolicy: "review" };
    }
  },
  {
    id: "project-v2-v3",
    manifest: "project",
    fromVersion: 2,
    toVersion: 3,
    digest: sha256("project-v2-v3"),
    migrate(document) {
      return { ...document, schemaVersion: 3, updatePolicy: "approve" };
    }
  }
];

const moduleMigrations: ModuleUpdateMigrationDefinition[] = [
  {
    id: "auth-1.0.0-1.1.0",
    moduleId: "auth",
    fromVersion: "1.0.0",
    toVersion: "1.1.0",
    digest: sha256("auth-1.0.0-1.1.0"),
    migrate(document) {
      return { ...document, sessionMinutes: 60 };
    }
  },
  {
    id: "auth-1.1.0-2.0.0",
    moduleId: "auth",
    fromVersion: "1.1.0",
    toVersion: "2.0.0",
    digest: sha256("auth-1.1.0-2.0.0"),
    migrate(document) {
      const migrated = { ...document, sessionDurationMinutes: document.sessionMinutes };
      delete migrated.sessionMinutes;
      return migrated;
    }
  }
];

describe("F6 versioned metadata migrations", () => {
  it("plans and applies consecutive manifest migrations deterministically", () => {
    const source = { name: "Sample", schemaVersion: 1, nested: { enabled: true } };
    const first = createVersionedManifestMigrationPlan("project", source, 3, manifestMigrations);
    const second = createVersionedManifestMigrationPlan(
      "project",
      { nested: { enabled: true }, schemaVersion: 1, name: "Sample" },
      3,
      [...manifestMigrations].reverse()
    );
    expect(first).toEqual(second);
    expect(first.steps.map(({ id }) => id)).toEqual(["project-v1-v2", "project-v2-v3"]);
    expect(() => verifyVersionedManifestMigrationPlan(first)).not.toThrow();

    const applied = applyVersionedManifestMigrationPlan(first, source, [...manifestMigrations].reverse());
    expect(applied).toEqual({
      changed: true,
      applied: ["project-v1-v2", "project-v2-v3"],
      document: { name: "Sample", schemaVersion: 3, nested: { enabled: true }, updatePolicy: "approve" }
    });
    expect(source).toEqual({ name: "Sample", schemaVersion: 1, nested: { enabled: true } });
  });

  it("supports every manifest version field and unchanged plans", () => {
    const cases = [
      ["project", { schemaVersion: 1 }],
      ["module", { schemaVersion: 1 }],
      ["lock", { lockVersion: 1 }],
      ["ownership", { version: 1 }]
    ] as const;
    for (const [kind, document] of cases) {
      const plan = createVersionedManifestMigrationPlan(kind, document, 1, []);
      expect(plan.state).toBe("unchanged");
      expect(applyVersionedManifestMigrationPlan(plan, document, [])).toMatchObject({ changed: false, applied: [] });
    }
  });

  it("rejects manifest gaps, downgrades, ambiguity, drift, and invalid postconditions", () => {
    const source = { schemaVersion: 1, name: "Sample" };
    expect(() => createVersionedManifestMigrationPlan("project", source, 3, manifestMigrations.slice(1)))
      .toThrowError(expect.objectContaining({ code: "update.missingManifestMigration" }));
    expect(() => createVersionedManifestMigrationPlan("project", { schemaVersion: 3 }, 2, manifestMigrations))
      .toThrowError(expect.objectContaining({ code: "update.manifestDowngradeUnsupported" }));
    expect(() => createVersionedManifestMigrationPlan("project", source, 2, [manifestMigrations[0]!, {
      ...manifestMigrations[0]!, id: "duplicate-source"
    }])).toThrowError(expect.objectContaining({ code: "update.ambiguousManifestMigration" }));

    const plan = createVersionedManifestMigrationPlan("project", source, 2, manifestMigrations);
    expect(() => verifyVersionedManifestMigrationPlan({ ...plan, toVersion: 3 }))
      .toThrowError(expect.objectContaining({ code: "update.invalidManifestMigrationPlan" }));
    expect(() => applyVersionedManifestMigrationPlan(plan, { ...source, name: "Changed" }, manifestMigrations))
      .toThrowError(expect.objectContaining({ code: "update.manifestChanged" }));
    expect(() => applyVersionedManifestMigrationPlan(plan, source, [{
      ...manifestMigrations[0]!, digest: sha256("replacement")
    }])).toThrowError(expect.objectContaining({ code: "update.manifestMigrationChanged" }));
    expect(() => applyVersionedManifestMigrationPlan(plan, source, [{
      ...manifestMigrations[0]!, migrate: (document) => ({ ...document, schemaVersion: 1 })
    }])).toThrowError(expect.objectContaining({ code: "update.manifestMigrationPostcondition" }));

    const { planId: _planId, digest: _digest, ...payload } = plan;
    const malformedPayload = { ...payload, state: "unchanged" as const, steps: [] };
    const malformedDigest = sha256(JSON.stringify(malformedPayload));
    expect(() => verifyVersionedManifestMigrationPlan({
      ...malformedPayload,
      planId: `manifest-migrate-${malformedDigest.slice("sha256:".length, "sha256:".length + 16)}`,
      digest: malformedDigest
    })).toThrowError(expect.objectContaining({ code: "update.invalidManifestMigrationPlan" }));
  });

  it("plans and applies an exact forward module migration chain", () => {
    const source = { passwordLogin: true };
    const plan = createModuleUpdateMigrationPlan("auth", "1.0.0", "2.0.0", source, [...moduleMigrations].reverse());
    expect(plan.state).toBe("apply");
    expect(plan.steps.map(({ id }) => id)).toEqual(["auth-1.0.0-1.1.0", "auth-1.1.0-2.0.0"]);
    expect(() => verifyModuleUpdateMigrationPlan(plan)).not.toThrow();
    expect(applyModuleUpdateMigrationPlan(plan, source, moduleMigrations)).toEqual({
      changed: true,
      applied: ["auth-1.0.0-1.1.0", "auth-1.1.0-2.0.0"],
      document: { passwordLogin: true, sessionDurationMinutes: 60 }
    });
    expect(source).toEqual({ passwordLogin: true });
  });

  it("rejects module gaps, overshoots, downgrades, ambiguity, and changed inputs", () => {
    const source = { passwordLogin: true };
    expect(() => createModuleUpdateMigrationPlan("auth", "1.0.0", "2.0.0", source, moduleMigrations.slice(1)))
      .toThrowError(expect.objectContaining({ code: "update.missingModuleMigration" }));
    expect(() => createModuleUpdateMigrationPlan("auth", "1.0.0", "1.0.5", source, moduleMigrations))
      .toThrowError(expect.objectContaining({ code: "update.moduleMigrationOvershoot" }));
    expect(() => createModuleUpdateMigrationPlan("auth", "2.0.0", "1.0.0", source, moduleMigrations))
      .toThrowError(expect.objectContaining({ code: "update.moduleDowngradeUnsupported" }));
    expect(() => createModuleUpdateMigrationPlan("auth", "1.0.0", "1.1.0", source, [moduleMigrations[0]!, {
      ...moduleMigrations[0]!, id: "duplicate-source"
    }])).toThrowError(expect.objectContaining({ code: "update.ambiguousModuleMigration" }));

    const plan = createModuleUpdateMigrationPlan("auth", "1.0.0", "1.1.0", source, moduleMigrations);
    expect(() => verifyModuleUpdateMigrationPlan({ ...plan, toVersion: "2.0.0" }))
      .toThrowError(expect.objectContaining({ code: "update.invalidModuleMigrationPlan" }));
    expect(() => applyModuleUpdateMigrationPlan(plan, { passwordLogin: false }, moduleMigrations))
      .toThrowError(expect.objectContaining({ code: "update.moduleConfigurationChanged" }));
    expect(() => applyModuleUpdateMigrationPlan(plan, source, [{
      ...moduleMigrations[0]!, digest: sha256("replacement")
    }])).toThrowError(expect.objectContaining({ code: "update.moduleMigrationChanged" }));
  });
});
