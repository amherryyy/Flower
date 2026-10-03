import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyUpdatePlan,
  createReleasePackageUpdatePlan,
  loadAndVerifyReleasePackage,
  type UpdateApplicationHooks,
  type VerifiedReleasePackage
} from "../packages/kernel/src/index.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(repositoryRoot, "packages", "cli", "dist", "index.js");
const scenarioRoot = path.join(import.meta.dirname, "upgrade-scenarios", "0.1-to-0.2");
const releaseRoot = path.join(repositoryRoot, "releases", "0.2.0");
const temporaryRoots: string[] = [];
const managedPaths = [
  ".flower/auth.json",
  ".flower/lock.json",
  ".flower/ownership.json",
  ".flower/project.json",
  "src/flower/runtime.ts",
  "src/domain/account.ts"
];

async function schema(relative: string): Promise<object> {
  return JSON.parse(await readFile(path.join(repositoryRoot, "schemas", relative), "utf8")) as object;
}

async function projectFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flower-f7-exit-"));
  temporaryRoots.push(root);
  await cp(path.join(scenarioRoot, "source"), root, { recursive: true });
  return root;
}

async function release(): Promise<VerifiedReleasePackage> {
  return loadAndVerifyReleasePackage(
    releaseRoot,
    await schema("release-package/v1.json"),
    await schema("update-migration/v1.json")
  );
}

async function plan(projectRoot: string, verified: VerifiedReleasePackage) {
  return createReleasePackageUpdatePlan(projectRoot, verified, {
    projectSchema: await schema("project/v1.json"),
    ownershipSchema: await schema("ownership/v1.json")
  });
}

async function bytes(root: string): Promise<Map<string, Buffer>> {
  return new Map(await Promise.all(managedPaths.map(async (relativePath) => [
    relativePath,
    await readFile(path.join(root, ...relativePath.split("/")))
  ] as const)));
}

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: repositoryRoot, encoding: "utf8" });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Phase F7 package-bound update exit", () => {
  it("plans and applies the repository 0.1-to-0.2 package through the public CLI reproducibly", async () => {
    const firstRoot = await projectFixture();
    const secondRoot = await projectFixture();
    const projectOwnedBefore = await readFile(path.join(firstRoot, "src", "domain", "account.ts"));

    const planned = runCli("update", "--plan", "--release-package", releaseRoot, "--project", firstRoot, "--json");
    expect(planned.status).toBe(0);
    const firstPlan = JSON.parse(planned.stdout) as {
      plan: { planId: string; state: string; preconditions: { releasePackageDigest: string } };
      cachedPackagePath: string;
    };
    expect(firstPlan.plan.state).toBe("apply");
    expect(firstPlan.cachedPackagePath).toContain(path.join(".flower", "cache", "update-packages"));
    const applied = runCli(
      "update", "--apply", firstPlan.plan.planId, "--approve", "framework-update", "--project", firstRoot, "--json"
    );
    expect(applied.status).toBe(0);

    const secondPlanned = runCli("update", "--plan", "--release-package", releaseRoot, "--project", secondRoot, "--json");
    expect(secondPlanned.status).toBe(0);
    const secondPlan = JSON.parse(secondPlanned.stdout) as typeof firstPlan;
    expect(secondPlan.plan).toEqual(firstPlan.plan);
    expect(runCli(
      "update", "--apply", secondPlan.plan.planId, "--approve", "framework-update", "--project", secondRoot, "--json"
    ).status).toBe(0);

    for (const relativePath of [
      ".flower/project.json",
      ".flower/lock.json",
      ".flower/auth.json",
      "src/flower/runtime.ts"
    ]) {
      const expected = await readFile(path.join(scenarioRoot, "expected", ...relativePath.split("/")));
      expect(await readFile(path.join(firstRoot, ...relativePath.split("/")))).toEqual(expected);
      expect(await readFile(path.join(secondRoot, ...relativePath.split("/")))).toEqual(expected);
    }
    expect(await readFile(path.join(firstRoot, "src", "domain", "account.ts"))).toEqual(projectOwnedBefore);
    expect(await readFile(path.join(secondRoot, "src", "domain", "account.ts"))).toEqual(projectOwnedBefore);
  });

  it("rejects stale state and rolls back an injected filesystem failure with exact bytes restored", async () => {
    const verified = await release();
    const staleRoot = await projectFixture();
    const stalePlan = await plan(staleRoot, verified);
    const staleRuntime = await readFile(path.join(staleRoot, "src", "flower", "runtime.ts"));
    await writeFile(path.join(staleRoot, ".flower", "project.json"), "{}\n");
    await expect(applyUpdatePlan(stalePlan, {
      projectRoot: staleRoot,
      manifestMigrations: verified.manifestMigrations,
      moduleMigrations: verified.moduleMigrations,
      moduleDocuments: verified.moduleDocuments,
      generatedSources: verified.generatedSources,
      releasePackageDigest: verified.digest,
      approvals: ["framework-update"]
    })).rejects.toMatchObject({ code: "update.projectChanged" });
    expect(await readFile(path.join(staleRoot, "src", "flower", "runtime.ts"))).toEqual(staleRuntime);

    const rollbackRoot = await projectFixture();
    const rollbackPlan = await plan(rollbackRoot, verified);
    const before = await bytes(rollbackRoot);
    const hooks: UpdateApplicationHooks = {
      afterMutation: (_relativePath, index) => {
        if (index === 1) throw new Error("injected F7 filesystem failure");
      }
    };
    await expect(applyUpdatePlan(rollbackPlan, {
      projectRoot: rollbackRoot,
      manifestMigrations: verified.manifestMigrations,
      moduleMigrations: verified.moduleMigrations,
      moduleDocuments: verified.moduleDocuments,
      generatedSources: verified.generatedSources,
      releasePackageDigest: verified.digest,
      approvals: ["framework-update"],
      hooks
    })).rejects.toMatchObject({ code: "update.rolledBack", rollbackComplete: true });
    for (const [relativePath, expected] of before) {
      expect(await readFile(path.join(rollbackRoot, ...relativePath.split("/")))).toEqual(expected);
    }
  });
});
