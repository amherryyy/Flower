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

async function uploadSchema(): Promise<object> {
  return JSON.parse(await readFile(path.join(root, "schemas/upload-policy/v1.json"), "utf8")) as object;
}

function project(options: { headers?: boolean } = {}): string {
  const directory = mkdtempSync(path.join(tmpdir(), "flower-security-"));
  temporaryDirectories.push(directory);
  mkdirSync(path.join(directory, ".flower"));
  writeFileSync(path.join(directory, ".flower/security.json"), JSON.stringify({
    $schema: "https://flower.dev/schemas/security/v1.json",
    schemaVersion: 1,
    secretScan: { maxFileBytes: 1048576, exclude: ["node_modules/**"] },
    dependencies: {
      requireLockfile: true,
      forbidUnpinnedTags: true,
      forbidRemoteSources: true,
      requireIntegrity: true,
      allowedLicenses: ["MIT"],
      unknownLicense: "error",
      auditLevel: "high"
    },
    ci: {
      enabled: false,
      include: [".github/workflows/*.yml"],
      requireActionCommitPins: true,
      requireReadOnlyContents: true,
      dependencyAuditCommand: "npm audit --audit-level=high"
    },
    headers: {
      enabled: options.headers ?? false,
      file: "next.config.ts",
      required: [{ name: "X-Content-Type-Options", value: "nosniff" }],
      forbiddenContentSecurityPolicyTokens: ["'unsafe-eval'"]
    },
    uploads: { enabled: false, policyPath: ".flower/uploads.json" },
    logging: {
      enabled: true,
      include: ["src/**"],
      forbidConsole: true,
      forbiddenKeys: ["body", "prompt", "messages"],
      redactedKeys: ["secret", "email"],
      allowedKeys: ["code", "count", "status"],
      maxAttributeDepth: 8,
      maxEventBytes: 16384
    }
  }, null, 2));
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ dependencies: { example: "^1.0.0" } }));
  writeFileSync(path.join(directory, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "fixture" } } }));
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

  it("enforces lockfile integrity and the declared license allowlist", async () => {
    const directory = project();
    writeFileSync(path.join(directory, "package-lock.json"), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "fixture" },
        "node_modules/no-integrity": { version: "1.0.0", license: "MIT" },
        "node_modules/no-license": { version: "1.0.0", integrity: "sha512-YWJjZA==" },
        "node_modules/denied": { version: "1.0.0", integrity: "sha512-YWJjZA==", license: "GPL-3.0-only" }
      }
    }));
    const result = await checkProjectSecurity(directory, await schema());
    expect(result.summary.lockfilePackagesChecked).toBe(3);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "security.dependency.integrityMissing",
      "security.dependency.licenseMissing",
      "security.dependency.licenseDenied"
    ]));
  });

  it("accepts the exact reviewed license expressions used by the bundled template", async () => {
    const directory = project();
    const templateBaseline = await readFile(path.join(root, "templates/next-supabase/.flower/security.json"), "utf8");
    writeFileSync(path.join(directory, ".flower/security.json"), templateBaseline);
    writeFileSync(path.join(directory, "package-lock.json"), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "fixture" },
        "node_modules/libvips": { version: "1.0.0", integrity: "sha512-YWJjZA==", license: "LGPL-3.0-or-later" },
        "node_modules/libvips-native": { version: "1.0.0", integrity: "sha512-YWJjZA==", license: "Apache-2.0 AND LGPL-3.0-or-later" },
        "node_modules/libvips-wasm": { version: "1.0.0", integrity: "sha512-YWJjZA==", license: "Apache-2.0 AND LGPL-3.0-or-later AND MIT" },
        "node_modules/browser-data": { version: "1.0.0", integrity: "sha512-YWJjZA==", license: "CC-BY-4.0" }
      }
    }));

    const result = await checkProjectSecurity(directory, await schema());
    expect(result.diagnostics.filter((entry) => entry.code === "security.dependency.licenseDenied")).toEqual([]);
  });

  it("requires immutable CI action references, read-only contents, and the configured audit", async () => {
    const directory = project();
    const baselinePath = path.join(directory, ".flower/security.json");
    const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as { ci: { enabled: boolean } };
    baseline.ci.enabled = true;
    writeFileSync(baselinePath, JSON.stringify(baseline));
    mkdirSync(path.join(directory, ".github/workflows"), { recursive: true });
    writeFileSync(path.join(directory, ".github/workflows/ci.yml"), "steps:\n  - uses: actions/checkout@v4\n");
    const result = await checkProjectSecurity(directory, await schema());
    expect(result.summary.workflowFilesChecked).toBe(1);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "security.ci.actionNotPinned",
      "security.ci.auditMissing",
      "security.ci.permissions"
    ]));
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

  it("includes the versioned upload policy in the security gate", async () => {
    const directory = project();
    const baselinePath = path.join(directory, ".flower/security.json");
    const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as { uploads: { enabled: boolean } };
    baseline.uploads.enabled = true;
    writeFileSync(baselinePath, JSON.stringify(baseline));
    writeFileSync(path.join(directory, ".flower/uploads.json"), "{}");
    const result = await checkProjectSecurity(directory, await schema(), await uploadSchema());
    expect(result.secure).toBe(false);
    expect(result.summary.uploadPolicyChecked).toBe(true);
    expect(result.diagnostics.some((entry) => entry.path.includes(".flower/uploads.json"))).toBe(true);
  });

  it("blocks direct console calls and forbidden structured logging fields", async () => {
    const directory = project();
    mkdirSync(path.join(directory, "src"));
    writeFileSync(path.join(directory, "src/unsafe.ts"), "console.log(request.body);\nlogger.info({ prompt: input });\n");
    const result = await checkProjectSecurity(directory, await schema());
    expect(result.secure).toBe(false);
    expect(result.summary.loggingFilesChecked).toBe(1);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "security.logging.console",
      "security.logging.forbiddenField"
    ]));
  });
});
