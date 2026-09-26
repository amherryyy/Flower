import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdoptionApplicationError,
  applyAdoptionPlan,
  createAdoptionMetadataDocuments,
  classifyPath,
  createAdoptionPlan,
  createAgentAdapterBundle,
  inspectAdoptionProject,
  loadAppliedAdoptionPlan,
  loadModuleCatalog,
  writeLocalJournal,
  type AdoptionApplicationOptions,
  type CommandRunner,
  type OwnershipManifest,
  type ProjectManifest
} from "../packages/kernel/src/index.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];
const noGit: CommandRunner = async () => ({ exitCode: 128, stdout: "", stderr: "not a repository" });

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function json(filePath: string): Promise<object> {
  return JSON.parse(await readFile(filePath, "utf8")) as object;
}

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "flower-adopt-apply-"));
  temporaryDirectories.push(directory);
  await writeFile(path.join(directory, "package.json"), `${JSON.stringify({
    name: "existing-app",
    packageManager: "npm@11",
    dependencies: { next: "15.0.0" }
  })}\n`);
  await writeFile(path.join(directory, "package-lock.json"), "{}\n");
  await writeFile(path.join(directory, "AGENTS.md"), "Existing project instructions\n");
  await mkdir(path.join(directory, "src"));
  await writeFile(path.join(directory, "src", "app.ts"), "export const existing = true;\n");
  await mkdir(path.join(directory, "src", "flower"));
  await writeFile(path.join(directory, "src", "flower", "existing.ts"), "export const owned = true;\n");
  return directory;
}

async function applicationOptions(overrides: Partial<AdoptionApplicationOptions> = {}): Promise<AdoptionApplicationOptions> {
  return {
    projectSchema: await json(path.join(repositoryRoot, "schemas", "project", "v1.json")),
    ownershipSchema: await json(path.join(repositoryRoot, "schemas", "ownership", "v1.json")),
    ...overrides
  };
}

async function plan(directory: string) {
  return await createAdoptionPlan(await inspectAdoptionProject(directory, noGit), {
    projectId: "existing-app",
    projectName: "Existing App",
    flowerVersion: "0.1.0"
  });
}

async function catalog() {
  return await loadModuleCatalog(
    path.join(repositoryRoot, "modules"),
    await json(path.join(repositoryRoot, "schemas", "module", "v1.json")),
    await json(path.join(repositoryRoot, "schemas", "migration", "v1.json"))
  );
}

describe("F7 adoption application", () => {
  it("applies metadata transactionally, preserves existing bytes, journals, and repeats as a no-op", async () => {
    const directory = await root();
    const before = await readFile(path.join(directory, "src", "app.ts"));
    const adoptionPlan = await plan(directory);

    const result = await applyAdoptionPlan(adoptionPlan, await applicationOptions());

    expect(result.status).toBe("completed");
    expect(result.changedPaths).toEqual([
      ".flower/project.json",
      ".flower/ownership.json",
      ".flower/lock.json",
      ".flower/adoption.json"
    ]);
    expect(result.journalPath).toContain(path.join(".flower", "journal", "local"));
    expect(await readFile(path.join(directory, "src", "app.ts"))).toEqual(before);
    expect((await json(path.join(directory, ".flower", "project.json")) as { project: { id: string } }).project.id).toBe("existing-app");
    const ownership = await json(path.join(directory, ".flower", "ownership.json")) as OwnershipManifest;
    expect(ownership.rules).toContainEqual({ pattern: "**", owner: "project", policy: "never-overwrite" });
    expect(classifyPath(ownership, "AGENTS.md").rule?.owner).toBe("project");
    expect(classifyPath(ownership, "src/flower/existing.ts").rule?.owner).toBe("project");
    expect(classifyPath(ownership, "src/flower/new.ts").rule?.owner).toBe("generated");
    await expect(loadAppliedAdoptionPlan(directory)).resolves.toEqual(adoptionPlan);
    await expect(applyAdoptionPlan(adoptionPlan, await applicationOptions())).resolves.toEqual({
      status: "unchanged",
      planId: adoptionPlan.planId,
      projectRoot: directory,
      changedPaths: []
    });

    const projectPath = path.join(directory, ".flower", "project.json");
    const lockPath = path.join(directory, ".flower", "lock.json");
    const evolvedProject = await json(projectPath) as { modules?: Record<string, string> };
    evolvedProject.modules = { auth: "1.0.0" };
    await writeFile(projectPath, `${JSON.stringify(evolvedProject, null, 2)}\n`);
    const evolvedLock = await json(lockPath) as { modules?: Record<string, unknown> };
    evolvedLock.modules = { auth: { version: "1.0.0", digest: "sha256:later", migrations: [] } };
    await writeFile(lockPath, `${JSON.stringify(evolvedLock, null, 2)}\n`);
    await expect(applyAdoptionPlan(adoptionPlan, await applicationOptions())).resolves.toEqual(
      expect.objectContaining({ status: "unchanged" })
    );
  });

  it("rejects stale project bytes before creating control metadata", async () => {
    const directory = await root();
    const adoptionPlan = await plan(directory);
    await writeFile(path.join(directory, "src", "app.ts"), "export const existing = false;\n");

    await expect(applyAdoptionPlan(adoptionPlan, await applicationOptions())).rejects.toEqual(
      expect.objectContaining({ code: "adopt.projectChanged" })
    );
    await expect(readFile(path.join(directory, ".flower", "project.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back all Flower state when a metadata write or completion journal fails", async () => {
    const writeFailureRoot = await root();
    const writeFailurePlan = await plan(writeFailureRoot);
    await expect(applyAdoptionPlan(writeFailurePlan, await applicationOptions({
      hooks: {
        afterWrite: (_path, index) => {
          if (index === 1) throw new Error("injected write failure");
        }
      }
    }))).rejects.toEqual(expect.objectContaining({ code: "adopt.rolledBack", rollbackComplete: true }));
    await expect(readFile(path.join(writeFailureRoot, ".flower", "project.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(writeFailureRoot, "src", "app.ts"), "utf8")).toContain("existing = true");

    const journalFailureRoot = await root();
    const journalFailurePlan = await plan(journalFailureRoot);
    let journalCalls = 0;
    await expect(applyAdoptionPlan(journalFailurePlan, await applicationOptions({
      hooks: {
        writeJournal: async (projectRoot, entry) => {
          journalCalls += 1;
          if (journalCalls === 2) throw new Error("injected journal failure");
          return await writeLocalJournal(projectRoot, entry);
        }
      }
    }))).rejects.toEqual(expect.objectContaining({ code: "adopt.rolledBack", rollbackComplete: true }));
    await expect(readFile(path.join(journalFailureRoot, ".flower", "adoption.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back composed modules with the outer adoption transaction and detects record drift", async () => {
    const selectedRoot = await root();
    const inspection = await inspectAdoptionProject(selectedRoot, noGit);
    const moduleCatalog = await catalog();
    const selectedPlan = await createAdoptionPlan(inspection, {
      projectId: "existing-app",
      projectName: "Existing App",
      flowerVersion: "0.1.0",
      modules: ["auth"],
      moduleCatalog
    });
    await expect(applyAdoptionPlan(selectedPlan, await applicationOptions({
      moduleCatalog,
      hooks: { afterComposition: () => { throw new Error("injected outer failure"); } }
    }))).rejects.toEqual(expect.objectContaining({ code: "adopt.rolledBack" }));
    await expect(readFile(path.join(selectedRoot, "src", "flower", "auth.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(selectedRoot, ".flower", "project.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const adapterRoot = await root();
    await rm(path.join(adapterRoot, "AGENTS.md"));
    const adapterInspection = await inspectAdoptionProject(adapterRoot, noGit);
    const preliminary = await createAdoptionPlan(adapterInspection, {
      projectId: "existing-app", projectName: "Existing App", flowerVersion: "0.1.0"
    });
    const metadata = createAdoptionMetadataDocuments({ ...preliminary, adapters: ["codex"] });
    const adapterProject = JSON.parse(metadata.find(({ path: documentPath }) => documentPath === ".flower/project.json")!.contents) as ProjectManifest;
    const adapterOwnership = JSON.parse(metadata.find(({ path: documentPath }) => documentPath === ".flower/ownership.json")!.contents) as OwnershipManifest;
    const adapterBundle = createAgentAdapterBundle({
      project: adapterProject,
      ownership: adapterOwnership,
      workflows: [{ schemaVersion: 1, id: "feature", version: 1, description: "Fixture", inputs: [], steps: [] }],
      architecturePolicyPaths: [],
      decisionPaths: [],
      notesPath: "docs/agent-notes.md"
    });
    const adapterPlan = await createAdoptionPlan(adapterInspection, {
      projectId: "existing-app",
      projectName: "Existing App",
      flowerVersion: "0.1.0",
      adapters: ["codex"],
      adapterBundle
    });
    await expect(applyAdoptionPlan(adapterPlan, await applicationOptions({
      adapterBundle,
      adapterStateSchema: await json(path.join(repositoryRoot, "schemas", "adapter-state", "v1.json")),
      hooks: { afterComposition: () => { throw new Error("injected adapter outer failure"); } }
    }))).rejects.toEqual(expect.objectContaining({ code: "adopt.rolledBack" }));
    await expect(readFile(path.join(adapterRoot, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(adapterRoot, ".flower", "project.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const driftRoot = await root();
    const driftPlan = await plan(driftRoot);
    await applyAdoptionPlan(driftPlan, await applicationOptions());
    await writeFile(path.join(driftRoot, ".flower", "adoption.json"), "{}\n");
    await expect(loadAppliedAdoptionPlan(driftRoot)).rejects.toEqual(
      expect.objectContaining({ code: "adopt.invalidRecord" })
    );
    await expect(applyAdoptionPlan(driftPlan, await applicationOptions())).rejects.toBeInstanceOf(AdoptionApplicationError);
  });
});
