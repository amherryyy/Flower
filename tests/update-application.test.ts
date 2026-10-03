import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  UpdateApplicationError,
  applyUpdatePlan,
  createModuleUpdateMigrationPlan,
  createUpdatePlan,
  createVersionedManifestMigrationPlan,
  mergeGeneratedText,
  resolveFrameworkVersion,
  sha256,
  type ModuleUpdateMigrationDefinition,
  type UpdateApplicationOptions,
  type UpdatePlan,
  type VersionedManifestMigrationDefinition
} from "../packages/kernel/src/index.js";

const roots: string[] = [];

const projectMigrations: VersionedManifestMigrationDefinition[] = [{
  id: "project-v1-v2-roomscouter",
  manifest: "project",
  fromVersion: 1,
  toVersion: 2,
  digest: sha256("project-v1-v2-roomscouter"),
  migrate(document) {
    return {
      ...document,
      schemaVersion: 2,
      project: { ...(document.project as object), name: "RoomScouter" },
      flower: { ...(document.flower as object), version: "0.2.0" },
      modules: { ...(document.modules as object), auth: "2.0.0" }
    };
  }
}];

const moduleMigrations: ModuleUpdateMigrationDefinition[] = [{
  id: "auth-1.0.0-2.0.0",
  moduleId: "auth",
  fromVersion: "1.0.0",
  toVersion: "2.0.0",
  digest: sha256("auth-1.0.0-2.0.0"),
  migrate(document) {
    return { ...document, emailConfirmation: true, passwordRecovery: true };
  }
}];

const baseRuntime = "export const flowerVersion = '0.1.0';\nexport const product = 'Boarding House Finder';\n";
const currentRuntime = "export const flowerVersion = '0.1.0';\nexport const product = 'RoomScouter';\n";
const targetRuntime = "export const flowerVersion = '0.2.0';\nexport const product = 'Boarding House Finder';\n";
const oldSecurity = `${JSON.stringify({ schemaVersion: 1, allowedLicenses: ["MIT"] }, null, 2)}\n`;
const newSecurity = `${JSON.stringify({ schemaVersion: 1, allowedLicenses: ["MIT", "LGPL-2.1-or-later", "CC-BY-4.0"] }, null, 2)}\n`;

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flower-update-apply-"));
  roots.push(root);
  await mkdir(path.join(root, ".flower"));
  await mkdir(path.join(root, "src", "flower"), { recursive: true });
  await mkdir(path.join(root, "src", "domain"), { recursive: true });
  await writeFile(path.join(root, ".flower", "project.json"), `${JSON.stringify({
    schemaVersion: 1,
    project: { id: "boarding-house-finder", name: "Boarding House Finder" },
    flower: { version: "0.1.0", channel: "stable" },
    modules: { auth: "1.0.0" }
  }, null, 2)}\n`);
  await writeFile(path.join(root, ".flower", "lock.json"), `${JSON.stringify({
    lockVersion: 1,
    flowerVersion: "0.1.0",
    modules: { auth: "1.0.0" }
  }, null, 2)}\n`);
  await writeFile(path.join(root, ".flower", "ownership.json"), `${JSON.stringify({
    version: 1,
    rules: [
      { pattern: ".flower/security.json", owner: "generated", policy: "replace-if-unmodified" },
      { pattern: "src/flower/**", owner: "generated", policy: "replace-if-unmodified" },
      { pattern: "**", owner: "project", policy: "never-overwrite" }
    ]
  }, null, 2)}\n`);
  await writeFile(path.join(root, ".flower", "auth.json"), `${JSON.stringify({ passwordLogin: true }, null, 2)}\n`);
  await writeFile(path.join(root, ".flower", "security.json"), oldSecurity);
  await writeFile(path.join(root, "src", "flower", "runtime.ts"), currentRuntime);
  await writeFile(path.join(root, "src", "domain", "listing.ts"), "export const projectOwned = true;\n");
  return root;
}

async function text(root: string, relativePath: string): Promise<string> {
  return await readFile(path.join(root, ...relativePath.split("/")), "utf8");
}

async function plan(root: string, overrides: Parameters<typeof createUpdatePlan>[0] extends infer T ? Partial<T> : never = {}): Promise<UpdatePlan> {
  const project = JSON.parse(await text(root, ".flower/project.json")) as object;
  const auth = JSON.parse(await text(root, ".flower/auth.json")) as object;
  const projectPlan = createVersionedManifestMigrationPlan("project", project, 2, projectMigrations);
  const authPlan = createModuleUpdateMigrationPlan("auth", "1.0.0", "2.0.0", auth, moduleMigrations);
  const runtimeMerge = mergeGeneratedText(baseRuntime, currentRuntime, targetRuntime);
  expect(runtimeMerge.status).toBe("merge");
  const input = {
    resolution: resolveFrameworkVersion({
      currentVersion: "0.1.0",
      requestedVersion: "0.2.0",
      channel: "stable" as const,
      releases: [{ version: "0.2.0", channel: "stable" as const }]
    }),
    preconditions: {
      projectManifestDigest: sha256(await text(root, ".flower/project.json")),
      lockDigest: sha256(await text(root, ".flower/lock.json")),
      ownershipDigest: sha256(await text(root, ".flower/ownership.json"))
    },
    manifestMigrations: projectPlan.steps.map((step) => ({ ...step, manifest: "project" as const })),
    moduleMigrations: authPlan.steps.map((step) => ({ ...step, moduleId: "auth" })),
    generatedFiles: [
      {
        path: ".flower/security.json",
        kind: "replace" as const,
        baseDigest: sha256(oldSecurity),
        currentDigest: sha256(oldSecurity),
        targetDigest: sha256(newSecurity)
      },
      {
        path: "src/flower/runtime.ts",
        kind: "merge" as const,
        baseDigest: runtimeMerge.baseDigest,
        currentDigest: runtimeMerge.currentDigest,
        targetDigest: runtimeMerge.targetDigest
      }
    ],
    requiredApprovals: [{ id: "pilot-update", description: "Apply the reviewed pilot-derived update" }],
    verificationCommands: [{ id: "tests", command: "npm test" }],
    ...overrides
  };
  return createUpdatePlan(input);
}

function options(root: string, overrides: Partial<UpdateApplicationOptions> = {}): UpdateApplicationOptions {
  return {
    projectRoot: root,
    manifestMigrations: projectMigrations,
    moduleMigrations,
    moduleDocuments: [{ moduleId: "auth", path: ".flower/auth.json" }],
    generatedSources: [
      { path: ".flower/security.json", base: oldSecurity, target: newSecurity },
      { path: "src/flower/runtime.ts", base: baseRuntime, target: targetRuntime }
    ],
    approvals: ["pilot-update"],
    runVerification: async () => undefined,
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("F7 transactional update application", () => {
  it("applies pilot-derived metadata and security updates while preserving project-owned bytes", async () => {
    const root = await fixture();
    const updatePlan = await plan(root);
    const projectOwnedBefore = await readFile(path.join(root, "src", "domain", "listing.ts"));
    const verification: string[] = [];

    const result = await applyUpdatePlan(updatePlan, options(root, {
      runVerification: async (command) => { verification.push(command.id); }
    }));

    expect(result.status).toBe("completed");
    expect(result.changedPaths).toEqual([
      ".flower/auth.json",
      ".flower/project.json",
      ".flower/security.json",
      "src/flower/runtime.ts"
    ]);
    expect(result.journalPath).toContain(path.join(".flower", "journal", "local"));
    expect(verification).toEqual(["tests"]);
    expect(JSON.parse(await text(root, ".flower/project.json"))).toEqual(expect.objectContaining({
      schemaVersion: 2,
      project: { id: "boarding-house-finder", name: "RoomScouter" },
      flower: { version: "0.2.0", channel: "stable" }
    }));
    expect(JSON.parse(await text(root, ".flower/auth.json"))).toEqual({
      passwordLogin: true,
      emailConfirmation: true,
      passwordRecovery: true
    });
    expect(await text(root, ".flower/security.json")).toBe(newSecurity);
    expect(await text(root, "src/flower/runtime.ts")).toContain("flowerVersion = '0.2.0'");
    expect(await text(root, "src/flower/runtime.ts")).toContain("product = 'RoomScouter'");
    expect(await readFile(path.join(root, "src", "domain", "listing.ts"))).toEqual(projectOwnedBefore);
  });

  it("rejects stale plans, missing approvals, unsupported effects, and ownership violations before writes", async () => {
    const staleRoot = await fixture();
    const stalePlan = await plan(staleRoot);
    await writeFile(path.join(staleRoot, ".flower", "project.json"), "{}\n");
    await expect(applyUpdatePlan(stalePlan, options(staleRoot))).rejects.toMatchObject({ code: "update.projectChanged" });
    expect(await text(staleRoot, ".flower/security.json")).toBe(oldSecurity);

    const approvalRoot = await fixture();
    await expect(applyUpdatePlan(await plan(approvalRoot), options(approvalRoot, { approvals: [] })))
      .rejects.toMatchObject({ code: "update.approvalMissing" });

    for (const effects of [
      {
        dependencyChanges: [{ name: "@flower/kernel", kind: "update" as const, fromVersion: "0.1.0", toVersion: "0.2.0" }]
      },
      {
        databaseMigrations: [{
          id: "auth-v2-schema",
          moduleId: "auth",
          moduleVersion: "2.0.0",
          digest: sha256("auth-v2-schema"),
          destructive: "none" as const
        }]
      }
    ]) {
      const unsupportedRoot = await fixture();
      const securityBefore = await text(unsupportedRoot, ".flower/security.json");
      const unsupportedPlan = await plan(unsupportedRoot, effects);
      await expect(applyUpdatePlan(unsupportedPlan, options(unsupportedRoot)))
        .rejects.toMatchObject({ code: "update.unsupportedEffect" });
      expect(await text(unsupportedRoot, ".flower/security.json")).toBe(securityBefore);
    }

    const ownershipRoot = await fixture();
    const owned = await text(ownershipRoot, "src/domain/listing.ts");
    const ownershipPlan = await plan(ownershipRoot, {
      generatedFiles: [{
        path: "src/domain/listing.ts",
        kind: "replace",
        baseDigest: sha256(owned),
        currentDigest: sha256(owned),
        targetDigest: sha256("export const projectOwned = false;\n")
      }]
    });
    await expect(applyUpdatePlan(ownershipPlan, options(ownershipRoot, {
      generatedSources: [{
        path: "src/domain/listing.ts",
        base: owned,
        target: "export const projectOwned = false;\n"
      }]
    }))).rejects.toMatchObject({ code: "update.ownershipViolation" });
    expect(await text(ownershipRoot, "src/domain/listing.ts")).toBe(owned);
  });

  it("rolls back every applied file when mutation or verification fails", async () => {
    for (const failure of ["mutation", "verification"] as const) {
      const root = await fixture();
      const updatePlan = await plan(root);
      const before = new Map<string, string>();
      for (const relativePath of [
        ".flower/auth.json",
        ".flower/project.json",
        ".flower/security.json",
        "src/flower/runtime.ts",
        "src/domain/listing.ts"
      ]) before.set(relativePath, await text(root, relativePath));

      await expect(applyUpdatePlan(updatePlan, options(root, failure === "mutation" ? {
        hooks: { afterMutation: (_path, index) => { if (index === 2) throw new Error("injected mutation failure"); } }
      } : {
        runVerification: async () => { throw new Error("injected verification failure"); }
      }))).rejects.toEqual(expect.objectContaining({
        code: "update.rolledBack",
        rollbackComplete: true
      } satisfies Partial<UpdateApplicationError>));

      for (const [relativePath, contents] of before) {
        expect(await text(root, relativePath)).toBe(contents);
      }
    }
  });

  it("detects a file changed during application and does not erase the external edit", async () => {
    const root = await fixture();
    const updatePlan = await plan(root);
    const projectBefore = await text(root, ".flower/project.json");
    const authBefore = await text(root, ".flower/auth.json");
    const externalSecurity = `${JSON.stringify({ schemaVersion: 1, allowedLicenses: ["MIT", "Apache-2.0"] }, null, 2)}\n`;

    await expect(applyUpdatePlan(updatePlan, options(root, {
      hooks: {
        afterMutation: async (_path, index) => {
          if (index === 0) await writeFile(path.join(root, ".flower", "security.json"), externalSecurity);
        }
      }
    }))).rejects.toMatchObject({ code: "update.rolledBack", rollbackComplete: true });

    expect(await text(root, ".flower/auth.json")).toBe(authBefore);
    expect(await text(root, ".flower/project.json")).toBe(projectBefore);
    expect(await text(root, ".flower/security.json")).toBe(externalSecurity);
  });
});
