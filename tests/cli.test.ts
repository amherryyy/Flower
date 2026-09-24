import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function enableAdapters(projectRoot: string, adapters: Record<string, boolean>): void {
  const manifestPath = path.join(projectRoot, ".flower", "project.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { adapters?: Record<string, boolean> };
  manifest.adapters = adapters;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
    expect(output.modules).toEqual(["audit", "auth", "cli", "kernel", "limits", "organizations", "rbac"]);
    expect(output.ownershipRules).toBeGreaterThan(0);
  });

  it("inspects an existing project for adoption without writing Flower metadata", () => {
    const target = temporaryDirectory();
    writeFileSync(path.join(target, "package.json"), `${JSON.stringify({
      name: "existing-app",
      packageManager: "npm@11",
      dependencies: { next: "15.0.0", "@supabase/supabase-js": "2.0.0" }
    })}\n`);
    writeFileSync(path.join(target, "package-lock.json"), "{}\n");
    writeFileSync(path.join(target, "tsconfig.json"), "{}\n");

    const result = run("adopt", target, "--json");
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      command: string;
      state: string;
      packageManager: { selected?: string };
      stack: { web: string[]; databases: string[] };
    };
    expect(output).toMatchObject({
      command: "adopt-inspect",
      state: "ready",
      packageManager: { selected: "npm" },
      stack: { web: ["nextjs"], databases: ["supabase-postgres"] }
    });
    expect(() => readFileSync(path.join(target, ".flower", "project.json"))).toThrow();
  });

  it("returns a failure code for blocked adoption inspection", () => {
    const target = temporaryDirectory();
    writeFileSync(path.join(target, "package.json"), JSON.stringify({ packageManager: "npm@11" }));
    writeFileSync(path.join(target, "package-lock.json"), "{}");
    writeFileSync(path.join(target, "pnpm-lock.yaml"), "");

    const result = run("adopt", target, "--json");
    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout) as { state: string; diagnostics: Array<{ code: string }> };
    expect(output.state).toBe("blocked");
    expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: "adopt.ambiguousPackageManager" }));
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

  it("validates a migration descriptor with its declared schema", () => {
    const result = run("validate", "modules/organizations/migrations/organizations-001.json");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Flower validation passed.");
  });

  it("validates a security baseline with its declared schema", () => {
    const result = run("validate", ".flower/security.json");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Flower validation passed.");
  });

  it("validates the template upload policy with its declared schema", () => {
    const result = run("validate", "templates/next-supabase/.flower/uploads.json");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Flower validation passed.");
  });

  it("runs the offline security policy gate", () => {
    const result = run("security", "check", "--json");
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as { secure: boolean; summary: { vulnerabilityDatabase: string } };
    expect(output.secure).toBe(true);
    expect(output.summary.vulnerabilityDatabase).toBe("not-configured");
  });

  it("uses the security-policy exit code for a failing gate", () => {
    const directory = temporaryDirectory();
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ dependencies: { unsafe: "latest" } }));
    const control = path.join(directory, ".flower");
    mkdirSync(control);
    writeFileSync(path.join(control, "security.json"), JSON.stringify({
      schemaVersion: 1,
      secretScan: { maxFileBytes: 1048576, exclude: [] },
      dependencies: { requireLockfile: true, forbidUnpinnedTags: true, forbidRemoteSources: true },
      headers: { enabled: false, file: "next.config.ts", required: [], forbiddenContentSecurityPolicyTokens: [] },
      uploads: { enabled: false, policyPath: ".flower/uploads.json" },
      logging: {
        enabled: false,
        include: [],
        forbidConsole: true,
        forbiddenKeys: ["body"],
        redactedKeys: ["secret"],
        allowedKeys: ["code"],
        maxAttributeDepth: 8,
        maxEventBytes: 16384
      }
    }));
    const result = run("security", "check", "--project", directory, "--json");
    expect(result.status).toBe(6);
    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({ secure: false }));
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

  it("dry-runs and transactionally synchronizes enabled agent adapters", () => {
    const parent = temporaryDirectory();
    const target = path.join(parent, "adapter-project");
    expect(run("init", target, "--name", "Adapter Project", "--skip-install").status).toBe(0);
    enableAdapters(target, { codex: true, claude: true });

    const dryRun = run("adapters", "sync", "--project", target, "--dry-run", "--json");
    expect(dryRun.status).toBe(0);
    const plan = JSON.parse(dryRun.stdout) as {
      command: string;
      state: string;
      actions: Array<{ kind: string; path: string }>;
    };
    expect(plan.command).toBe("adapter-materialize");
    expect(plan.state).toBe("apply");
    expect(plan.actions.map(({ kind, path: actionPath }) => [kind, actionPath])).toEqual([
      ["create", "AGENTS.md"],
      ["create", "CLAUDE.md"],
      ["create", ".flower/generated/agent-adapters.json"]
    ]);
    expect(() => readFileSync(path.join(target, "AGENTS.md"))).toThrow();

    const applied = run("adapters", "sync", "--project", target, "--json");
    expect(applied.status).toBe(0);
    const output = JSON.parse(applied.stdout) as { result: { status: string; changedPaths: string[] } };
    expect(output.result.status).toBe("completed");
    expect(output.result.changedPaths).toContain("AGENTS.md");
    expect(readFileSync(path.join(target, "AGENTS.md"), "utf8")).toContain("# Adapter Project — Codex adapter");
    expect(readFileSync(path.join(target, "CLAUDE.md"), "utf8")).toContain("# Adapter Project — Claude adapter");
    expect(run("validate", target).status).toBe(0);
    expect(run("validate", path.join(target, ".flower/generated/agent-adapters.json")).status).toBe(0);
    expect(run("validate", "workflows/feature.json").status).toBe(0);

    const repeated = run("adapters", "sync", "--project", target, "--json");
    expect(repeated.status).toBe(0);
    expect((JSON.parse(repeated.stdout) as { result: { status: string } }).result.status).toBe("unchanged");
  });

  it("synchronizes the GitHub Actions verification adapter", () => {
    const parent = temporaryDirectory();
    const target = path.join(parent, "ci-adapter-project");
    expect(run("init", target, "--name", "CI Adapter Project", "--skip-install").status).toBe(0);
    enableAdapters(target, { githubActions: true });

    const dryRun = run("adapters", "sync", "--project", target, "--dry-run", "--json");
    expect(dryRun.status).toBe(0);
    const plan = JSON.parse(dryRun.stdout) as { actions: Array<{ kind: string; path: string }> };
    expect(plan.actions.map(({ kind, path: actionPath }) => [kind, actionPath])).toEqual([
      ["create", ".github/workflows/flower-generated.yml"],
      ["create", ".flower/generated/agent-adapters.json"]
    ]);

    const applied = run("adapters", "sync", "--project", target, "--json");
    expect(applied.status).toBe(0);
    const workflow = readFileSync(path.join(target, ".github/workflows/flower-generated.yml"), "utf8");
    expect(workflow).toContain("name: Flower generated verification");
    expect(workflow).toContain("run: npm audit --audit-level=high");
    expect(workflow).not.toContain("agent.delegate");
    expect(run("validate", target).status).toBe(0);
  });

  it("reports modified adapter output through sync and project validation", () => {
    const parent = temporaryDirectory();
    const target = path.join(parent, "adapter-drift-project");
    expect(run("init", target, "--name", "Adapter Drift Project", "--skip-install").status).toBe(0);
    enableAdapters(target, { codex: true });
    expect(run("adapters", "sync", "--project", target).status).toBe(0);
    writeFileSync(path.join(target, "AGENTS.md"), "manual edit\n");

    const sync = run("adapters", "sync", "--project", target, "--json");
    expect(sync.status).toBe(1);
    expect(JSON.parse(sync.stdout)).toEqual(expect.objectContaining({ code: "adapter.modified" }));

    const validation = run("validate", target, "--json");
    expect(validation.status).toBe(1);
    const result = JSON.parse(validation.stdout) as { diagnostics: Array<{ code: string; path: string }> };
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "adapter.modified", path: "AGENTS.md" }));
  });

  it("rejects invalid adapter CLI forms", () => {
    const missingSubcommand = run("adapters");
    expect(missingSubcommand.status).toBe(2);
    expect(missingSubcommand.stderr).toContain("flower adapters sync");

    const unsupportedFlag = run("adapters", "sync", "--skip-install");
    expect(unsupportedFlag.status).toBe(2);
    expect(unsupportedFlag.stderr).toContain("Unsupported option for flower adapters sync: --skip-install");
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
