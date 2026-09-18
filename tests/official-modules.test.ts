import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyInitPlan,
  applyModuleAddPlan,
  applyModuleDispositionPlan,
  createInitPlan,
  createMigrationPlan,
  createModuleAddPlan,
  createModuleDispositionPlan,
  loadAndVerifyTemplate,
  loadModuleCatalog,
  resolveModules,
  type VerifiedModulePackage
} from "../packages/kernel/src/index.js";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function officialCatalog(): Promise<VerifiedModulePackage[]> {
  const schema = await json(path.join(root, "schemas/module/v1.json"));
  return loadModuleCatalog(path.join(root, "modules"), schema as object);
}

async function initializedProject(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), "flower-official-modules-"));
  temporaryDirectories.push(parent);
  const projectRoot = path.join(parent, "project");
  const template = await loadAndVerifyTemplate(path.join(root, "templates/next-supabase"));
  const plan = await createInitPlan({
    target: projectRoot,
    projectId: "official-module-project",
    projectName: "Official Module Project",
    templateId: "next-supabase",
    packageManager: "npm",
    install: false,
    initializeGit: false
  }, template);
  await applyInitPlan(plan, template);
  return projectRoot;
}

describe("official module catalog", () => {
  it("loads four valid, digest-protected packages", async () => {
    const catalog = await officialCatalog();
    expect(catalog.map(({ manifest }) => manifest.id)).toEqual(["audit", "auth", "organizations", "rbac"]);
    const expectedMigrations: Record<string, string[]> = {
      audit: ["audit-001"],
      auth: [],
      organizations: ["organizations-001"],
      rbac: ["rbac-001"]
    };
    for (const modulePackage of catalog) {
      expect(modulePackage.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(modulePackage.configurationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(modulePackage.manifest.migrations).toEqual(expectedMigrations[modulePackage.manifest.id]);
      expect(modulePackage.migrations.map(({ id }) => id)).toEqual(expectedMigrations[modulePackage.manifest.id]);
      expect(modulePackage.artifacts).toHaveLength(1);
    }
  });

  it("resolves the documented capability graph deterministically", async () => {
    const catalog = await officialCatalog();
    const resolution = resolveModules(catalog.map(({ manifest }) => manifest), ["rbac", "audit"]);
    expect(resolution.valid).toBe(true);
    expect(resolution.diagnostics).toEqual([]);
    expect(resolution.requested).toEqual(["audit", "rbac"]);
    expect(resolution.resolved).toEqual(["auth", "organizations", "audit", "rbac"]);
    const migrationPlan = createMigrationPlan(catalog, ["rbac", "audit"]);
    expect(migrationPlan.actions.map(({ id }) => id)).toEqual(["organizations-001", "audit-001", "rbac-001"]);
  });

  it("ships a fail-closed tenant schema baseline", async () => {
    const catalog = await officialCatalog();
    const sql = (await Promise.all(catalog.flatMap(({ migrations }) =>
      migrations.map(({ sourcePath }) => readFile(sourcePath, "utf8"))
    ))).join("\n").toLowerCase();

    expect(sql).toContain("create table public.organizations");
    expect(sql).toContain("create table public.organization_memberships");
    expect(sql).toContain("create table public.roles");
    expect(sql).toContain("create table public.role_permissions");
    expect(sql).toContain("create table public.audit_events");
    expect(sql.match(/enable row level security/g)).toHaveLength(5);
    expect(sql).toContain("foreign key (organization_id, role_id)");
    expect(sql).not.toContain("create policy");
  });

  it("composes, guards dependencies, removes, and ejects a golden project", async () => {
    const projectRoot = await initializedProject();
    const catalog = await officialCatalog();
    const addPlan = await createModuleAddPlan(projectRoot, ["rbac", "audit"], catalog);
    expect(addPlan.resolved).toEqual(["auth", "organizations", "audit", "rbac"]);
    await applyModuleAddPlan(addPlan, catalog);

    const project = await json(path.join(projectRoot, ".flower/project.json")) as { modules: Record<string, string> };
    const lock = await json(path.join(projectRoot, ".flower/lock.json")) as {
      modules: Record<string, { digest: string }>;
      generatedFiles: Record<string, string>;
    };
    expect(project.modules).toEqual({ auth: "1.0.0", organizations: "1.0.0", audit: "1.0.0", rbac: "1.0.0" });
    expect(Object.keys(lock.modules).sort()).toEqual(["audit", "auth", "organizations", "rbac"]);
    expect(Object.keys(lock.generatedFiles).sort()).toEqual([
      "src/flower/audit.ts",
      "src/flower/auth.ts",
      "src/flower/organizations.ts",
      "src/flower/rbac.ts"
    ]);
    await expect(createModuleDispositionPlan(projectRoot, "organizations", "remove", catalog)).rejects.toMatchObject({
      code: "module.requiredByInstalled"
    });

    await applyModuleDispositionPlan(await createModuleDispositionPlan(projectRoot, "rbac", "remove", catalog), catalog);
    await applyModuleDispositionPlan(await createModuleDispositionPlan(projectRoot, "audit", "eject", catalog), catalog);
    const finalProject = await json(path.join(projectRoot, ".flower/project.json")) as { modules: Record<string, string> };
    const ownership = await json(path.join(projectRoot, ".flower/ownership.json")) as {
      rules: Array<{ pattern: string; owner: string }>;
    };
    expect(finalProject.modules).toEqual({ auth: "1.0.0", organizations: "1.0.0" });
    await expect(readFile(path.join(projectRoot, "src/flower/rbac.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(projectRoot, "src/flower/audit.ts"), "utf8")).toContain("flowerAuditModule");
    expect(ownership.rules).toContainEqual(expect.objectContaining({
      pattern: "src/flower/audit.ts",
      owner: "project"
    }));
  });
});
