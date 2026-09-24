import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnCommand } from "./initialization.js";
import type {
  AdoptionGitInspection,
  AdoptionInspectionResult,
  AdoptionPackageManager,
  AdoptionPackageManagerInspection,
  CommandRunner,
  Diagnostic
} from "./types.js";

const MAX_PACKAGE_BYTES = 1024 * 1024;

type EntryKind = "file" | "directory" | "symlink";
type JsonObject = Record<string, unknown>;

export class AdoptionInspectionError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "AdoptionInspectionError";
    this.code = code;
  }
}

function diagnostic(code: string, pathValue: string, message: string, severity: Diagnostic["severity"]): Diagnostic {
  return { code, path: pathValue, message, severity };
}

function sortedDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const unique = new Map(diagnostics.map((entry) => [`${entry.severity}\0${entry.code}\0${entry.path}\0${entry.message}`, entry]));
  return [...unique.values()].sort((left, right) =>
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message)
  );
}

async function kind(root: string, relative: string, diagnostics: Diagnostic[]): Promise<EntryKind | undefined> {
  const segments = relative.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]!);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) {
        diagnostics.push(diagnostic(
          "adopt.symlinkEvidenceIgnored",
          segments.slice(0, index + 1).join("/"),
          "Symbolic-link evidence is not followed during adoption inspection",
          "warning"
        ));
        return "symlink";
      }
      if (index < segments.length - 1) {
        if (!details.isDirectory()) return undefined;
      } else {
        if (details.isFile()) return "file";
        if (details.isDirectory()) return "directory";
        return undefined;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  return undefined;
}

async function present(root: string, relative: string, diagnostics: Diagnostic[], expected?: "file" | "directory"): Promise<boolean> {
  const entry = await kind(root, relative, diagnostics);
  return entry !== undefined && entry !== "symlink" && (expected === undefined || entry === expected);
}

async function readPackage(root: string, diagnostics: Diagnostic[]): Promise<JsonObject | undefined> {
  const relative = "package.json";
  if (!(await present(root, relative, diagnostics, "file"))) return undefined;
  try {
    const absolute = path.join(root, relative);
    const details = await lstat(absolute);
    if (details.size > MAX_PACKAGE_BYTES) {
      diagnostics.push(diagnostic("adopt.packageManifestTooLarge", relative, "package.json exceeds the 1 MiB inspection limit", "error"));
      return undefined;
    }
    const document = JSON.parse(await readFile(absolute, "utf8")) as unknown;
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      diagnostics.push(diagnostic("adopt.invalidPackageManifest", relative, "package.json must contain a JSON object", "error"));
      return undefined;
    }
    return document as JsonObject;
  } catch (error) {
    diagnostics.push(diagnostic(
      "adopt.invalidPackageManifest",
      relative,
      error instanceof Error ? error.message : "package.json could not be read",
      "error"
    ));
    return undefined;
  }
}

function packageNames(document: JsonObject | undefined): Set<string> {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const value = document?.[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    Object.keys(value as JsonObject).forEach((name) => names.add(name));
  }
  return names;
}

async function packageManagerInspection(
  root: string,
  document: JsonObject | undefined,
  diagnostics: Diagnostic[]
): Promise<AdoptionPackageManagerInspection> {
  const candidates: Array<{ id: AdoptionPackageManager; paths: string[] }> = [
    { id: "npm", paths: ["package-lock.json", "npm-shrinkwrap.json"] },
    { id: "pnpm", paths: ["pnpm-lock.yaml"] },
    { id: "yarn", paths: ["yarn.lock"] },
    { id: "bun", paths: ["bun.lock", "bun.lockb"] }
  ];
  const evidence: AdoptionPackageManagerInspection["evidence"] = [];
  for (const candidate of candidates) {
    const paths: string[] = [];
    for (const relative of candidate.paths) {
      if (await present(root, relative, diagnostics, "file")) paths.push(relative);
    }
    if (paths.length > 0) evidence.push({ id: candidate.id, paths });
  }

  const rawDeclared = document?.packageManager;
  const declared = typeof rawDeclared === "string" ? rawDeclared : undefined;
  const declaredMatch = declared?.match(/^(npm|pnpm|yarn|bun)(?:@|$)/);
  const declaredId = declaredMatch?.[1] as AdoptionPackageManager | undefined;
  const detected = new Set(evidence.map(({ id }) => id));
  if (declaredId) detected.add(declaredId);

  if (declared && !declaredId) {
    diagnostics.push(diagnostic(
      "adopt.unsupportedPackageManagerDeclaration",
      "package.json",
      `Unsupported packageManager declaration '${declared}'`,
      "error"
    ));
  }
  if (detected.size > 1) {
    diagnostics.push(diagnostic(
      "adopt.ambiguousPackageManager",
      ".",
      `Conflicting package-manager evidence: ${[...detected].sort().join(", ")}`,
      "error"
    ));
    return { state: "ambiguous", evidence, ...(declared ? { declared } : {}) };
  }
  const selected = [...detected][0];
  if (!selected) {
    diagnostics.push(diagnostic("adopt.packageManagerMissing", ".", "No supported package manager was detected", "warning"));
    return { state: "missing", evidence, ...(declared ? { declared } : {}) };
  }
  return { state: "detected", selected, evidence, ...(declared ? { declared } : {}) };
}

async function workflowFiles(root: string, diagnostics: Diagnostic[]): Promise<{ providers: string[]; files: string[] }> {
  const files: string[] = [];
  const providers = new Set<string>();
  if (await present(root, ".github/workflows", diagnostics, "directory")) {
    const entries = await readdir(path.join(root, ".github", "workflows"), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = `.github/workflows/${entry.name}`;
      if (entry.isSymbolicLink()) {
        diagnostics.push(diagnostic("adopt.symlinkEvidenceIgnored", relative, "Symbolic-link evidence is not followed during adoption inspection", "warning"));
      } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        files.push(relative);
        providers.add("github-actions");
      }
    }
  }
  for (const [relative, provider] of [
    [".gitlab-ci.yml", "gitlab-ci"],
    ["azure-pipelines.yml", "azure-pipelines"],
    [".circleci/config.yml", "circleci"]
  ] as const) {
    if (await present(root, relative, diagnostics, "file")) {
      files.push(relative);
      providers.add(provider);
    }
  }
  return { providers: [...providers].sort(), files: files.sort() };
}

async function inspectGit(root: string, runner: CommandRunner, diagnostics: Diagnostic[]): Promise<AdoptionGitInspection> {
  try {
    const topLevel = await runner({ executable: "git", args: ["rev-parse", "--show-toplevel"], cwd: root });
    if (topLevel.exitCode !== 0) {
      diagnostics.push(diagnostic("adopt.gitMissing", ".", "The adoption target is not inside a readable Git worktree", "warning"));
      return { present: false };
    }
    const repositoryRoot = path.resolve(topLevel.stdout.trim());
    const relation = path.relative(repositoryRoot, root);
    if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
      diagnostics.push(diagnostic("adopt.gitRootMismatch", ".git", "Git reported a worktree that does not contain the adoption target", "error"));
      return { present: true };
    }
    const rootLocation = relation === "" ? "project" : "ancestor";
    const [status, head] = await Promise.all([
      runner({ executable: "git", args: ["status", "--porcelain=v1", "--branch", "--untracked-files=normal"], cwd: root }),
      runner({ executable: "git", args: ["rev-parse", "--verify", "HEAD"], cwd: root })
    ]);
    if (status.exitCode !== 0) {
      diagnostics.push(diagnostic("adopt.gitInspectionFailed", ".git", "Git status could not be inspected", "error"));
      return { present: true, repositoryRoot: rootLocation };
    }
    const lines = status.stdout.replaceAll("\r\n", "\n").split("\n").filter(Boolean);
    const header = lines[0]?.startsWith("## ") ? lines[0].slice(3) : "";
    const detached = header === "HEAD (no branch)";
    const branch = detached
      ? undefined
      : header.replace(/^No commits yet on /, "").replace(/^Initial commit on /, "").split("...")[0]?.trim() || undefined;
    const headValue = head.exitCode === 0 && /^[a-f0-9]{40,64}$/i.test(head.stdout.trim()) ? head.stdout.trim().toLowerCase() : undefined;
    const result: AdoptionGitInspection = {
      present: true,
      repositoryRoot: rootLocation,
      detached,
      dirty: lines.slice(header ? 1 : 0).length > 0,
      ...(branch ? { branch } : {}),
      ...(headValue ? { head: headValue } : {})
    };
    if (result.repositoryRoot === "ancestor") {
      diagnostics.push(diagnostic("adopt.gitAncestorRoot", ".git", "The adoption target is nested inside an ancestor Git worktree", "warning"));
    }
    if (result.dirty) {
      diagnostics.push(diagnostic("adopt.gitDirty", ".git", "The Git worktree has uncommitted or untracked changes", "warning"));
    }
    return result;
  } catch (error) {
    diagnostics.push(diagnostic(
      "adopt.gitUnavailable",
      ".git",
      error instanceof Error ? error.message : "Git inspection is unavailable",
      "warning"
    ));
    return { present: false };
  }
}

export async function inspectAdoptionProject(
  rootInput: string,
  runner: CommandRunner = spawnCommand
): Promise<AdoptionInspectionResult> {
  const root = path.resolve(rootInput);
  let rootDetails;
  try {
    rootDetails = await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AdoptionInspectionError("Adoption target does not exist", "adopt.targetMissing");
    }
    throw error;
  }
  if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) {
    throw new AdoptionInspectionError("Adoption target must be a real directory, not a symbolic link", "adopt.unsafeTarget");
  }

  const diagnostics: Diagnostic[] = [];
  const controlDirectory = await kind(root, ".flower", diagnostics);
  const managedManifest = controlDirectory === "directory" &&
    await present(root, ".flower/project.json", diagnostics, "file");
  const alreadyManaged = managedManifest;
  if (managedManifest) {
    diagnostics.push(diagnostic("adopt.alreadyManaged", ".flower/project.json", "Project already contains a Flower project manifest", "error"));
  } else if (controlDirectory === "symlink") {
    diagnostics.push(diagnostic("adopt.controlDirectorySymlink", ".flower", "A symbolic-link .flower path blocks safe adoption", "error"));
  } else if (controlDirectory !== undefined) {
    diagnostics.push(diagnostic("adopt.controlDirectoryConflict", ".flower", "Existing .flower content requires review before adoption", "error"));
  }

  const packageDocument = await readPackage(root, diagnostics);
  const packages = packageNames(packageDocument);
  const packageManager = await packageManagerInspection(root, packageDocument, diagnostics);
  const hasTsConfig = await present(root, "tsconfig.json", diagnostics, "file");
  const hasJsConfig = await present(root, "jsconfig.json", diagnostics, "file");
  const languages = hasTsConfig ? ["typescript"] : packageDocument || hasJsConfig ? ["javascript"] : [];
  const runtimes = packageDocument ? ["node"] : [];

  const web = new Set<string>();
  const webEvidence = [
    ["nextjs", packages.has("next") || await present(root, "next.config.js", diagnostics, "file") || await present(root, "next.config.mjs", diagnostics, "file") || await present(root, "next.config.ts", diagnostics, "file")],
    ["remix", packages.has("@remix-run/react")],
    ["nuxt", packages.has("nuxt")],
    ["sveltekit", packages.has("@sveltejs/kit")]
  ] as const;
  webEvidence.filter(([, detected]) => detected).forEach(([id]) => web.add(id));
  if (web.size > 1) {
    diagnostics.push(diagnostic("adopt.ambiguousWebStack", "package.json", `Multiple web frameworks were detected: ${[...web].sort().join(", ")}`, "error"));
  } else if (web.size === 0) {
    diagnostics.push(diagnostic("adopt.webStackMissing", ".", "No supported web framework was detected", "warning"));
  }

  const databasePaths: string[] = [];
  for (const [relative, expected] of [
    ["supabase/config.toml", "file"],
    ["supabase/migrations", "directory"],
    ["database/migrations", "directory"],
    ["prisma/schema.prisma", "file"]
  ] as const) {
    if (await present(root, relative, diagnostics, expected)) databasePaths.push(relative);
  }
  const databases = new Set<string>();
  if (packages.has("@supabase/supabase-js") || databasePaths.some((value) => value.startsWith("supabase/"))) databases.add("supabase-postgres");
  if (packages.has("pg") || databasePaths.includes("database/migrations")) databases.add("postgres");
  if (packages.has("prisma") || packages.has("@prisma/client") || databasePaths.includes("prisma/schema.prisma")) databases.add("prisma");

  const ci = await workflowFiles(root, diagnostics);
  const agentInstructions: string[] = [];
  for (const relative of ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md"]) {
    if (await present(root, relative, diagnostics, "file")) agentInstructions.push(relative);
  }
  const git = await inspectGit(root, runner, diagnostics);
  if (languages.length === 0) diagnostics.push(diagnostic("adopt.languageMissing", ".", "No JavaScript or TypeScript project evidence was detected", "warning"));

  const orderedDiagnostics = sortedDiagnostics(diagnostics);
  return {
    schemaVersion: 1,
    command: "adopt-inspect",
    projectRoot: root,
    state: orderedDiagnostics.some(({ severity }) => severity === "error") ? "blocked" : "ready",
    alreadyManaged,
    stack: {
      languages,
      runtimes,
      web: [...web].sort(),
      databases: [...databases].sort()
    },
    packageManager,
    databasePaths: databasePaths.sort(),
    ci,
    agentInstructions: agentInstructions.sort(),
    git,
    diagnostics: orderedDiagnostics
  };
}
