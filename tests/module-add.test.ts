import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyInitPlan,
  applyModuleAddPlan,
  createInitPlan,
  createModuleAddPlan,
  loadAndVerifyTemplate,
  loadModuleCatalog,
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

async function moduleCatalog(): Promise<VerifiedModulePackage[]> {
  const schema = await json(path.join(root, "schemas/module/v1.json"));
  return loadModuleCatalog(path.join(root, "tests/fixtures/module-catalog"), schema as object);
}

async function initializedProject(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), "flower-module-add-"));
  temporaryDirectories.push(parent);
  const target = path.join(parent, "project");
  const template = await loadAndVerifyTemplate(path.join(root, "templates/next-supabase"));
  const plan = await createInitPlan({
    target,
    projectId: "module-project",
    projectName: "Module Project",
    templateId: "next-supabase",
    packageManager: "npm",
    install: false,
    initializeGit: false
  }, template);
  await applyInitPlan(plan, template);
  return target;
}

describe("transactional module addition", () => {
  it("plans and installs transitive modules with generated-file checksums", async () => {
    const projectRoot = await initializedProject();
    const catalog = await moduleCatalog();
    const plan = await createModuleAddPlan(projectRoot, ["organizations"], catalog);

    expect(plan.state).toBe("apply");
    expect(plan.resolved).toEqual(["auth", "organizations"]);
    expect(plan.modules.map((module) => module.id)).toEqual(["auth", "organizations"]);
    await expect(readFile(path.join(projectRoot, "src/flower/auth.ts"))).rejects.toMatchObject({ code: "ENOENT" });

    const result = await applyModuleAddPlan(plan, catalog);
    const project = await json(path.join(projectRoot, ".flower/project.json")) as { modules: Record<string, string> };
    const lock = await json(path.join(projectRoot, ".flower/lock.json")) as {
      modules: Record<string, { version: string; digest: string }>;
      generatedFiles: Record<string, string>;
    };
    expect(result.status).toBe("completed");
    expect(project.modules).toEqual({ auth: "1.0.0", organizations: "1.0.0" });
    expect(lock.modules.auth?.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(lock.generatedFiles["src/flower/auth.ts"]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await readFile(path.join(projectRoot, "src/flower/organizations.ts"), "utf8")).toContain('id: "organizations"');

    const repeatedPlan = await createModuleAddPlan(projectRoot, ["organizations"], catalog);
    expect(repeatedPlan.state).toBe("unchanged");
    await expect(applyModuleAddPlan(repeatedPlan, catalog)).resolves.toEqual({
      status: "unchanged",
      planId: repeatedPlan.planId,
      projectRoot,
      installedModules: [],
      changedPaths: []
    });

    await writeFile(path.join(projectRoot, "src/flower/auth.ts"), "tampered\n");
    await expect(createModuleAddPlan(projectRoot, ["organizations"], catalog)).rejects.toMatchObject({
      code: "module.generatedFileDrift"
    });
  });

  it("rejects existing generated paths and project drift before writes", async () => {
    const catalog = await moduleCatalog();
    const collisionRoot = await initializedProject();
    await mkdir(path.join(collisionRoot, "src/flower"), { recursive: true });
    await writeFile(path.join(collisionRoot, "src/flower/auth.ts"), "project-owned\n");
    await expect(createModuleAddPlan(collisionRoot, ["auth"], catalog)).rejects.toMatchObject({ code: "module.pathExists" });

    const driftRoot = await initializedProject();
    const plan = await createModuleAddPlan(driftRoot, ["auth"], catalog);
    const projectPath = path.join(driftRoot, ".flower/project.json");
    await writeFile(projectPath, `${await readFile(projectPath, "utf8")} `);
    await expect(applyModuleAddPlan(plan, catalog)).rejects.toMatchObject({ code: "module.projectChanged" });
    await expect(readFile(path.join(driftRoot, "src/flower/auth.ts"))).rejects.toMatchObject({ code: "ENOENT" });

    const modeRoot = await initializedProject();
    const modePath = path.join(modeRoot, ".flower/project.json");
    const modeProject = await json(modePath) as { mode: string };
    modeProject.mode = "framework";
    await writeFile(modePath, `${JSON.stringify(modeProject, null, 2)}\n`);
    await expect(createModuleAddPlan(modeRoot, ["auth"], catalog)).rejects.toMatchObject({ code: "module.invalidProjectMode" });
  });

  it("rejects invalid configuration schemas and module packages changed after planning", async () => {
    const copyRoot = await mkdtemp(path.join(tmpdir(), "flower-module-catalog-"));
    temporaryDirectories.push(copyRoot);
    const catalogRoot = path.join(copyRoot, "catalog");
    await cp(path.join(root, "tests/fixtures/module-catalog"), catalogRoot, { recursive: true });
    const schema = await json(path.join(root, "schemas/module/v1.json"));
    await writeFile(
      path.join(catalogRoot, "auth/schemas/config.json"),
      '{"type":"object","unknownKeyword":true}\n'
    );
    await expect(loadModuleCatalog(catalogRoot, schema as object)).rejects.toThrow(/unknown keyword/);

    await cp(path.join(root, "tests/fixtures/module-catalog/auth/schemas/config.json"), path.join(catalogRoot, "auth/schemas/config.json"));
    const copiedCatalog = await loadModuleCatalog(catalogRoot, schema as object);
    const projectRoot = await initializedProject();
    const plan = await createModuleAddPlan(projectRoot, ["auth"], copiedCatalog);
    await writeFile(path.join(catalogRoot, "auth/generators/src/flower/auth.ts"), "changed\n");
    await expect(applyModuleAddPlan(plan, copiedCatalog)).rejects.toMatchObject({ code: "module.packageChanged" });
    await expect(readFile(path.join(projectRoot, "src/flower/auth.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores manifests and generated files when journaling fails", async () => {
    const projectRoot = await initializedProject();
    const catalog = await moduleCatalog();
    const plan = await createModuleAddPlan(projectRoot, ["organizations"], catalog);
    const originalProject = await readFile(path.join(projectRoot, ".flower/project.json"), "utf8");
    const originalLock = await readFile(path.join(projectRoot, ".flower/lock.json"), "utf8");
    const journalPath = path.join(projectRoot, ".flower/journal");
    await rm(journalPath, { recursive: true, force: true });
    await writeFile(journalPath, "blocks journal directory\n");

    await expect(applyModuleAddPlan(plan, catalog)).rejects.toMatchObject({
      code: "module.rolledBack",
      rollbackComplete: true
    });
    expect(await readFile(path.join(projectRoot, ".flower/project.json"), "utf8")).toBe(originalProject);
    expect(await readFile(path.join(projectRoot, ".flower/lock.json"), "utf8")).toBe(originalLock);
    await expect(readFile(path.join(projectRoot, "src/flower/auth.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(projectRoot, "src/flower/organizations.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
