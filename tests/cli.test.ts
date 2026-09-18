import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "packages", "cli", "dist", "index.js");

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
    expect(output.modules).toEqual(["cli", "kernel"]);
    expect(output.ownershipRules).toBeGreaterThan(0);
  });
});
