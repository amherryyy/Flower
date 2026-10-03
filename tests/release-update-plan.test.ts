import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyUpdatePlan,
  createReleasePackageUpdatePlan,
  loadAndVerifyReleasePackage,
  sha256,
  type ReleasePackageManifest,
  type VerifiedReleasePackage
} from "../packages/kernel/src/index.js";

const roots: string[] = [];
const oldSecurity = `${JSON.stringify({ schemaVersion: 1, allowedLicenses: ["MIT"] }, null, 2)}\n`;
const newSecurity = `${JSON.stringify({ schemaVersion: 1, allowedLicenses: ["MIT", "CC-BY-4.0"] }, null, 2)}\n`;
const baseRuntime = "export const version = '0.1.0';\nexport const product = 'Boarding House Finder';\n";
const currentRuntime = "export const version = '0.1.0';\nexport const product = 'RoomScouter';\n";
const targetRuntime = "export const version = '0.2.0';\nexport const product = 'Boarding House Finder';\n";

async function schema(relative: string): Promise<object> {
  return JSON.parse(await readFile(new URL(`../schemas/${relative}`, import.meta.url), "utf8")) as object;
}

async function jsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function projectFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flower-release-plan-project-"));
  roots.push(root);
  await jsonFile(path.join(root, ".flower", "project.json"), {
    schemaVersion: 1,
    mode: "project",
    project: { id: "roomscouter", name: "RoomScouter" },
    flower: { version: "0.1.0", channel: "stable" },
    stack: { language: "typescript", runtime: "node", packageManager: "npm" },
    modules: { auth: "1.0.0" }
  });
  await jsonFile(path.join(root, ".flower", "lock.json"), {
    lockVersion: 1,
    flowerVersion: "0.1.0",
    modules: { auth: "1.0.0" },
    generatedFiles: {}
  });
  await jsonFile(path.join(root, ".flower", "ownership.json"), {
    version: 1,
    rules: [
      { pattern: ".flower/security.json", owner: "generated", policy: "replace-if-unmodified" },
      { pattern: "src/flower/**", owner: "generated", policy: "replace-if-unmodified" },
      { pattern: "**", owner: "project", policy: "never-overwrite" }
    ]
  });
  await jsonFile(path.join(root, ".flower", "auth.json"), { passwordLogin: true });
  await writeFile(path.join(root, ".flower", "security.json"), oldSecurity);
  await mkdir(path.join(root, "src", "flower"), { recursive: true });
  await writeFile(path.join(root, "src", "flower", "runtime.ts"), currentRuntime);
  await mkdir(path.join(root, "src", "domain"), { recursive: true });
  await writeFile(path.join(root, "src", "domain", "listing.ts"), "export const projectOwned = true;\n");
  return root;
}

async function releaseFixture(): Promise<VerifiedReleasePackage> {
  const root = await mkdtemp(path.join(tmpdir(), "flower-release-plan-package-"));
  roots.push(root);
  const migrations = {
    project: `${JSON.stringify({ schemaVersion: 1, operations: [
      { op: "set", path: ["schemaVersion"], value: 2 },
      { op: "set", path: ["flower", "version"], value: "0.2.0" },
      { op: "set", path: ["modules", "auth"], value: "2.0.0" }
    ] }, null, 2)}\n`,
    lock: `${JSON.stringify({ schemaVersion: 1, operations: [
      { op: "set", path: ["lockVersion"], value: 2 },
      { op: "set", path: ["flowerVersion"], value: "0.2.0" },
      { op: "set", path: ["modules", "auth"], value: "2.0.0" }
    ] }, null, 2)}\n`,
    auth: `${JSON.stringify({ schemaVersion: 1, operations: [
      { op: "set", path: ["emailConfirmation"], value: true }
    ] }, null, 2)}\n`
  };
  for (const [name, contents] of Object.entries(migrations)) {
    await mkdir(path.join(root, "migrations"), { recursive: true });
    await writeFile(path.join(root, "migrations", `${name}.json`), contents);
  }
  const generated = {
    "security-base.json": oldSecurity,
    "security-target.json": newSecurity,
    "runtime-base.ts": baseRuntime,
    "runtime-target.ts": targetRuntime
  };
  for (const [name, contents] of Object.entries(generated)) {
    await mkdir(path.join(root, "generated"), { recursive: true });
    await writeFile(path.join(root, "generated", name), contents);
  }
  const manifest: ReleasePackageManifest = {
    schemaVersion: 1,
    sourceVersion: "0.1.0",
    targetVersion: "0.2.0",
    channel: "stable",
    manifestMigrations: [
      { id: "project-v1-v2", manifest: "project", fromVersion: 1, toVersion: 2, source: "./migrations/project.json", digest: sha256(migrations.project) },
      { id: "lock-v1-v2", manifest: "lock", fromVersion: 1, toVersion: 2, source: "./migrations/lock.json", digest: sha256(migrations.lock) }
    ],
    moduleMigrations: [{
      id: "auth-v1-v2",
      moduleId: "auth",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      documentPath: ".flower/auth.json",
      source: "./migrations/auth.json",
      digest: sha256(migrations.auth)
    }],
    generatedFiles: [
      {
        path: ".flower/security.json",
        kind: "replace",
        baseSource: "./generated/security-base.json",
        baseDigest: sha256(oldSecurity),
        targetSource: "./generated/security-target.json",
        targetDigest: sha256(newSecurity)
      },
      {
        path: "src/flower/runtime.ts",
        kind: "merge",
        baseSource: "./generated/runtime-base.ts",
        baseDigest: sha256(baseRuntime),
        targetSource: "./generated/runtime-target.ts",
        targetDigest: sha256(targetRuntime)
      }
    ],
    dependencyChanges: [],
    databaseMigrations: [],
    requiredApprovals: [{ id: "framework-update", description: "Apply the reviewed framework update" }],
    verificationCommands: [{ id: "tests", command: "npm test" }],
    rollbackLimitations: []
  };
  await jsonFile(path.join(root, "flower.release.json"), manifest);
  return loadAndVerifyReleasePackage(
    root,
    await schema("release-package/v1.json"),
    await schema("update-migration/v1.json")
  );
}

async function plan(root: string, release: VerifiedReleasePackage) {
  return createReleasePackageUpdatePlan(root, release, {
    projectSchema: await schema("project/v1.json"),
    ownershipSchema: await schema("ownership/v1.json")
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release package update planning", () => {
  it("creates and applies one deterministic package-bound plan while preserving project-owned bytes", async () => {
    const root = await projectFixture();
    const release = await releaseFixture();
    const first = await plan(root, release);
    const second = await plan(root, release);

    expect(second).toEqual(first);
    expect(first).toEqual(expect.objectContaining({
      state: "apply",
      currentVersion: "0.1.0",
      targetVersion: "0.2.0",
      preconditions: expect.objectContaining({ releasePackageDigest: release.digest })
    }));
    expect(first.manifestMigrations.map(({ manifest, id }) => `${manifest}:${id}`)).toEqual([
      "lock:lock-v1-v2",
      "project:project-v1-v2"
    ]);
    expect(first.moduleMigrations.map(({ id }) => id)).toEqual(["auth-v1-v2"]);
    expect(first.generatedFiles.map(({ path: generatedPath, kind }) => `${kind}:${generatedPath}`)).toEqual([
      "replace:.flower/security.json",
      "merge:src/flower/runtime.ts"
    ]);
    const projectOwnedBefore = await readFile(path.join(root, "src", "domain", "listing.ts"));

    await expect(applyUpdatePlan(first, {
      projectRoot: root,
      manifestMigrations: release.manifestMigrations,
      moduleMigrations: release.moduleMigrations,
      moduleDocuments: release.moduleDocuments,
      generatedSources: release.generatedSources,
      approvals: ["framework-update"],
      runVerification: async () => undefined
    })).rejects.toMatchObject({ code: "update.releasePackageChanged" });

    const result = await applyUpdatePlan(first, {
      projectRoot: root,
      manifestMigrations: release.manifestMigrations,
      moduleMigrations: release.moduleMigrations,
      moduleDocuments: release.moduleDocuments,
      generatedSources: release.generatedSources,
      releasePackageDigest: release.digest,
      approvals: ["framework-update"],
      runVerification: async () => undefined
    });
    expect(result.status).toBe("completed");
    expect(JSON.parse(await readFile(path.join(root, ".flower", "project.json"), "utf8"))).toEqual(expect.objectContaining({
      schemaVersion: 2,
      flower: { version: "0.2.0", channel: "stable" },
      modules: { auth: "2.0.0" }
    }));
    expect(JSON.parse(await readFile(path.join(root, ".flower", "lock.json"), "utf8"))).toEqual(expect.objectContaining({
      lockVersion: 2,
      flowerVersion: "0.2.0",
      modules: { auth: "2.0.0" }
    }));
    expect(await readFile(path.join(root, "src", "flower", "runtime.ts"), "utf8")).toContain("version = '0.2.0'");
    expect(await readFile(path.join(root, "src", "flower", "runtime.ts"), "utf8")).toContain("product = 'RoomScouter'");
    expect(await readFile(path.join(root, "src", "domain", "listing.ts"))).toEqual(projectOwnedBefore);
  });

  it("blocks generated drift and merge conflicts without mutating the project", async () => {
    const driftRoot = await projectFixture();
    const release = await releaseFixture();
    await writeFile(path.join(driftRoot, ".flower", "security.json"), `${oldSecurity}\n`);
    const drift = await plan(driftRoot, release);
    expect(drift.state).toBe("blocked");
    expect(drift.ownershipConflicts).toContainEqual(expect.objectContaining({
      path: ".flower/security.json",
      reason: "generated-file-drift"
    }));

    const conflictRoot = await projectFixture();
    await writeFile(path.join(conflictRoot, "src", "flower", "runtime.ts"),
      "export const version = 'custom';\nexport const product = 'RoomScouter';\n");
    const conflict = await plan(conflictRoot, release);
    expect(conflict.state).toBe("blocked");
    expect(conflict.ownershipConflicts).toContainEqual(expect.objectContaining({
      path: "src/flower/runtime.ts",
      reason: "generated-merge-conflict"
    }));
  });

  it("rejects source-version, module-state, and release postcondition mismatches", async () => {
    const sourceRoot = await projectFixture();
    const release = await releaseFixture();
    const projectPath = path.join(sourceRoot, ".flower", "project.json");
    const project = JSON.parse(await readFile(projectPath, "utf8"));
    project.flower.version = "0.0.9";
    await jsonFile(projectPath, project);
    await expect(plan(sourceRoot, release)).rejects.toMatchObject({ code: "update.releaseSourceMismatch" });

    const moduleRoot = await projectFixture();
    const lockPath = path.join(moduleRoot, ".flower", "lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.modules.auth = "1.1.0";
    await jsonFile(lockPath, lock);
    await expect(plan(moduleRoot, release)).rejects.toMatchObject({ code: "update.moduleStateMismatch" });

    const postconditionRoot = await projectFixture();
    const brokenRelease = await releaseFixture();
    brokenRelease.manifestMigrations.splice(
      brokenRelease.manifestMigrations.findIndex(({ manifest }) => manifest === "lock"),
      1
    );
    await expect(plan(postconditionRoot, brokenRelease)).rejects.toMatchObject({ code: "update.releasePostconditionFailed" });
  });
});
