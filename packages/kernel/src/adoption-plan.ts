import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { normalizeProjectPath } from "./ownership.js";
import { isValidSemVer } from "./semver.js";
import { sha256 } from "./template.js";
import type {
  AdoptionInspectionResult,
  AdoptionPathClassification,
  AdoptionPlan,
  AdoptionPlanConflict,
  AdoptionPlanOptions
} from "./types.js";

const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const EXCLUDED_LOCAL_ROOTS = [".git", ".next", "coverage", "dist", "node_modules"];
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MODULE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ADAPTERS = new Set(["codex", "claude", "github-actions"]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class AdoptionPlanError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "AdoptionPlanError";
    this.code = code;
  }
}

function canonicalInspection(inspection: AdoptionInspectionResult): object {
  return {
    ...inspection,
    projectRoot: ".",
    diagnostics: inspection.diagnostics.map((entry) => ({ ...entry }))
  };
}

function metadataDocuments(
  inspection: AdoptionInspectionResult,
  options: AdoptionPlanOptions,
  packageManager: string
): Array<{ path: string; digest: string }> {
  const stack = {
    language: inspection.stack.languages[0] ?? "unknown",
    runtime: inspection.stack.runtimes[0] ?? "unknown",
    ...(inspection.stack.web[0] ? { web: inspection.stack.web[0] } : {}),
    ...(inspection.stack.databases[0] ? { database: inspection.stack.databases[0] } : {}),
    packageManager
  };
  const documents: Array<[string, object]> = [
    [".flower/project.json", {
      schemaVersion: 1,
      mode: "project",
      project: { id: options.projectId, name: options.projectName },
      flower: { version: options.flowerVersion, channel: "stable" },
      stack,
      modules: {}
    }],
    [".flower/ownership.json", {
      version: 1,
      rules: [
        { pattern: ".flower/**", owner: "protected", policy: "migration-engine-only" },
        { pattern: "**", owner: "project", policy: "never-overwrite" }
      ]
    }],
    [".flower/lock.json", { lockVersion: 1, flowerVersion: options.flowerVersion, modules: {}, generatedFiles: {} }]
  ];
  return documents.map(([documentPath, document]) => ({
    path: documentPath,
    digest: sha256(`${JSON.stringify(document, null, 2)}\n`)
  }));
}

async function classifyProject(root: string): Promise<{
  classifications: AdoptionPathClassification[];
  conflicts: AdoptionPlanConflict[];
}> {
  const classifications: AdoptionPathClassification[] = [];
  const conflicts: AdoptionPlanConflict[] = [];
  let totalBytes = 0;

  async function visit(relative: string): Promise<void> {
    const absolute = relative ? path.join(root, ...relative.split("/")) : root;
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
      const child = normalizeProjectPath(relative ? `${relative}/${entry.name}` : entry.name);
      const top = child.split("/")[0]!;
      const details = await lstat(path.join(root, ...child.split("/")));
      if (details.isSymbolicLink()) {
        conflicts.push({ path: child, reason: "symbolic-link", message: "Adoption planning does not follow symbolic links" });
        continue;
      }
      if (EXCLUDED_LOCAL_ROOTS.includes(top)) continue;
      if (details.isDirectory()) {
        await visit(child);
      } else if (details.isFile()) {
        const contents = await readFile(path.join(root, ...child.split("/")));
        if (contents.byteLength > MAX_FILE_BYTES) throw new AdoptionPlanError(`Project file exceeds 5 MiB inspection limit: ${child}`, "adopt.fileTooLarge");
        totalBytes += contents.byteLength;
        if (totalBytes > MAX_TOTAL_BYTES) throw new AdoptionPlanError("Project files exceed the 64 MiB planning limit", "adopt.projectTooLarge");
        if (classifications.length >= MAX_FILES) throw new AdoptionPlanError("Project contains more than 10000 inspectable files", "adopt.tooManyFiles");
        classifications.push({ path: child, owner: "project", policy: "never-overwrite", digest: sha256(contents), bytes: contents.byteLength });
      }
    }
  }
  await visit("");
  return { classifications, conflicts };
}

function identity(payload: Omit<AdoptionPlan, "planId" | "digest">): Pick<AdoptionPlan, "planId" | "digest"> {
  const digest = sha256(JSON.stringify(payload));
  return { digest, planId: `adopt-${digest.slice(7, 23)}` };
}

export async function createAdoptionPlan(
  inspection: AdoptionInspectionResult,
  options: AdoptionPlanOptions
): Promise<AdoptionPlan> {
  if (inspection.state !== "ready" || inspection.alreadyManaged) {
    throw new AdoptionPlanError("A ready unmanaged adoption inspection is required", "adopt.inspectionBlocked");
  }
  if (!ID.test(options.projectId) || !options.projectName.trim() || options.projectName.length > 100) {
    throw new AdoptionPlanError("Adoption project identity is invalid", "adopt.invalidProjectIdentity");
  }
  if (!isValidSemVer(options.flowerVersion)) throw new AdoptionPlanError("Flower version is invalid", "adopt.invalidFlowerVersion");
  if (inspection.packageManager.state !== "detected" || !inspection.packageManager.selected) {
    throw new AdoptionPlanError("A detected package manager is required", "adopt.packageManagerMissing");
  }
  if (inspection.packageManager.selected !== "npm") {
    throw new AdoptionPlanError(`Package manager '${inspection.packageManager.selected}' is not yet supported for adoption`, "adopt.packageManagerUnsupported");
  }
  const modules = [...new Set(options.modules ?? [])].sort();
  if (modules.some((id) => !MODULE.test(id))) throw new AdoptionPlanError("Module ids must be lowercase kebab-case", "adopt.invalidModule");
  const adapters = [...new Set(options.adapters ?? [])].sort() as AdoptionPlan["adapters"];
  if (adapters.some((id) => !ADAPTERS.has(id))) {
    throw new AdoptionPlanError("Adapter ids must be codex, claude, or github-actions", "adopt.invalidAdapter");
  }
  const root = path.resolve(inspection.projectRoot);
  const classified = await classifyProject(root);
  const conflicts = [...classified.conflicts];
  if (adapters.includes("codex") && inspection.agentInstructions.includes("AGENTS.md")) {
    conflicts.push({ path: "AGENTS.md", reason: "existing-agent-instructions", message: "Codex instructions require a reviewed merge" });
  }
  if (adapters.includes("claude") && inspection.agentInstructions.includes("CLAUDE.md")) {
    conflicts.push({ path: "CLAUDE.md", reason: "existing-agent-instructions", message: "Claude instructions require a reviewed merge" });
  }
  if (adapters.includes("github-actions") && inspection.ci.providers.includes("github-actions")) {
    conflicts.push({ path: ".github/workflows", reason: "existing-ci-workflow", message: "GitHub Actions adoption requires a reviewed merge" });
  }
  conflicts.sort((left, right) => compareText(left.path, right.path) || compareText(left.reason, right.reason));
  const metadata = metadataDocuments(inspection, options, inspection.packageManager.selected);
  const preconditions = {
    inspectionDigest: sha256(JSON.stringify(canonicalInspection(inspection))),
    projectStateDigest: sha256(JSON.stringify(classified.classifications))
  };
  const payload: Omit<AdoptionPlan, "planId" | "digest"> = {
    schemaVersion: 1,
    command: "adopt",
    state: conflicts.length > 0 ? "blocked" : "apply",
    projectRoot: root,
    project: { id: options.projectId, name: options.projectName },
    flowerVersion: options.flowerVersion,
    packageManager: inspection.packageManager.selected,
    modules,
    adapters,
    classifications: classified.classifications,
    excludedLocalRoots: [...EXCLUDED_LOCAL_ROOTS],
    metadata,
    conflicts,
    preconditions
  };
  return { ...identity(payload), ...payload };
}

export function verifyAdoptionPlan(plan: AdoptionPlan): void {
  const { planId, digest, ...payload } = plan;
  const expected = identity(payload);
  if (planId !== expected.planId || digest !== expected.digest) {
    throw new AdoptionPlanError("Adoption plan digest is invalid", "adopt.invalidPlan");
  }
}
