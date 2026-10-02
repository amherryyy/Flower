import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalUpdatePlanStore,
  createUpdatePlan,
  resolveFrameworkVersion,
  sha256,
  type UpdatePlan
} from "../packages/kernel/src/index.js";

const roots: string[] = [];

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "flower-update-plan-store-"));
  roots.push(directory);
  await mkdir(path.join(directory, ".flower"));
  return directory;
}

function plan(): UpdatePlan {
  const digest = sha256("fixture");
  return createUpdatePlan({
    resolution: resolveFrameworkVersion({
      currentVersion: "0.1.0",
      requestedVersion: "0.1.0",
      channel: "stable",
      releases: [{ version: "0.1.0", channel: "stable" }]
    }),
    preconditions: {
      projectManifestDigest: digest,
      lockDigest: digest,
      ownershipDigest: digest
    }
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local update plan store", () => {
  it("persists and reloads the exact verified plan idempotently", async () => {
    const directory = await root();
    const store = new LocalUpdatePlanStore(directory);
    const updatePlan = plan();

    const firstPath = await store.save(updatePlan);
    const secondPath = await store.save(updatePlan);

    expect(secondPath).toBe(firstPath);
    expect(firstPath).toContain(path.join(".flower", "cache", "update-plans"));
    await expect(store.load(updatePlan.planId)).resolves.toEqual(updatePlan);
    const stored = await readFile(firstPath, "utf8");
    expect(stored).toContain(updatePlan.planId);
  });

  it("rejects checksum corruption and unsafe plan identifiers", async () => {
    const directory = await root();
    const store = new LocalUpdatePlanStore(directory);
    const updatePlan = plan();
    const filePath = await store.save(updatePlan);
    const stored = JSON.parse(await readFile(filePath, "utf8")) as { plan: { targetVersion: string } };
    stored.plan.targetVersion = "9.9.9";
    await writeFile(filePath, `${JSON.stringify(stored, null, 2)}\n`);

    await expect(store.load(updatePlan.planId)).rejects.toMatchObject({ code: "update.planCorrupt" });
    await expect(store.load("../../escape")).rejects.toMatchObject({ code: "update.planIdInvalid" });
  });

  it("rejects unsafe cache components and concurrent writer locks", async () => {
    const unsafeRoot = await root();
    await writeFile(path.join(unsafeRoot, ".flower", "cache"), "not a directory\n");
    await expect(new LocalUpdatePlanStore(unsafeRoot).save(plan()))
      .rejects.toMatchObject({ code: "update.planStoreUnsafe" });

    const lockedRoot = await root();
    const store = new LocalUpdatePlanStore(lockedRoot);
    const updatePlan = plan();
    await store.save(updatePlan);
    const lockPath = path.join(lockedRoot, ".flower", "cache", "update-plans", `${updatePlan.planId}.json.lock`);
    await writeFile(lockPath, "interrupted writer\n");
    await expect(store.save(updatePlan)).rejects.toMatchObject({ code: "update.planLocked" });
  });
});
