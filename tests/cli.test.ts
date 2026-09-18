import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "packages", "cli", "dist", "index.js");
const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "flower-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}

function run(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

describe("flower CLI", () => {
  it("prints its version", () => {
    const result = run("--version");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  it("validates a project directory", () => {
    const result = run("validate", "tests/fixtures/valid-project");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Flower validation passed.");
  });

  it("returns JSON diagnostics and a failure code", () => {
    const result = run("validate", "tests/fixtures/invalid-project", "--json");
    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout) as { valid: boolean; diagnostics: unknown[] };
    expect(output.valid).toBe(false);
    expect(output.diagnostics.length).toBeGreaterThan(0);
  });

  it("reports semantic ownership conflicts", () => {
    const result = run("validate", "tests/fixtures/conflicting-ownership");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("ownership.patternConflict");
  });

  it("checks the health of the Flower workspace", () => {
    const result = run("doctor", ".", "--json");
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      healthy: boolean;
      checks: Array<{ id: string; status: string }>;
    };
    expect(output.healthy).toBe(true);
    expect(output.checks).toContainEqual(
      expect.objectContaining({ id: "manifest.validation", status: "pass" })
    );
  });

  it("summarizes project identity and ownership status", () => {
    const result = run("status", ".", "--json");
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      valid: boolean;
      project: { id: string; mode: string };
      modules: string[];
      ownershipRules: number;
    };
    expect(output.valid).toBe(true);
    expect(output.project).toEqual(expect.objectContaining({ id: "flower-framework", mode: "framework" }));
    expect(output.modules).toEqual(["audit", "auth", "cli", "kernel", "organizations", "rbac"]);
    expect(output.ownershipRules).toBeGreaterThan(0);
  });

  it("validates the bundled template manifest with the template schema", () => {
    const result = run("validate", "templates/next-supabase/flower.template.json");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Flower validation passed.");
  });

  it("validates a module manifest with the module schema", () => {
    const result = run("validate", "tests/fixtures/modules/auth/flower.module.json");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Flower validation passed.");
  });

  it("prints a JSON initialization plan without writing the target", () => {
    const parent = temporaryDirectory();
    const target = path.join(parent, "planned-app");
    const result = run("init", target, "--name", "Planned App", "--dry-run", "--json");
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as { command: string; project: { id: string }; actions: unknown[] };
    expect(output.command).toBe("init");
    expect(output.project.id).toBe("planned-app");
    expect(output.actions.length).toBeGreaterThan(10);
    expect(() => readFileSync(path.join(target, "package.json"))).toThrow();
  });

  it("initializes a project transactionally when dependency installation is skipped", () => {
    const parent = temporaryDirectory();
    const target = path.join(parent, "created-app");
    const result = run("init", target, "--name", "Created App", "--skip-install", "--json");
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as { result: { status: string } };
    const project = JSON.parse(readFileSync(path.join(target, ".flower/project.json"), "utf8")) as { project: { name: string } };
    expect(output.result.status).toBe("completed");
    expect(project.project.name).toBe("Created App");
  });

  it("refuses a non-empty initialization target without changing it", () => {
    const target = temporaryDirectory();
    const sentinel = path.join(target, "keep.txt");
    writeFileSync(sentinel, "keep\n");
    const result = run("init", target, "--skip-install", "--json");
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({ code: "init.targetNotEmpty" }));
    expect(readFileSync(sentinel, "utf8")).toBe("keep\n");
  });

  it("rejects unknown initialization options", () => {
    const result = run("init", path.join(temporaryDirectory(), "unknown-option"), "--adopt");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown option: --adopt");
  });

  it("dry-runs and applies a transitive module installation", () => {
    const parent = temporaryDirectory();
    const target = path.join(parent, "module-project");
    expect(run("init", target, "--name", "Module Project", "--skip-install").status).toBe(0);

    const dryRun = run(
      "add",
      "organizations",
      "--project",
      target,
      "--catalog",
      "tests/fixtures/module-catalog",
      "--dry-run",
      "--json"
    );
    expect(dryRun.status).toBe(0);
    const plan = JSON.parse(dryRun.stdout) as { modules: Array<{ id: string }>; files: Array<{ path: string }> };
    expect(plan.modules.map((module) => module.id)).toEqual(["auth", "organizations"]);
    expect(() => readFileSync(path.join(target, "src/flower/auth.ts"))).toThrow();

    const applied = run(
      "add",
      "organizations",
      "--project",
      target,
      "--catalog",
      "tests/fixtures/module-catalog",
      "--json"
    );
    expect(applied.status).toBe(0);
    const project = JSON.parse(readFileSync(path.join(target, ".flower/project.json"), "utf8")) as { modules: Record<string, string> };
    expect(project.modules).toEqual({ auth: "1.0.0", organizations: "1.0.0" });
  });

  it("uses the bundled official module catalog by default", () => {
    const parent = temporaryDirectory();
    const target = path.join(parent, "official-module-project");
    expect(run("init", target, "--name", "Official Module Project", "--skip-install").status).toBe(0);

    const applied = run("add", "rbac", "--project", target, "--json");
    expect(applied.status).toBe(0);
    const project = JSON.parse(readFileSync(path.join(target, ".flower/project.json"), "utf8")) as {
      modules: Record<string, string>;
    };
    expect(project.modules).toEqual({ auth: "1.0.0", organizations: "1.0.0", rbac: "1.0.0" });
    expect(readFileSync(path.join(target, "src/flower/rbac.ts"), "utf8")).toContain("flowerRbacModule");
  });

  it("rejects initialization-only flags for module addition", () => {
    const result = run("add", "auth", "--skip-install");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unsupported option for flower add: --skip-install");
  });

  it("removes and ejects installed modules through the CLI", () => {
    const parent = temporaryDirectory();
    const target = path.join(parent, "disposition-project");
    const catalog = "tests/fixtures/module-catalog";
    expect(run("init", target, "--name", "Disposition Project", "--skip-install").status).toBe(0);
    expect(run("add", "organizations", "--project", target, "--catalog", catalog).status).toBe(0);

    const removed = run("remove", "organizations", "--project", target, "--catalog", catalog, "--json");
    expect(removed.status).toBe(0);
    expect(() => readFileSync(path.join(target, "src/flower/organizations.ts"))).toThrow();

    const ejected = run("eject", "auth", "--project", target, "--catalog", catalog, "--json");
    expect(ejected.status).toBe(0);
    expect(readFileSync(path.join(target, "src/flower/auth.ts"), "utf8")).toContain("authModule");
    const ownership = JSON.parse(readFileSync(path.join(target, ".flower/ownership.json"), "utf8")) as {
      rules: Array<{ pattern: string; owner: string }>;
    };
    expect(ownership.rules).toContainEqual(expect.objectContaining({ pattern: "src/flower/auth.ts", owner: "project" }));
    expect(run("validate", target).status).toBe(0);
  });
});
