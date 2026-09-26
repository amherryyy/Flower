import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { agentAdapterBundleDigest } from "./agent-adapter-materialization.js";
import { resolveModules } from "./module.js";
import { normalizeProjectPath } from "./ownership.js";
import { isValidSemVer } from "./semver.js";
import { renderTemplate, sha256 } from "./template.js";
import type {
  AdoptionInspectionResult,
  AdoptionPathClassification,
  AdoptionPlan,
  AdoptionPlanConflict,
  AdoptionPlanOptions,
  AdoptionStack,
  VerifiedModulePackage
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

interface AdoptionMetadataSource {
  project: AdoptionPlan["project"];
  flowerVersion: string;
  stack: AdoptionStack;
  modules: string[];
  adapters: AdoptionPlan["adapters"];
  moduleComposition?: AdoptionPlan["moduleComposition"];
  adapterComposition?: AdoptionPlan["adapterComposition"];
  classifications: AdoptionPathClassification[];
  excludedLocalRoots: string[];
  preconditions: AdoptionPlan["preconditions"];
}

export interface AdoptionMetadataDocument {
  path: string;
  contents: string;
  digest: string;
}

function adapterManifest(adapters: AdoptionPlan["adapters"]): Record<string, boolean> {
  return Object.fromEntries(adapters.map((id) => [id === "github-actions" ? "githubActions" : id, true]));
}

export function createAdoptionMetadataDocuments(source: AdoptionMetadataSource): AdoptionMetadataDocument[] {
  const existingPaths = new Set(source.classifications.map(({ path: existingPath }) => existingPath));
  const record = {
    schemaVersion: 1,
    command: "adopt-record",
    project: source.project,
    flowerVersion: source.flowerVersion,
    stack: source.stack,
    modules: source.modules,
    adapters: source.adapters,
    ...(source.moduleComposition ? { moduleComposition: source.moduleComposition } : {}),
    ...(source.adapterComposition ? { adapterComposition: source.adapterComposition } : {}),
    classifications: source.classifications,
    excludedLocalRoots: source.excludedLocalRoots,
    preconditions: source.preconditions
  };
  const documents: Array<[string, object]> = [
    [".flower/project.json", {
      $schema: "https://flower.dev/schemas/project/v1.json",
      schemaVersion: 1,
      mode: "project",
      project: source.project,
      flower: { version: source.flowerVersion, channel: "stable" },
      stack: source.stack,
      modules: {},
      ...(source.adapters.length > 0 ? { adapters: adapterManifest(source.adapters) } : {})
    }],
    [".flower/ownership.json", {
      version: 1,
      rules: [
        { pattern: ".flower/project.json", owner: "protected", policy: "migration-engine-only" },
        { pattern: ".flower/adoption.json", owner: "protected", policy: "migration-engine-only" },
        { pattern: ".flower/lock.json", owner: "generated", policy: "replace-if-unmodified" },
        { pattern: ".flower/ownership.json", owner: "protected", policy: "migration-engine-only" },
        { pattern: ".flower/generated/**", owner: "generated", policy: "replace-if-unmodified" },
        { pattern: ".flower/cache/**", owner: "local", policy: "never-commit" },
        { pattern: ".flower/journal/local/**", owner: "local", policy: "never-commit" },
        { pattern: ".flower/journal/workflows/**", owner: "local", policy: "never-commit" },
        ...(!existingPaths.has("AGENTS.md") ? [{ pattern: "AGENTS.md", owner: "generated", policy: "replace-if-unmodified" }] : []),
        ...(!existingPaths.has("CLAUDE.md") ? [{ pattern: "CLAUDE.md", owner: "generated", policy: "replace-if-unmodified" }] : []),
        ...(!existingPaths.has(".github/workflows/flower-generated.yml")
          ? [{ pattern: ".github/workflows/flower-generated.yml", owner: "generated", policy: "replace-if-unmodified" }]
          : []),
        { pattern: "database/migrations/flower/**", owner: "protected", policy: "migration-engine-only" },
        { pattern: "src/flower/**", owner: "generated", policy: "replace-if-unmodified" },
        ...(source.moduleComposition?.files.map(({ path: generatedPath }) => ({
          pattern: generatedPath,
          owner: "generated",
          policy: "replace-if-unmodified"
        })) ?? []),
        ...source.classifications.map(({ path: existingPath }) => ({
          pattern: existingPath,
          owner: "project",
          policy: "never-overwrite"
        })),
        { pattern: "**", owner: "project", policy: "never-overwrite" }
      ]
    }],
    [".flower/lock.json", { lockVersion: 1, flowerVersion: source.flowerVersion, modules: {}, generatedFiles: {} }],
    [".flower/adoption.json", record]
  ];
  return documents.map(([documentPath, document]) => {
    const contents = `${JSON.stringify(document, null, 2)}\n`;
    return { path: documentPath, contents, digest: sha256(contents) };
  });
}

async function moduleComposition(
  modules: string[],
  catalog: readonly VerifiedModulePackage[] | undefined,
  project: AdoptionPlan["project"],
  flowerVersion: string,
  existingPaths: Set<string>
): Promise<AdoptionPlan["moduleComposition"]> {
  if (modules.length === 0) return undefined;
  if (!catalog) throw new AdoptionPlanError("A verified module catalog is required for selected modules", "adopt.moduleCatalogMissing");
  const resolution = resolveModules(catalog.map((entry) => entry.manifest), modules, {}, flowerVersion);
  if (!resolution.valid) {
    throw new AdoptionPlanError(
      `Module dependency resolution failed: ${resolution.diagnostics.map(({ code }) => code).join(", ")}`,
      "adopt.moduleResolutionFailed"
    );
  }
  const byId = new Map(catalog.map((entry) => [entry.manifest.id, entry]));
  const files: NonNullable<AdoptionPlan["moduleComposition"]>["files"] = [];
  const targets = new Set<string>();
  for (const moduleId of resolution.resolved) {
    const modulePackage = byId.get(moduleId)!;
    const values = {
      projectId: project.id,
      projectIdJson: JSON.stringify(project.id),
      projectNameJson: JSON.stringify(project.name),
      moduleId,
      moduleIdJson: JSON.stringify(moduleId),
      moduleVersion: modulePackage.manifest.version,
      moduleVersionJson: JSON.stringify(modulePackage.manifest.version)
    };
    for (const artifact of modulePackage.artifacts) {
      const target = normalizeProjectPath(artifact.path);
      const portable = target.toLowerCase();
      if (targets.has(portable) || existingPaths.has(portable)) {
        throw new AdoptionPlanError(`Module generated path already exists: ${target}`, "adopt.modulePathConflict");
      }
      const source = await readFile(artifact.sourcePath);
      if (sha256(source) !== artifact.sourceDigest) {
        throw new AdoptionPlanError(`Module source changed after catalog verification: ${moduleId}/${target}`, "adopt.modulePackageChanged");
      }
      targets.add(portable);
      files.push({
        moduleId,
        path: target,
        sourceDigest: artifact.sourceDigest,
        outputDigest: sha256(renderTemplate(source.toString("utf8"), values))
      });
    }
  }
  files.sort((left, right) => compareText(left.path, right.path));
  return {
    requested: resolution.requested,
    resolved: resolution.resolved,
    packages: resolution.resolved.map((id) => {
      const entry = byId.get(id)!;
      return { id, version: entry.manifest.version, digest: entry.digest };
    }),
    files
  };
}

function adapterComposition(
  adapters: AdoptionPlan["adapters"],
  bundle: AdoptionPlanOptions["adapterBundle"]
): AdoptionPlan["adapterComposition"] {
  if (adapters.length === 0) return undefined;
  if (!bundle) throw new AdoptionPlanError("A verified adapter bundle is required for selected adapters", "adopt.adapterBundleMissing");
  const artifactAdapters = bundle.artifacts.map(({ adapter }) => adapter).sort();
  if (JSON.stringify(artifactAdapters) !== JSON.stringify(adapters) ||
      bundle.artifacts.some(({ missingCapabilities }) => missingCapabilities.length > 0)) {
    throw new AdoptionPlanError("Adapter bundle does not match the requested adapters", "adopt.adapterBundleMismatch");
  }
  return {
    bundleDigest: agentAdapterBundleDigest(bundle),
    statePath: bundle.statePath,
    stateDigest: bundle.stateDigest,
    artifacts: bundle.artifacts.map(({ adapter, path: artifactPath, generatorVersion, inputDigest, outputDigest }) => ({
      adapter,
      path: artifactPath,
      generatorVersion,
      inputDigest,
      outputDigest
    }))
  };
}

export async function classifyAdoptionProject(root: string): Promise<{
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

export function adoptionPlanIdentity(payload: Omit<AdoptionPlan, "planId" | "digest">): Pick<AdoptionPlan, "planId" | "digest"> {
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
  if (!ID.test(options.projectId) || options.projectId.length < 2 || options.projectId.length > 64 || !options.projectName.trim() || options.projectName.length > 100) {
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
  const stack: AdoptionStack = {
    language: inspection.stack.languages[0] ?? "unknown",
    runtime: inspection.stack.runtimes[0] ?? "unknown",
    ...(inspection.stack.web[0] ? { web: inspection.stack.web[0] } : {}),
    ...(inspection.stack.databases[0] ? { database: inspection.stack.databases[0] } : {}),
    packageManager: inspection.packageManager.selected
  };
  const root = path.resolve(inspection.projectRoot);
  const classified = await classifyAdoptionProject(root);
  const existingPaths = new Set(classified.classifications.map(({ path: existingPath }) => existingPath.toLowerCase()));
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
  const preconditions = {
    inspectionDigest: sha256(JSON.stringify(canonicalInspection(inspection))),
    projectStateDigest: sha256(JSON.stringify(classified.classifications))
  };
  const composedModules = await moduleComposition(modules, options.moduleCatalog, {
    id: options.projectId,
    name: options.projectName
  }, options.flowerVersion, existingPaths);
  const composedAdapters = conflicts.length === 0 ? adapterComposition(adapters, options.adapterBundle) : undefined;
  const payload: Omit<AdoptionPlan, "planId" | "digest"> = {
    schemaVersion: 1,
    command: "adopt",
    state: conflicts.length > 0 ? "blocked" : "apply",
    projectRoot: root,
    project: { id: options.projectId, name: options.projectName },
    flowerVersion: options.flowerVersion,
    packageManager: inspection.packageManager.selected,
    stack,
    modules,
    adapters,
    ...(composedModules ? { moduleComposition: composedModules } : {}),
    ...(composedAdapters ? { adapterComposition: composedAdapters } : {}),
    classifications: classified.classifications,
    excludedLocalRoots: [...EXCLUDED_LOCAL_ROOTS],
    metadata: [],
    conflicts,
    preconditions
  };
  payload.metadata = createAdoptionMetadataDocuments(payload).map(({ path: documentPath, digest }) => ({ path: documentPath, digest }));
  return { ...adoptionPlanIdentity(payload), ...payload };
}

export function verifyAdoptionPlan(plan: AdoptionPlan): void {
  const { planId, digest, ...payload } = plan;
  const expected = adoptionPlanIdentity(payload);
  if (planId !== expected.planId || digest !== expected.digest) {
    throw new AdoptionPlanError("Adoption plan digest is invalid", "adopt.invalidPlan");
  }
}
