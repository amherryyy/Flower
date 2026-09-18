import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyInitPlan,
  applyModuleAddPlan,
  applyModuleDispositionPlan,
  classifyPath,
  createInitPlan,
  createModuleAddPlan,
  createModuleDispositionPlan,
  loadAndVerifyTemplate,
  loadModuleCatalog,
  type OwnershipManifest,
  type VerifiedModulePackage
} from "../packages/kernel/src/index.js";

const temporaryDirectories: string[] = [];
const root = path.resolve(import.meta.dirname, "..");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function catalog(): Promise<VerifiedModulePackage[]> {
  const schema = await json(path.join(root, "schemas/module/v1.json"));
  return loadModuleCatalog(path.join(root, "tests/fixtures/module-catalog"), schema as object);
}

async function installedProject(): Promise<{ projectRoot: string; modules: VerifiedModulePackage[] }> {
  const parent = await mkdtemp(path.join(tmpdir(), "flower-module-disposition-"));
  temporaryDirectories.push(parent);
  const projectRoot = path.join(parent, "project");
  const template = await loadAndVerifyTemplate(path.join(root, "templates/next-supabase"));
  const initPlan = await createInitPlan({
    target: projectRoot,
    projectId: "disposition-project",
    projectName: "Disposition Project",
    templateId: "next-supabase",
    packageManager: "npm",
    install: false,
    initializeGit: false
  }, template);
  await applyInitPlan(initPlan, template);
  const modules = await catalog();
  await applyModuleAddPlan(await createModuleAddPlan(projectRoot, ["organizations"], modules), modules);
  return { projectRoot, modules };
}

describe("module removal", () => {
  it("refuses to remove dependencies required by installed modules", async () => {
    const { projectRoot, modules } = await installedProject();
    await expect(createModuleDispositionPlan(projectRoot, "auth", "remove", modules)).rejects.toMatchObject({
      code: "module.requiredByInstalled"
    });
    await expect(createModuleDispositionPlan(projectRoot, "auth", "eject", modules)).rejects.toMatchObject({
      code: "module.requiredByInstalled"
    });
  });

  it("removes pristine generated files and metadata transactionally", async () => {
    const { projectRoot, modules } = await installedProject();
    const plan = await createModuleDispositionPlan(projectRoot, "organizations", "remove", modules);
    expect(plan.files.map((file) => file.path)).toEqual(["src/flower/organizations.ts"]);
    const result = await applyModuleDispositionPlan(plan, modules);
    const project = await json(path.join(projectRoot, ".flower/project.json")) as { modules: Record<string, string> };
    const lock = await json(path.join(projectRoot, ".flower/lock.json")) as { modules: Record<string, unknown>; generatedFiles: Record<string, string> };

    expect(result.status).toBe("completed");
    expect(project.modules).toEqual({ auth: "1.0.0" });
    expect(lock.modules).not.toHaveProperty("organizations");
    expect(lock.generatedFiles).not.toHaveProperty("src/flower/organizations.ts");
    await expect(readFile(path.join(projectRoot, "src/flower/organizations.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(projectRoot, "src/flower/auth.ts"), "utf8")).toContain("authModule");

    const repeated = await createModuleDispositionPlan(projectRoot, "organizations", "remove", modules);
    expect(repeated.state).toBe("unchanged");
    await expect(applyModuleDispositionPlan(repeated, modules)).resolves.toEqual(expect.objectContaining({ status: "unchanged" }));
  });

  it("rejects drift and rolls back files and metadata when journaling fails", async () => {
    const drift = await installedProject();
    await writeFile(path.join(drift.projectRoot, "src/flower/organizations.ts"), "modified\n");
    await expect(createModuleDispositionPlan(drift.projectRoot, "organizations", "remove", drift.modules)).rejects.toMatchObject({
      code: "module.generatedFileDrift"
    });

    const rollback = await installedProject();
    const plan = await createModuleDispositionPlan(rollback.projectRoot, "organizations", "remove", rollback.modules);
    const projectBefore = await readFile(path.join(rollback.projectRoot, ".flower/project.json"), "utf8");
    const lockBefore = await readFile(path.join(rollback.projectRoot, ".flower/lock.json"), "utf8");
    const generatedBefore = await readFile(path.join(rollback.projectRoot, "src/flower/organizations.ts"), "utf8");
    const journal = path.join(rollback.projectRoot, ".flower/journal");
    await rm(journal, { recursive: true, force: true });
    await writeFile(journal, "blocks journal\n");

    await expect(applyModuleDispositionPlan(plan, rollback.modules)).rejects.toMatchObject({
      code: "module.rolledBack",
      rollbackComplete: true
    });
    expect(await readFile(path.join(rollback.projectRoot, ".flower/project.json"), "utf8")).toBe(projectBefore);
    expect(await readFile(path.join(rollback.projectRoot, ".flower/lock.json"), "utf8")).toBe(lockBefore);
    expect(await readFile(path.join(rollback.projectRoot, "src/flower/organizations.ts"), "utf8")).toBe(generatedBefore);
  });
});

describe("module ejection", () => {
  it("preserves current files and transfers them to project ownership", async () => {
    const { projectRoot, modules } = await installedProject();
    const generatedPath = path.join(projectRoot, "src/flower/organizations.ts");
    await writeFile(generatedPath, "project customization\n");
    const plan = await createModuleDispositionPlan(projectRoot, "organizations", "eject", modules);
    const result = await applyModuleDispositionPlan(plan, modules);
    const project = await json(path.join(projectRoot, ".flower/project.json")) as { modules: Record<string, string> };
    const lock = await json(path.join(projectRoot, ".flower/lock.json")) as { generatedFiles: Record<string, string> };
    const ownership = await json(path.join(projectRoot, ".flower/ownership.json")) as OwnershipManifest;

    expect(result.status).toBe("completed");
    expect(await readFile(generatedPath, "utf8")).toBe("project customization\n");
    expect(project.modules).not.toHaveProperty("organizations");
    expect(lock.generatedFiles).not.toHaveProperty("src/flower/organizations.ts");
    expect(classifyPath(ownership, "src/flower/organizations.ts").rule).toEqual({
      pattern: "src/flower/organizations.ts",
      owner: "project",
      policy: "never-overwrite"
    });
  });

  it("restores ownership and metadata when ejection journaling fails", async () => {
    const { projectRoot, modules } = await installedProject();
    const plan = await createModuleDispositionPlan(projectRoot, "organizations", "eject", modules);
    const projectBefore = await readFile(path.join(projectRoot, ".flower/project.json"), "utf8");
    const lockBefore = await readFile(path.join(projectRoot, ".flower/lock.json"), "utf8");
    const ownershipBefore = await readFile(path.join(projectRoot, ".flower/ownership.json"), "utf8");
    const journal = path.join(projectRoot, ".flower/journal");
    await rm(journal, { recursive: true, force: true });
    await writeFile(journal, "blocks journal\n");

    await expect(applyModuleDispositionPlan(plan, modules)).rejects.toMatchObject({
      code: "module.rolledBack",
      rollbackComplete: true
    });
    expect(await readFile(path.join(projectRoot, ".flower/project.json"), "utf8")).toBe(projectBefore);
    expect(await readFile(path.join(projectRoot, ".flower/lock.json"), "utf8")).toBe(lockBefore);
    expect(await readFile(path.join(projectRoot, ".flower/ownership.json"), "utf8")).toBe(ownershipBefore);
    expect(await readFile(path.join(projectRoot, "src/flower/organizations.ts"), "utf8")).toContain("organizationsModule");
  });
});
