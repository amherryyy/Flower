import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdoptionInspectionError,
  inspectAdoptionProject,
  type CommandRunner
} from "../packages/kernel/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "flower-adopt-inspect-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function write(root: string, relative: string, content = ""): Promise<void> {
  const target = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function snapshot(root: string, relative = ""): Promise<Array<[string, string]>> {
  const directory = path.join(root, ...relative.split("/").filter(Boolean));
  const entries = await readdir(directory, { withFileTypes: true });
  const result: Array<[string, string]> = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await snapshot(root, child));
    else if (entry.isFile()) result.push([child, await readFile(path.join(root, ...child.split("/")), "utf8")]);
    else result.push([child, "<non-file>"]);
  }
  return result;
}

function gitRunner(root: string, options: { dirty?: boolean; ancestor?: string } = {}): CommandRunner {
  return async ({ executable, args, cwd }) => {
    expect(executable).toBe("git");
    expect(cwd).toBe(root);
    const command = args.join(" ");
    if (command === "rev-parse --show-toplevel") {
      return { exitCode: 0, stdout: `${options.ancestor ?? root}\n`, stderr: "" };
    }
    if (command === "status --porcelain=v1 --branch --untracked-files=normal") {
      return { exitCode: 0, stdout: `## main...origin/main\n${options.dirty ? " M src/app.ts\n" : ""}`, stderr: "" };
    }
    if (command === "rev-parse --verify HEAD") {
      return { exitCode: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
    }
    throw new Error(`Unexpected command: ${command}`);
  };
}

const noGit: CommandRunner = async () => ({ exitCode: 128, stdout: "", stderr: "not a git repository" });

describe("F7 adoption inspection", () => {
  it("inspects a Next.js/Supabase project deterministically without changing a byte", async () => {
    const root = await temporaryDirectory();
    await write(root, "package.json", `${JSON.stringify({
      name: "existing-app",
      packageManager: "npm@11.0.0",
      dependencies: { next: "15.0.0", "@supabase/supabase-js": "2.0.0" },
      devDependencies: { typescript: "5.0.0" }
    }, null, 2)}\n`);
    await write(root, "package-lock.json", "{}\n");
    await write(root, "tsconfig.json", "{}\n");
    await write(root, "next.config.ts", "export default {};\n");
    await write(root, "supabase/config.toml", "project_id = \"existing-app\"\n");
    await mkdir(path.join(root, "supabase", "migrations"), { recursive: true });
    await write(root, ".github/workflows/ci.yml", "name: CI\n");
    await write(root, "AGENTS.md", "# Existing instructions\n");
    const before = await snapshot(root);

    const first = await inspectAdoptionProject(root, gitRunner(root));
    const second = await inspectAdoptionProject(root, gitRunner(root));

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      command: "adopt-inspect",
      state: "ready",
      alreadyManaged: false,
      stack: {
        languages: ["typescript"],
        runtimes: ["node"],
        web: ["nextjs"],
        databases: ["supabase-postgres"]
      },
      packageManager: { state: "detected", selected: "npm", declared: "npm@11.0.0" },
      databasePaths: ["supabase/config.toml", "supabase/migrations"],
      ci: { providers: ["github-actions"], files: [".github/workflows/ci.yml"] },
      agentInstructions: ["AGENTS.md"],
      git: {
        present: true,
        repositoryRoot: "project",
        branch: "main",
        head: "a".repeat(40),
        detached: false,
        dirty: false
      },
      diagnostics: []
    });
    expect(await snapshot(root)).toEqual(before);
  });

  it("blocks conflicting package-manager and web-framework evidence", async () => {
    const root = await temporaryDirectory();
    await write(root, "package.json", JSON.stringify({
      packageManager: "npm@11",
      dependencies: { next: "15.0.0", "@remix-run/react": "2.0.0" }
    }));
    await write(root, "package-lock.json", "{}");
    await write(root, "yarn.lock", "");

    const result = await inspectAdoptionProject(root, noGit);
    expect(result.state).toBe("blocked");
    expect(result.packageManager.state).toBe("ambiguous");
    expect(result.stack.web).toEqual(["nextjs", "remix"]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "adopt.ambiguousPackageManager", severity: "error" }),
      expect.objectContaining({ code: "adopt.ambiguousWebStack", severity: "error" })
    ]));
    expect(result.diagnostics).toEqual([...result.diagnostics].sort((left, right) =>
      left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message)
    ));
  });

  it("blocks existing Flower control state and distinguishes managed projects", async () => {
    const conflicting = await temporaryDirectory();
    await mkdir(path.join(conflicting, ".flower"));
    const conflictResult = await inspectAdoptionProject(conflicting, noGit);
    expect(conflictResult).toMatchObject({ state: "blocked", alreadyManaged: false });
    expect(conflictResult.diagnostics).toContainEqual(expect.objectContaining({ code: "adopt.controlDirectoryConflict" }));

    const managed = await temporaryDirectory();
    await write(managed, ".flower/project.json", "{}\n");
    const managedResult = await inspectAdoptionProject(managed, noGit);
    expect(managedResult).toMatchObject({ state: "blocked", alreadyManaged: true });
    expect(managedResult.diagnostics).toContainEqual(expect.objectContaining({ code: "adopt.alreadyManaged" }));
  });

  it("reports malformed manifests, missing evidence, dirty ancestor Git state, and ignored symlinks", async () => {
    const root = await temporaryDirectory();
    const ancestor = path.dirname(root);
    await write(root, "package.json", "{not-json\n");
    await write(root, "outside.yml", "name: outside\n");
    const workflowDirectory = path.join(root, ".github", "workflows");
    await mkdir(workflowDirectory, { recursive: true });
    let workflowLinkCreated = false;
    try {
      await symlink(path.join(root, "outside.yml"), path.join(workflowDirectory, "linked.yml"), "file");
      workflowLinkCreated = true;
    } catch (error) {
      if (process.platform !== "win32") throw error;
    }

    const result = await inspectAdoptionProject(root, gitRunner(root, { dirty: true, ancestor }));
    expect(result.state).toBe("blocked");
    expect(result.git).toMatchObject({ present: true, repositoryRoot: "ancestor", dirty: true });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "adopt.invalidPackageManifest" }),
      expect.objectContaining({ code: "adopt.packageManagerMissing" }),
      expect.objectContaining({ code: "adopt.gitAncestorRoot" }),
      expect.objectContaining({ code: "adopt.gitDirty" })
    ]));
    if (workflowLinkCreated) {
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: "adopt.symlinkEvidenceIgnored",
        path: ".github/workflows/linked.yml"
      }));
    }
  });

  it("rejects missing and symbolic-link target roots", async () => {
    const parent = await temporaryDirectory();
    await expect(inspectAdoptionProject(path.join(parent, "missing"), noGit)).rejects.toEqual(
      expect.objectContaining<Partial<AdoptionInspectionError>>({ code: "adopt.targetMissing" })
    );
    const actual = path.join(parent, "actual");
    const linked = path.join(parent, "linked");
    await mkdir(actual);
    let targetLinkCreated = false;
    try {
      await symlink(actual, linked, process.platform === "win32" ? "junction" : "dir");
      targetLinkCreated = true;
    } catch (error) {
      if (process.platform !== "win32") throw error;
    }
    if (targetLinkCreated) {
      await expect(inspectAdoptionProject(linked, noGit)).rejects.toEqual(
        expect.objectContaining<Partial<AdoptionInspectionError>>({ code: "adopt.unsafeTarget" })
      );
    }
  });
});
