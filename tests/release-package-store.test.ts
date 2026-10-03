import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalReleasePackageStore,
  loadAndVerifyReleasePackage,
  sha256,
  type ReleasePackageManifest
} from "../packages/kernel/src/index.js";

const roots: string[] = [];

async function schema(relative: string): Promise<object> {
  return JSON.parse(await readFile(new URL(`../schemas/${relative}`, import.meta.url), "utf8")) as object;
}

async function fixture(): Promise<{ project: string; release: string }> {
  const project = await mkdtemp(path.join(tmpdir(), "flower-release-store-project-"));
  const release = await mkdtemp(path.join(tmpdir(), "flower-release-store-package-"));
  roots.push(project, release);
  await mkdir(path.join(project, ".flower"));
  await mkdir(path.join(release, "migrations"));
  const migration = `${JSON.stringify({
    schemaVersion: 1,
    operations: [{ op: "set", path: ["flower", "version"], value: "0.2.0" }]
  }, null, 2)}\n`;
  await writeFile(path.join(release, "migrations", "project.json"), migration);
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
      source: "./migrations/project.json",
      digest: sha256(migration)
    }],
    moduleMigrations: [],
    generatedFiles: [],
    dependencyChanges: [],
    databaseMigrations: [],
    requiredApprovals: [],
    verificationCommands: [],
    rollbackLimitations: []
  };
  await writeFile(path.join(release, "flower.release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { project, release };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local release package store", () => {
  it("copies a verified closed package under its digest and reuses it idempotently", async () => {
    const { project, release: releaseRoot } = await fixture();
    const release = await loadAndVerifyReleasePackage(
      releaseRoot,
      await schema("release-package/v1.json"),
      await schema("update-migration/v1.json")
    );
    const store = new LocalReleasePackageStore(project);
    const first = await store.save(release);
    const second = await store.save(release);

    expect(second).toBe(first);
    expect(await store.loadRoot(release.digest)).toBe(first);
    expect(first).toContain(path.join(".flower", "cache", "update-packages"));
    expect(await readFile(path.join(first, "migrations", "project.json"), "utf8")).toBe(
      await readFile(path.join(releaseRoot, "migrations", "project.json"), "utf8")
    );
  });

  it("rejects unsafe digest identities before resolving a cache path", async () => {
    const { project } = await fixture();
    await expect(new LocalReleasePackageStore(project).loadRoot("../../outside"))
      .rejects.toMatchObject({ code: "update.releaseDigestInvalid" });
  });
});
