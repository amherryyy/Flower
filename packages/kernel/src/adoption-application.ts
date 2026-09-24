import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { adoptionPlanIdentity, classifyAdoptionProject, createAdoptionMetadataDocuments, verifyAdoptionPlan } from "./adoption-plan.js";
import { createJournalEntry, writeLocalJournal } from "./journal.js";
import { validateOwnershipManifest } from "./ownership.js";
import { sha256 } from "./template.js";
import type {
  AdoptionApplicationOptions,
  AdoptionPathClassification,
  AdoptionPlan,
  AdoptionResult,
  AdoptionStack
} from "./types.js";
import { validateDocument } from "./validation.js";

interface AdoptionRecord {
  schemaVersion: 1;
  command: "adopt-record";
  project: AdoptionPlan["project"];
  flowerVersion: string;
  stack: AdoptionStack;
  modules: string[];
  adapters: AdoptionPlan["adapters"];
  classifications: AdoptionPathClassification[];
  excludedLocalRoots: string[];
  preconditions: AdoptionPlan["preconditions"];
}

export class AdoptionApplicationError extends Error {
  readonly code: string;
  readonly rollbackComplete: boolean;

  constructor(message: string, code: string, rollbackComplete = true) {
    super(message);
    this.name = "AdoptionApplicationError";
    this.code = code;
    this.rollbackComplete = rollbackComplete;
  }
}

async function controlState(root: string): Promise<"missing" | "directory" | "unsafe"> {
  try {
    const details = await lstat(path.join(root, ".flower"));
    return details.isDirectory() && !details.isSymbolicLink() ? "directory" : "unsafe";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRecord(value: unknown): AdoptionRecord {
  if (!isObject(value) || value.schemaVersion !== 1 || value.command !== "adopt-record" ||
      !isObject(value.project) || typeof value.project.id !== "string" || typeof value.project.name !== "string" ||
      typeof value.flowerVersion !== "string" || !isObject(value.stack) ||
      typeof value.stack.language !== "string" || typeof value.stack.runtime !== "string" ||
      typeof value.stack.packageManager !== "string" || !Array.isArray(value.modules) ||
      !value.modules.every((entry) => typeof entry === "string") || !Array.isArray(value.adapters) ||
      !value.adapters.every((entry) => ["codex", "claude", "github-actions"].includes(String(entry))) ||
      !Array.isArray(value.classifications) || !Array.isArray(value.excludedLocalRoots) ||
      !isObject(value.preconditions) || typeof value.preconditions.inspectionDigest !== "string" ||
      typeof value.preconditions.projectStateDigest !== "string") {
    throw new AdoptionApplicationError("Adoption record is invalid", "adopt.invalidRecord");
  }
  return value as unknown as AdoptionRecord;
}

async function readMetadata(root: string, relativePath: string): Promise<Buffer> {
  const absolute = path.join(root, ...relativePath.split("/"));
  const details = await lstat(absolute);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new AdoptionApplicationError(`Adoption metadata path is unsafe: ${relativePath}`, "adopt.unsafeMetadata");
  }
  return await readFile(absolute);
}

export async function loadAppliedAdoptionPlan(projectRootInput: string): Promise<AdoptionPlan> {
  const projectRoot = path.resolve(projectRootInput);
  if (await controlState(projectRoot) !== "directory") {
    throw new AdoptionApplicationError("Applied adoption metadata is missing or unsafe", "adopt.notApplied");
  }
  let record: AdoptionRecord;
  try {
    record = parseRecord(JSON.parse((await readMetadata(projectRoot, ".flower/adoption.json")).toString("utf8")) as unknown);
  } catch (error) {
    if (error instanceof AdoptionApplicationError) throw error;
    throw new AdoptionApplicationError("Adoption record could not be read", "adopt.invalidRecord");
  }
  const payload: Omit<AdoptionPlan, "planId" | "digest"> = {
    schemaVersion: 1,
    command: "adopt",
    state: "apply",
    projectRoot,
    project: record.project,
    flowerVersion: record.flowerVersion,
    packageManager: record.stack.packageManager,
    stack: record.stack,
    modules: record.modules,
    adapters: record.adapters,
    classifications: record.classifications,
    excludedLocalRoots: record.excludedLocalRoots,
    metadata: [],
    conflicts: [],
    preconditions: record.preconditions
  };
  payload.metadata = createAdoptionMetadataDocuments(payload).map(({ path: documentPath, digest }) => ({ path: documentPath, digest }));
  const plan = { ...adoptionPlanIdentity(payload), ...payload };
  verifyAdoptionPlan(plan);
  const expectedRecord = createAdoptionMetadataDocuments(payload)
    .find(({ path: documentPath }) => documentPath === ".flower/adoption.json")!;
  if (sha256(await readMetadata(projectRoot, ".flower/adoption.json")) !== expectedRecord.digest) {
    throw new AdoptionApplicationError("Adoption record changed", "adopt.metadataChanged");
  }
  for (const required of [".flower/project.json", ".flower/ownership.json", ".flower/lock.json"]) {
    await readMetadata(projectRoot, required);
  }
  try {
    const currentProject = JSON.parse((await readMetadata(projectRoot, ".flower/project.json")).toString("utf8")) as {
      mode?: unknown;
      project?: { id?: unknown };
    };
    if (currentProject.mode !== "project" || currentProject.project?.id !== record.project.id) {
      throw new AdoptionApplicationError("Adopted project identity changed", "adopt.metadataChanged");
    }
  } catch (error) {
    if (error instanceof AdoptionApplicationError) throw error;
    throw new AdoptionApplicationError("Adopted project manifest is invalid", "adopt.metadataChanged");
  }
  return plan;
}

function validateMetadata(plan: AdoptionPlan, options: AdoptionApplicationOptions): void {
  const documents = createAdoptionMetadataDocuments(plan);
  const project = JSON.parse(documents.find(({ path: documentPath }) => documentPath === ".flower/project.json")!.contents) as unknown;
  const ownership = JSON.parse(documents.find(({ path: documentPath }) => documentPath === ".flower/ownership.json")!.contents) as unknown;
  const projectValidation = validateDocument(options.projectSchema, project, "project");
  const ownershipValidation = validateOwnershipManifest(options.ownershipSchema, ownership);
  const diagnostics = [...projectValidation.diagnostics, ...ownershipValidation.diagnostics];
  if (diagnostics.length > 0) {
    throw new AdoptionApplicationError(
      `Planned adoption metadata is invalid: ${diagnostics.map(({ code }) => code).join(", ")}`,
      "adopt.invalidMetadata"
    );
  }
}

export async function applyAdoptionPlan(
  plan: AdoptionPlan,
  options: AdoptionApplicationOptions
): Promise<AdoptionResult> {
  verifyAdoptionPlan(plan);
  if (plan.state !== "apply" || plan.conflicts.length > 0) {
    throw new AdoptionApplicationError("Blocked adoption plans cannot be applied", "adopt.planBlocked");
  }
  if (plan.modules.length > 0 || plan.adapters.length > 0) {
    throw new AdoptionApplicationError(
      "Selected modules and adapters require the upcoming adoption composition slice",
      "adopt.selectionsNotApplicable"
    );
  }
  const root = path.resolve(plan.projectRoot);
  const rootDetails = await lstat(root);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new AdoptionApplicationError("Adoption target is not a regular directory", "adopt.unsafeTarget");
  }
  const existingControl = await controlState(root);
  if (existingControl === "unsafe") {
    throw new AdoptionApplicationError("Existing .flower path is unsafe", "adopt.unsafeMetadata");
  }
  if (existingControl === "directory") {
    const applied = await loadAppliedAdoptionPlan(root);
    if (applied.planId !== plan.planId || applied.digest !== plan.digest) {
      throw new AdoptionApplicationError("A different adoption is already applied", "adopt.alreadyManaged");
    }
    return { status: "unchanged", planId: plan.planId, projectRoot: root, changedPaths: [] };
  }

  const current = await classifyAdoptionProject(root);
  if (current.conflicts.length > 0 || JSON.stringify(current.classifications) !== JSON.stringify(plan.classifications) ||
      sha256(JSON.stringify(current.classifications)) !== plan.preconditions.projectStateDigest) {
    throw new AdoptionApplicationError("Project files changed after adoption planning", "adopt.projectChanged");
  }
  const documents = createAdoptionMetadataDocuments(plan);
  if (JSON.stringify(documents.map(({ path: documentPath, digest }) => ({ path: documentPath, digest }))) !== JSON.stringify(plan.metadata)) {
    throw new AdoptionApplicationError("Planned adoption metadata is inconsistent", "adopt.invalidMetadata");
  }
  validateMetadata(plan, options);

  const control = path.join(root, ".flower");
  const changedPaths = documents.map(({ path: documentPath }) => documentPath);
  const journalWriter = options.hooks?.writeJournal ?? writeLocalJournal;
  let controlCreated = false;
  try {
    await mkdir(control);
    controlCreated = true;
    await journalWriter(root, createJournalEntry("flower adopt", "started", {
      planId: plan.planId,
      changedPaths
    }));
    for (const [index, document] of documents.entries()) {
      const destination = path.join(root, ...document.path.split("/"));
      await writeFile(destination, document.contents, { encoding: "utf8", flag: "wx" });
      if (sha256(await readFile(destination)) !== document.digest) {
        throw new AdoptionApplicationError(`Adoption metadata verification failed: ${document.path}`, "adopt.verificationFailed");
      }
      await options.hooks?.afterWrite?.(document.path, index);
    }
    const journalPath = await journalWriter(root, createJournalEntry("flower adopt", "completed", {
      planId: plan.planId,
      changedPaths,
      result: { project: plan.project, packageManager: plan.packageManager }
    }));
    await loadAppliedAdoptionPlan(root);
    return { status: "completed", planId: plan.planId, projectRoot: root, changedPaths, journalPath };
  } catch (error) {
    let rollbackComplete = true;
    if (controlCreated) {
      try {
        await rm(control, { recursive: true, force: true });
      } catch {
        rollbackComplete = false;
      }
    }
    if (!rollbackComplete) {
      try {
        await journalWriter(root, createJournalEntry("flower adopt", "partial", {
          planId: plan.planId,
          changedPaths,
          errorCode: "adopt.rollbackIncomplete",
          result: { error: error instanceof Error ? error.message : "Adoption application failed" }
        }));
      } catch {
        // The returned error still requires manual recovery.
      }
    }
    throw new AdoptionApplicationError(
      error instanceof Error ? error.message : "Adoption application failed",
      rollbackComplete ? "adopt.rolledBack" : "adopt.rollbackIncomplete",
      rollbackComplete
    );
  }
}
