import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  InitializationError,
  applyInitPlan,
  createInitPlan,
  loadAndVerifyTemplate,
  packageManager,
  verifyInitPlan,
  type CommandRunner
} from "../packages/kernel/src/index.js";

const temporaryDirectories: string[] = [];
const templateRoot = path.resolve(import.meta.dirname, "../templates/next-supabase");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryRoot(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("F2 project initialization", () => {
  it("verifies the bundled template and produces a deterministic dry-run plan", async () => {
    const template = await loadAndVerifyTemplate(templateRoot);
    const parent = await temporaryRoot("flower-plan-");
    const options = {
      target: path.join(parent, "sample-app"),
      projectId: "sample-app",
      projectName: "Sample App",
      templateId: "next-supabase",
      packageManager: "npm" as const,
      install: true,
      initializeGit: false
    };

    const first = await createInitPlan(options, template);
    const second = await createInitPlan(options, template);

    expect(first).toEqual(second);
    expect(first.planId).toMatch(/^init-[a-f0-9]{12}$/);
    expect(first.template.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.actions).toContainEqual(expect.objectContaining({ kind: "install-dependencies" }));
    expect(first.actions.filter((action) => action.kind === "run-script")).toHaveLength(4);
    await expect(readdir(options.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("materializes manifests and a thin project without invoking commands when installation is skipped", async () => {
    const template = await loadAndVerifyTemplate(templateRoot);
    const parent = await temporaryRoot("flower-apply-");
    const target = path.join(parent, "sample-app");
    const plan = await createInitPlan({
      target,
      projectId: "sample-app",
      projectName: "Sample \"App\"",
      templateId: "next-supabase",
      packageManager: "npm",
      install: false,
      initializeGit: false
    }, template);
    const runner: CommandRunner = async () => {
      throw new Error("runner should not be called");
    };

    const result = await applyInitPlan(plan, template, runner);
    const project = JSON.parse(await readFile(path.join(target, ".flower/project.json"), "utf8")) as { project: { id: string; name: string } };
    const lock = JSON.parse(await readFile(path.join(target, ".flower/lock.json"), "utf8")) as { template: { digest: string } };

    expect(result.status).toBe("completed");
    expect(project.project).toEqual({ id: "sample-app", name: "Sample \"App\"" });
    expect(lock.template.digest).toBe(template.digest);
    expect(await readFile(path.join(target, ".gitignore"), "utf8")).toContain("node_modules/");
    expect(result.journalPath).toContain(path.join(".flower", "journal", "local"));

    const repeatedPlan = await createInitPlan({
      target,
      projectId: "sample-app",
      projectName: "Sample \"App\"",
      templateId: "next-supabase",
      packageManager: "npm",
      install: false,
      initializeGit: false
    }, template);
    expect(repeatedPlan.state).toBe("unchanged");
    await expect(applyInitPlan(repeatedPlan, template, runner)).resolves.toEqual({
      status: "unchanged",
      planId: repeatedPlan.planId,
      target,
      changedPaths: []
    });
  });

  it("rolls back every created path when a package-manager command fails", async () => {
    const template = await loadAndVerifyTemplate(templateRoot);
    const target = await temporaryRoot("flower-rollback-");
    const plan = await createInitPlan({
      target,
      projectId: "rollback-app",
      projectName: "Rollback App",
      templateId: "next-supabase",
      packageManager: "npm",
      install: true,
      initializeGit: false
    }, template);
    const runner: CommandRunner = async () => ({ exitCode: 1, stdout: "", stderr: "simulated failure" });

    await expect(applyInitPlan(plan, template, runner)).rejects.toMatchObject({
      code: "init.rolledBack",
      rollbackComplete: true
    });
    expect(await readdir(target)).toEqual([]);
  });

  it("rejects changed templates, non-empty targets, tampered plans, and unsupported package managers", async () => {
    const copyRoot = await temporaryRoot("flower-template-");
    const copiedTemplate = path.join(copyRoot, "next-supabase");
    await cp(templateRoot, copiedTemplate, { recursive: true });
    await writeFile(path.join(copiedTemplate, "app/page.tsx"), "changed\n");
    await expect(loadAndVerifyTemplate(copiedTemplate)).rejects.toThrow(
      /digest mismatch for 'app\/page\.tsx': expected sha256:[a-f0-9]{64}, received sha256:[a-f0-9]{64}/
    );
    expect(() => packageManager("pnpm")).toThrow(/Unsupported package manager/);

    const template = await loadAndVerifyTemplate(templateRoot);
    const target = await temporaryRoot("flower-nonempty-");
    await writeFile(path.join(target, "keep.txt"), "keep\n");
    await expect(createInitPlan({
      target,
      projectId: "sample-app",
      projectName: "Sample App",
      templateId: "next-supabase",
      packageManager: "npm",
      install: false,
      initializeGit: false
    }, template)).rejects.toBeInstanceOf(InitializationError);

    const emptyTarget = path.join(copyRoot, "planned-app");
    const plan = await createInitPlan({
      target: emptyTarget,
      projectId: "planned-app",
      projectName: "Planned App",
      templateId: "next-supabase",
      packageManager: "npm",
      install: false,
      initializeGit: false
    }, template);
    expect(() => verifyInitPlan({ ...plan, project: { ...plan.project, name: "Tampered" } })).toThrow(/digest/);
  });
});
