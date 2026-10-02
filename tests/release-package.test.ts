import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyModuleUpdateMigrationPlan,
  applyVersionedManifestMigrationPlan,
  createModuleUpdateMigrationPlan,
  createVersionedManifestMigrationPlan,
  loadAndVerifyReleasePackage,
  sha256,
  type ReleasePackageManifest
} from "../packages/kernel/src/index.js";

const roots: string[] = [];

async function schema(relative: string): Promise<object> {
  return JSON.parse(await readFile(new URL(`../schemas/${relative}`, import.meta.url), "utf8")) as object;
}

async function fixture(): Promise<{ root: string; manifest: ReleasePackageManifest }> {
  const root = await mkdtemp(path.join(tmpdir(), "flower-release-package-"));
  roots.push(root);
  await mkdir(path.join(root, "migrations"));
  await mkdir(path.join(root, "generated", "base"), { recursive: true });
  await mkdir(path.join(root, "generated", "target"), { recursive: true });
  const projectMigration = `${JSON.stringify({
    schemaVersion: 1,
    operations: [
      { op: "set", path: ["schemaVersion"], value: 2 },
      { op: "set", path: ["flower", "version"], value: "0.2.0" }
    ]
  }, null, 2)}\n`;
  const authMigration = `${JSON.stringify({
    schemaVersion: 1,
    operations: [{ op: "set", path: ["emailConfirmation"], value: true }]
  }, null, 2)}\n`;
  const base = "export const frameworkVersion = '0.1.0';\n";
  const target = "export const frameworkVersion = '0.2.0';\n";
  await writeFile(path.join(root, "migrations", "project-v1-v2.json"), projectMigration);
  await writeFile(path.join(root, "migrations", "auth-v1-v2.json"), authMigration);
  await writeFile(path.join(root, "generated", "base", "runtime.ts"), base);
  await writeFile(path.join(root, "generated", "target", "runtime.ts"), target);
  const manifest: ReleasePackageManifest = {
    schemaVersion: 1,
    sourceVersion: "0.1.0",
    targetVersion: "0.2.0",
    channel: "stable",
    manifestMigrations: [{
      id: "project-v1-v2",
      manifest: "project",
      fromVersion: 1,
      toVersion: 2,
      source: "./migrations/project-v1-v2.json",
      digest: sha256(projectMigration)
    }],
    moduleMigrations: [{
      id: "auth-v1-v2",
      moduleId: "auth",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      documentPath: ".flower/auth.json",
      source: "./migrations/auth-v1-v2.json",
      digest: sha256(authMigration)
    }],
    generatedFiles: [{
      path: "src/flower/runtime.ts",
      kind: "merge",
      baseSource: "./generated/base/runtime.ts",
      baseDigest: sha256(base),
      targetSource: "./generated/target/runtime.ts",
      targetDigest: sha256(target)
    }],
    dependencyChanges: [],
    databaseMigrations: [],
    requiredApprovals: [{ id: "framework-update", description: "Apply the reviewed framework update" }],
    verificationCommands: [{ id: "tests", command: "npm test" }],
    rollbackLimitations: []
  };
  await writeFile(path.join(root, "flower.release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifest };
}

async function load(root: string) {
  return loadAndVerifyReleasePackage(
    root,
    await schema("release-package/v1.json"),
    await schema("update-migration/v1.json")
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("verified release packages", () => {
  it("loads deterministic artifacts and compiles bounded metadata migrations", async () => {
    const { root } = await fixture();
    const first = await load(root);
    const second = await load(root);

    expect(second.digest).toBe(first.digest);
    expect(first.manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.moduleDocuments).toEqual([{ moduleId: "auth", path: ".flower/auth.json" }]);
    expect(first.generatedSources).toEqual([{
      path: "src/flower/runtime.ts",
      base: "export const frameworkVersion = '0.1.0';\n",
      target: "export const frameworkVersion = '0.2.0';\n"
    }]);

    const project = { schemaVersion: 1, flower: { version: "0.1.0", channel: "stable" } };
    const projectPlan = createVersionedManifestMigrationPlan("project", project, 2, first.manifestMigrations);
    expect(applyVersionedManifestMigrationPlan(projectPlan, project, first.manifestMigrations).document)
      .toEqual({ schemaVersion: 2, flower: { version: "0.2.0", channel: "stable" } });

    const auth = { passwordLogin: true };
    const authPlan = createModuleUpdateMigrationPlan("auth", "1.0.0", "2.0.0", auth, first.moduleMigrations);
    expect(applyModuleUpdateMigrationPlan(authPlan, auth, first.moduleMigrations).document)
      .toEqual({ passwordLogin: true, emailConfirmation: true });
  });

  it("rejects changed artifacts, undeclared files, and unsafe sources", async () => {
    const changed = await fixture();
    await writeFile(path.join(changed.root, "generated", "target", "runtime.ts"), "changed\n");
    await expect(load(changed.root)).rejects.toMatchObject({ code: "update.releaseDigestMismatch" });

    const undeclared = await fixture();
    await writeFile(path.join(undeclared.root, "notes.txt"), "not declared\n");
    await expect(load(undeclared.root)).rejects.toMatchObject({ code: "update.releaseFileMismatch" });

    const unsafe = await fixture();
    const manifestPath = path.join(unsafe.root, "flower.release.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ReleasePackageManifest;
    manifest.manifestMigrations[0]!.source = "./../outside.json";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(load(unsafe.root)).rejects.toMatchObject({ code: "update.releaseUnsafePath" });
  });

  it("rejects invalid versions, generated-source shapes, and migration operations", async () => {
    const version = await fixture();
    const versionPath = path.join(version.root, "flower.release.json");
    const versionManifest = JSON.parse(await readFile(versionPath, "utf8")) as ReleasePackageManifest;
    versionManifest.targetVersion = "0.1.0";
    await writeFile(versionPath, `${JSON.stringify(versionManifest, null, 2)}\n`);
    await expect(load(version.root)).rejects.toMatchObject({ code: "update.releaseVersionInvalid" });

    const generated = await fixture();
    const generatedPath = path.join(generated.root, "flower.release.json");
    const generatedManifest = JSON.parse(await readFile(generatedPath, "utf8")) as ReleasePackageManifest;
    delete generatedManifest.generatedFiles[0]!.baseSource;
    await writeFile(generatedPath, `${JSON.stringify(generatedManifest, null, 2)}\n`);
    await expect(load(generated.root)).rejects.toMatchObject({ code: "update.releaseGeneratedInvalid" });

    const migration = await fixture();
    const migrationPath = path.join(migration.root, "migrations", "project-v1-v2.json");
    const invalid = `${JSON.stringify({
      schemaVersion: 1,
      operations: [{ op: "set", path: ["__proto__", "polluted"], value: true }]
    }, null, 2)}\n`;
    await writeFile(migrationPath, invalid);
    const migrationManifestPath = path.join(migration.root, "flower.release.json");
    const migrationManifest = JSON.parse(await readFile(migrationManifestPath, "utf8")) as ReleasePackageManifest;
    migrationManifest.manifestMigrations[0]!.digest = sha256(invalid);
    await writeFile(migrationManifestPath, `${JSON.stringify(migrationManifest, null, 2)}\n`);
    await expect(load(migration.root)).rejects.toMatchObject({ code: "update.releaseMigrationInvalid" });
  });
});
