import { lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic, SecurityBaseline, SecurityCheckResult } from "./types.js";
import { normalizeProjectPath } from "./ownership.js";
import { validateDocument } from "./validation.js";

const SECRET_PATTERNS = [
  { code: "security.secret.privateKey", expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { code: "security.secret.awsAccessKey", expression: /\bAKIA[0-9A-Z]{16}\b/ },
  { code: "security.secret.githubToken", expression: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { code: "security.secret.openAiKey", expression: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { code: "security.secret.supabaseKey", expression: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/ }
] as const;

const DEPENDENCY_GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

function normalize(input: string): string {
  return input.replaceAll("\\", "/").replace(/^\.\//, "");
}

function globExpression(pattern: string): RegExp {
  const normalized = normalize(pattern);
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (character === "*" && normalized[index + 1] === "*") {
      const slash = normalized[index + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else {
      source += /[|\\{}()[\]^$+?.]/.test(character) ? `\\${character}` : character;
    }
  }
  return new RegExp(`${source}$`);
}

function excluded(relativePath: string, patterns: RegExp[]): boolean {
  const normalized = normalize(relativePath);
  return patterns.some((pattern) => pattern.test(normalized) || pattern.test(`${normalized}/`));
}

function diagnostic(code: string, relativePath: string, message: string): Diagnostic {
  return { code, path: normalize(relativePath), message, severity: "error" };
}

async function discoverFiles(root: string, baseline: SecurityBaseline): Promise<string[]> {
  const files: string[] = [];
  const exclusions = baseline.secretScan.exclude.map(globExpression);

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalize(path.relative(root, absolute));
      if (excluded(relative, exclusions) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(relative);
    }
  }

  await visit(root);
  return files;
}

function dependencyEntries(document: Record<string, unknown>): Array<[string, string, string]> {
  const entries: Array<[string, string, string]> = [];
  for (const group of DEPENDENCY_GROUPS) {
    const value = document[group];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [name, specifier] of Object.entries(value)) {
      if (typeof specifier === "string") entries.push([group, name, specifier]);
    }
  }
  return entries;
}

async function scanDependencies(
  root: string,
  files: string[],
  baseline: SecurityBaseline,
  diagnostics: Diagnostic[]
): Promise<number> {
  const manifests = files.filter((file) => path.basename(file) === "package.json");
  for (const manifest of manifests) {
    try {
      const document = JSON.parse(await readFile(path.join(root, manifest), "utf8")) as Record<string, unknown>;
      for (const [group, name, specifier] of dependencyEntries(document)) {
        if (baseline.dependencies.forbidUnpinnedTags && (specifier === "latest" || specifier === "*")) {
          diagnostics.push(diagnostic("security.dependency.unpinned", `${manifest}#/${group}/${name}`, `Dependency '${name}' uses the unpinned '${specifier}' specifier.`));
        }
        if (baseline.dependencies.forbidRemoteSources && /^(?:https?:|git(?:\+|:)|github:|file:)/i.test(specifier)) {
          diagnostics.push(diagnostic("security.dependency.remoteSource", `${manifest}#/${group}/${name}`, `Dependency '${name}' uses a disallowed remote or local source specifier.`));
        }
      }
    } catch (error) {
      diagnostics.push(diagnostic("security.dependency.invalidManifest", manifest, error instanceof Error ? error.message : "Package manifest is invalid."));
    }
  }

  if (baseline.dependencies.requireLockfile && manifests.includes("package.json")) {
    if (!files.includes("package-lock.json")) {
      diagnostics.push(diagnostic("security.dependency.lockfileMissing", "package-lock.json", "A root package-lock.json is required."));
    } else {
      try {
        const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8")) as { lockfileVersion?: unknown };
        if (typeof lock.lockfileVersion !== "number" || lock.lockfileVersion < 2) {
          diagnostics.push(diagnostic("security.dependency.lockfileVersion", "package-lock.json", "The npm lockfile must use lockfileVersion 2 or newer."));
        }
      } catch (error) {
        diagnostics.push(diagnostic("security.dependency.invalidLockfile", "package-lock.json", error instanceof Error ? error.message : "Package lockfile is invalid."));
      }
    }
  }
  return manifests.length;
}

async function scanSecrets(
  root: string,
  files: string[],
  baseline: SecurityBaseline,
  diagnostics: Diagnostic[]
): Promise<number> {
  let scanned = 0;
  for (const relative of files) {
    const basename = path.basename(relative);
    if (basename.startsWith(".env") && basename !== ".env.example") {
      diagnostics.push(diagnostic("security.secret.environmentFile", relative, "Environment files containing local secrets must not be committed."));
    }
    const metadata = await stat(path.join(root, relative));
    if (metadata.size > baseline.secretScan.maxFileBytes) continue;
    const content = await readFile(path.join(root, relative));
    if (content.includes(0)) continue;
    scanned += 1;
    const text = content.toString("utf8");
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.expression.test(lines[index]!)) {
          diagnostics.push(diagnostic(pattern.code, `${relative}:${index + 1}`, "A high-confidence secret pattern was detected; the value has been redacted."));
        }
      }
    }
  }
  return scanned;
}

async function scanHeaders(root: string, baseline: SecurityBaseline, diagnostics: Diagnostic[]): Promise<number> {
  if (!baseline.headers.enabled) return 0;
  let relative: string;
  try {
    relative = normalizeProjectPath(baseline.headers.file);
  } catch (error) {
    diagnostics.push(diagnostic("security.headers.invalidPath", baseline.headers.file, error instanceof Error ? error.message : "The header path is invalid."));
    return 0;
  }
  let content: string;
  try {
    const absolute = path.join(root, relative);
    if ((await lstat(absolute)).isSymbolicLink()) throw new Error("Symbolic links are not accepted for the application header file.");
    content = await readFile(absolute, "utf8");
  } catch {
    diagnostics.push(diagnostic("security.headers.fileMissing", relative, "The configured application header file is missing or unreadable."));
    return 0;
  }
  for (const header of baseline.headers.required) {
    if (!content.toLowerCase().includes(header.name.toLowerCase())) {
      diagnostics.push(diagnostic("security.headers.missing", relative, `Required header '${header.name}' is not configured.`));
    } else if (header.value && !content.toLowerCase().includes(header.value.toLowerCase())) {
      diagnostics.push(diagnostic("security.headers.value", relative, `Required value for '${header.name}' is not configured.`));
    }
  }
  const cspLower = content.toLowerCase();
  for (const token of baseline.headers.forbiddenContentSecurityPolicyTokens) {
    if (cspLower.includes(token.toLowerCase())) {
      diagnostics.push(diagnostic("security.headers.forbiddenCspToken", relative, `Content Security Policy contains forbidden token '${token}'.`));
    }
  }
  return baseline.headers.required.length;
}

async function scanUploadPolicy(
  root: string,
  baseline: SecurityBaseline,
  uploadPolicySchema: object | undefined,
  diagnostics: Diagnostic[]
): Promise<boolean> {
  if (!baseline.uploads.enabled) return false;
  if (!uploadPolicySchema) {
    diagnostics.push(diagnostic("security.uploads.schemaMissing", baseline.uploads.policyPath, "Upload policy schema is unavailable."));
    return false;
  }
  let relative: string;
  try {
    relative = normalizeProjectPath(baseline.uploads.policyPath);
    const absolute = path.join(root, relative);
    if ((await lstat(absolute)).isSymbolicLink()) throw new Error("Symbolic links are not accepted for the upload policy.");
    const document = JSON.parse(await readFile(absolute, "utf8")) as unknown;
    const result = validateDocument(uploadPolicySchema, document, "upload-policy");
    diagnostics.push(...result.diagnostics.map((entry) => ({ ...entry, path: `${relative}${entry.path}` })));
    return true;
  } catch (error) {
    diagnostics.push(diagnostic("security.uploads.policyRead", baseline.uploads.policyPath, error instanceof Error ? error.message : "Upload policy is unreadable."));
    return false;
  }
}

export async function checkProjectSecurity(
  projectRoot: string,
  baselineSchema: object,
  uploadPolicySchema?: object
): Promise<SecurityCheckResult> {
  const root = path.resolve(projectRoot);
  const baselinePath = path.join(root, ".flower", "security.json");
  const emptySummary: SecurityCheckResult["summary"] = {
    filesScanned: 0,
    packageManifestsScanned: 0,
    headersChecked: 0,
    uploadPolicyChecked: false,
    vulnerabilityDatabase: "not-configured"
  };
  let baselineDocument: unknown;
  try {
    baselineDocument = JSON.parse(await readFile(baselinePath, "utf8"));
  } catch (error) {
    return {
      secure: false,
      diagnostics: [diagnostic("security.baseline.read", ".flower/security.json", error instanceof Error ? error.message : "Security baseline is unreadable.")],
      summary: emptySummary
    };
  }
  const validation = validateDocument(baselineSchema, baselineDocument, "security");
  if (!validation.valid) return { secure: false, diagnostics: validation.diagnostics, summary: emptySummary };

  const baseline = baselineDocument as SecurityBaseline;
  const diagnostics: Diagnostic[] = [];
  let files: string[];
  try {
    files = await discoverFiles(root, baseline);
  } catch (error) {
    return {
      secure: false,
      diagnostics: [diagnostic("security.scan.read", ".", error instanceof Error ? error.message : "Project files are unreadable.")],
      summary: emptySummary
    };
  }
  const [filesScanned, packageManifestsScanned, headersChecked, uploadPolicyChecked] = await Promise.all([
    scanSecrets(root, files, baseline, diagnostics),
    scanDependencies(root, files, baseline, diagnostics),
    scanHeaders(root, baseline, diagnostics),
    scanUploadPolicy(root, baseline, uploadPolicySchema, diagnostics)
  ]);
  diagnostics.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  return {
    secure: diagnostics.length === 0,
    diagnostics,
    summary: { filesScanned, packageManifestsScanned, headersChecked, uploadPolicyChecked, vulnerabilityDatabase: "not-configured" }
  };
}
