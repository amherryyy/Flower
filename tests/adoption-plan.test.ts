import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAdoptionPlan,
  inspectAdoptionProject,
  verifyAdoptionPlan,
  type CommandRunner
} from "../packages/kernel/src/index.js";

const temporaryDirectories: string[] = [];
const noGit: CommandRunner = async () => ({ exitCode: 128, stdout: "", stderr: "not a repository" });

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "flower-adopt-plan-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function write(base: string, relative: string, contents: string): Promise<void> {
  const target = path.join(base, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
}

async function fixture(): Promise<string> {
  const directory = await root();
  await write(directory, "package.json", JSON.stringify({ packageManager: "npm@11", dependencies: { next: "15.0.0" } }));
  await write(directory, "package-lock.json", "{}\n");
  await write(directory, "tsconfig.json", "{}\n");
  await write(directory, "src/app.ts", "export const app = true;\n");
  await write(directory, "node_modules/ignored/index.js", "ignored\n");
  return directory;
}

describe("F7 adoption planning", () => {
  it("creates a deterministic digest-protected plan with project-owned existing files", async () => {
    const directory = await fixture();
    const inspection = await inspectAdoptionProject(directory, noGit);
    const options = {
      projectId: "existing-app",
      projectName: "Existing App",
      flowerVersion: "0.1.0",
      modules: ["rbac", "auth", "auth"],
      adapters: ["codex"] as const
    };
    const first = await createAdoptionPlan(inspection, options);
    const second = await createAdoptionPlan(inspection, { ...options, modules: [...options.modules].reverse() });

    expect(first).toEqual(second);
    expect(first.state).toBe("apply");
    expect(first.modules).toEqual(["auth", "rbac"]);
    expect(first.classifications.map(({ path }) => path)).toEqual([
      "package-lock.json", "package.json", "src/app.ts", "tsconfig.json"
    ]);
    expect(first.classifications.every(({ owner, policy }) => owner === "project" && policy === "never-overwrite")).toBe(true);
    expect(first.excludedLocalRoots).toContain("node_modules");
    expect(first.metadata.map(({ path }) => path)).toEqual([
      ".flower/project.json", ".flower/ownership.json", ".flower/lock.json"
    ]);
    expect(first.planId).toMatch(/^adopt-[a-f0-9]{16}$/);
    expect(() => verifyAdoptionPlan(first)).not.toThrow();

    await write(directory, "src/app.ts", "export const app = false;\n");
    const changedInspection = await inspectAdoptionProject(directory, noGit);
    const changed = await createAdoptionPlan(changedInspection, options);
    expect(changed.preconditions.projectStateDigest).not.toBe(first.preconditions.projectStateDigest);
    expect(changed.planId).not.toBe(first.planId);
  });

  it("blocks requested adapters that overlap existing instructions or CI", async () => {
    const directory = await fixture();
    await write(directory, "AGENTS.md", "existing\n");
    await write(directory, ".github/workflows/ci.yml", "name: CI\n");
    const inspection = await inspectAdoptionProject(directory, noGit);
    const plan = await createAdoptionPlan(inspection, {
      projectId: "existing-app",
      projectName: "Existing App",
      flowerVersion: "0.1.0",
      adapters: ["github-actions", "codex"]
    });
    expect(plan.state).toBe("blocked");
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ path: ".github/workflows", reason: "existing-ci-workflow" }),
      expect.objectContaining({ path: "AGENTS.md", reason: "existing-agent-instructions" })
    ]);
  });

  it("blocks symbolic links and detects plan tampering", async () => {
    const directory = await fixture();
    const outside = await root();
    let linked = false;
    try {
      await symlink(outside, path.join(directory, "linked"), process.platform === "win32" ? "junction" : "dir");
      linked = true;
    } catch (error) {
      if (process.platform !== "win32") throw error;
    }
    const inspection = await inspectAdoptionProject(directory, noGit);
    const plan = await createAdoptionPlan(inspection, {
      projectId: "existing-app",
      projectName: "Existing App",
      flowerVersion: "0.1.0"
    });
    if (linked) {
      expect(plan.state).toBe("blocked");
      expect(plan.conflicts).toContainEqual(expect.objectContaining({ path: "linked", reason: "symbolic-link" }));
    }
    expect(() => verifyAdoptionPlan({ ...plan, project: { ...plan.project, name: "Tampered" } }))
      .toThrowError(expect.objectContaining({ code: "adopt.invalidPlan" }));
  });

  it("rejects blocked inspections and package managers not yet supported for application", async () => {
    const ambiguous = await fixture();
    await write(ambiguous, "yarn.lock", "");
    const blocked = await inspectAdoptionProject(ambiguous, noGit);
    await expect(createAdoptionPlan(blocked, {
      projectId: "existing-app", projectName: "Existing App", flowerVersion: "0.1.0"
    })).rejects.toEqual(expect.objectContaining({ code: "adopt.inspectionBlocked" }));

    const pnpm = await root();
    await write(pnpm, "package.json", JSON.stringify({ packageManager: "pnpm@10", dependencies: { next: "15" } }));
    await write(pnpm, "pnpm-lock.yaml", "lockfileVersion: 9\n");
    const inspected = await inspectAdoptionProject(pnpm, noGit);
    await expect(createAdoptionPlan(inspected, {
      projectId: "existing-app", projectName: "Existing App", flowerVersion: "0.1.0"
    })).rejects.toEqual(expect.objectContaining({ code: "adopt.packageManagerUnsupported" }));
  });
});
