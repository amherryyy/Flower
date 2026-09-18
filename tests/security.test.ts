import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkProjectSecurity } from "../packages/kernel/src/index.js";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

async function schema(): Promise<object> {
  return JSON.parse(await readFile(path.join(root, "schemas/security/v1.json"), "utf8")) as object;
}

function project(options: { headers?: boolean } = {}): string {
  const directory = mkdtempSync(path.join(tmpdir(), "flower-security-"));
  temporaryDirectories.push(directory);
  mkdirSync(path.join(directory, ".flower"));
  writeFileSync(path.join(directory, ".flower/security.json"), JSON.stringify({
    $schema: "https://flower.dev/schemas/security/v1.json",
    schemaVersion: 1,
    secretScan: { maxFileBytes: 1048576, exclude: ["node_modules/**"] },
    dependencies: { requireLockfile: true, forbidUnpinnedTags: true, forbidRemoteSources: true },
    headers: {
      enabled: options.headers ?? false,
      file: "next.config.ts",
      required: [{ name: "X-Content-Type-Options", value: "nosniff" }],
      forbiddenContentSecurityPolicyTokens: ["'unsafe-eval'"]
    }
  }, null, 2));
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ dependencies: { example: "^1.0.0" } }));
  writeFileSync(path.join(directory, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
  writeFileSync(path.join(directory, "index.ts"), "export const safe = true;\n");
  return directory;
}

describe("offline security baseline", () => {
  it("accepts a project that meets its declared baseline", async () => {
    const result = await checkProjectSecurity(project(), await schema());
    expect(result.secure).toBe(true);
    expect(result.summary).toEqual(expect.objectContaining({ packageManifestsScanned: 1, vulnerabilityDatabase: "not-configured" }));
  });

  it("redacts detected secrets and reports risky dependency sources", async () => {
    const directory = project();
    writeFileSync(path.join(directory, "credentials.txt"), `token=${"ghp_" + "A".repeat(36)}\n`);
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ dependencies: { loose: "latest", remote: "git+https://example.test/repo.git" } }));
    const result = await checkProjectSecurity(directory, await schema());
    expect(result.secure).toBe(false);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "security.secret.githubToken",
      "security.dependency.unpinned",
      "security.dependency.remoteSource"
    ]));
    expect(JSON.stringify(result)).not.toContain("ghp_A");
  });

  it("enforces the configured header names, values, and CSP restrictions", async () => {
    const directory = project({ headers: true });
    writeFileSync(path.join(directory, "next.config.ts"), "const headers = ['unsafe-eval'];\n");
    const result = await checkProjectSecurity(directory, await schema());
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "security.headers.missing",
      "security.headers.forbiddenCspToken"
    ]));
  });
});
