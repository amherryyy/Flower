import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mergeGeneratedText } from "./generated-text-merge.js";
import { createJournalEntry, writeLocalJournal } from "./journal.js";
import {
  applyModuleUpdateMigrationPlan,
  applyVersionedManifestMigrationPlan,
  createModuleUpdateMigrationPlan,
  createVersionedManifestMigrationPlan
} from "./metadata-migration.js";
import { classifyPath, normalizeProjectPath } from "./ownership.js";
import { sha256 } from "./template.js";
import { verifyUpdatePlan } from "./update-plan.js";
import type {
  ManifestDocumentKind,
  UpdateApplicationGeneratedSource,
  UpdateApplicationOptions,
  UpdateApplicationResult,
  UpdateGeneratedFileChange,
  UpdateManifestMigration,
  UpdateModuleMigration,
  OwnershipManifest,
  UpdatePlan
} from "./types.js";

interface PreparedMutation {
  path: string;
  before?: Buffer;
  after?: Buffer;
}

const MANIFEST_PATHS: Record<Exclude<ManifestDocumentKind, "module">, string> = {
  project: ".flower/project.json",
  lock: ".flower/lock.json",
  ownership: ".flower/ownership.json"
};

export class UpdateApplicationError extends Error {
  readonly code: string;
  readonly rollbackComplete: boolean;

  constructor(message: string, code: string, rollbackComplete = true) {
    super(message);
    this.name = "UpdateApplicationError";
    this.code = code;
    this.rollbackComplete = rollbackComplete;
  }
}

function stableJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function absolutePath(root: string, relativePath: string): string {
  const normalized = normalizeProjectPath(relativePath);
  if (normalized !== relativePath || normalized === "." || normalized.startsWith("../")) {
    throw new UpdateApplicationError(`Update path is unsafe: ${relativePath}`, "update.unsafePath");
  }
  const absolute = path.resolve(root, ...normalized.split("/"));
  const relation = path.relative(root, absolute);
  if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
    throw new UpdateApplicationError(`Update path escapes the project: ${relativePath}`, "update.unsafePath");
  }
  return absolute;
}

async function assertSafeParents(root: string, relativePath: string): Promise<void> {
  const destination = absolutePath(root, relativePath);
  let current = path.dirname(destination);
  while (current !== root) {
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink() || !details.isDirectory()) {
        throw new UpdateApplicationError(`Update parent is unsafe: ${relativePath}`, "update.unsafePath");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    current = path.dirname(current);
  }
}

async function readRegularFile(root: string, relativePath: string): Promise<Buffer> {
  const absolute = absolutePath(root, relativePath);
  try {
    const details = await lstat(absolute);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new UpdateApplicationError(`Update file is unsafe: ${relativePath}`, "update.unsafePath");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new UpdateApplicationError(`Required update file is missing: ${relativePath}`, "update.projectChanged");
    }
    throw error;
  }
  return await readFile(absolute);
}

async function optionalRegularFile(root: string, relativePath: string): Promise<Buffer | undefined> {
  try {
    return await readRegularFile(root, relativePath);
  } catch (error) {
    if (error instanceof UpdateApplicationError && error.code === "update.projectChanged") return undefined;
    throw error;
  }
}

function requireDigest(actual: Buffer | string, expected: string, label: string): void {
  if (sha256(actual) !== expected) {
    throw new UpdateApplicationError(`${label} changed after update planning`, "update.projectChanged");
  }
}

function grouped<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const identity = key(value);
    result.set(identity, [...(result.get(identity) ?? []), value]);
  }
  return result;
}

function sameManifestSteps(
  planned: readonly UpdateManifestMigration[],
  actual: readonly { id: string; fromVersion: number; toVersion: number }[]
): boolean {
  return JSON.stringify(planned.map(({ id, fromVersion, toVersion }) => ({ id, fromVersion, toVersion }))) ===
    JSON.stringify(actual.map(({ id, fromVersion, toVersion }) => ({ id, fromVersion, toVersion })));
}

function sameModuleSteps(
  planned: readonly UpdateModuleMigration[],
  actual: readonly { id: string; fromVersion: string; toVersion: string; digest: string }[]
): boolean {
  return JSON.stringify(planned.map(({ id, fromVersion, toVersion, digest }) => ({ id, fromVersion, toVersion, digest }))) ===
    JSON.stringify(actual.map(({ id, fromVersion, toVersion, digest }) => ({ id, fromVersion, toVersion, digest })));
}

async function prepareManifestMutations(plan: UpdatePlan, options: UpdateApplicationOptions, root: string): Promise<PreparedMutation[]> {
  const mutations: PreparedMutation[] = [];
  for (const [manifestKey, steps] of grouped(plan.manifestMigrations, ({ manifest }) => manifest)) {
    const manifest = manifestKey as UpdateManifestMigration["manifest"];
    const relativePath = MANIFEST_PATHS[manifest];
    const before = await readRegularFile(root, relativePath);
    let document: unknown;
    try {
      document = JSON.parse(before.toString("utf8")) as unknown;
    } catch {
      throw new UpdateApplicationError(`Manifest is not valid JSON: ${relativePath}`, "update.invalidManifest");
    }
    const migrationPlan = createVersionedManifestMigrationPlan(
      manifest,
      document,
      steps.at(-1)!.toVersion,
      options.manifestMigrations
    );
    if (!sameManifestSteps(steps, migrationPlan.steps)) {
      throw new UpdateApplicationError(`Manifest migration chain changed after planning: ${manifest}`, "update.migrationChanged");
    }
    const result = applyVersionedManifestMigrationPlan(migrationPlan, document, options.manifestMigrations);
    mutations.push({ path: relativePath, before, after: stableJson(result.document) });
  }
  return mutations;
}

async function prepareModuleMutations(plan: UpdatePlan, options: UpdateApplicationOptions, root: string): Promise<PreparedMutation[]> {
  const documents = new Map((options.moduleDocuments ?? []).map((entry) => [entry.moduleId, entry.path]));
  const mutations: PreparedMutation[] = [];
  for (const [moduleId, steps] of grouped(plan.moduleMigrations, ({ moduleId }) => moduleId)) {
    const relativePath = documents.get(moduleId);
    if (!relativePath) {
      throw new UpdateApplicationError(`Module '${moduleId}' has no configuration document`, "update.moduleDocumentMissing");
    }
    const before = await readRegularFile(root, relativePath);
    let document: unknown;
    try {
      document = JSON.parse(before.toString("utf8")) as unknown;
    } catch {
      throw new UpdateApplicationError(`Module configuration is not valid JSON: ${relativePath}`, "update.invalidModuleDocument");
    }
    const migrationPlan = createModuleUpdateMigrationPlan(
      moduleId,
      steps[0]!.fromVersion,
      steps.at(-1)!.toVersion,
      document,
      options.moduleMigrations
    );
    if (!sameModuleSteps(steps, migrationPlan.steps)) {
      throw new UpdateApplicationError(`Module migration chain changed after planning: ${moduleId}`, "update.migrationChanged");
    }
    const result = applyModuleUpdateMigrationPlan(migrationPlan, document, options.moduleMigrations);
    mutations.push({ path: relativePath, before, after: stableJson(result.document) });
  }
  return mutations;
}

function sourceMap(sources: readonly UpdateApplicationGeneratedSource[]): Map<string, UpdateApplicationGeneratedSource> {
  const result = new Map<string, UpdateApplicationGeneratedSource>();
  for (const source of sources) {
    if (result.has(source.path)) {
      throw new UpdateApplicationError(`Duplicate generated source: ${source.path}`, "update.invalidGeneratedSource");
    }
    result.set(source.path, source);
  }
  return result;
}

async function prepareGeneratedMutation(
  change: UpdateGeneratedFileChange,
  source: UpdateApplicationGeneratedSource | undefined,
  root: string
): Promise<PreparedMutation> {
  const before = await optionalRegularFile(root, change.path);
  if (change.kind === "create") {
    if (before || source?.target === undefined) {
      throw new UpdateApplicationError(`Generated create precondition failed: ${change.path}`, "update.projectChanged");
    }
    requireDigest(source.target, change.targetDigest!, `Generated target '${change.path}'`);
    return { path: change.path, after: Buffer.from(source.target) };
  }
  if (!before) {
    throw new UpdateApplicationError(`Generated file is missing: ${change.path}`, "update.projectChanged");
  }
  requireDigest(before, change.currentDigest!, `Generated file '${change.path}'`);
  if (change.kind === "remove") return { path: change.path, before };
  if (source?.base === undefined || source.target === undefined) {
    throw new UpdateApplicationError(`Generated source is missing: ${change.path}`, "update.generatedSourceMissing");
  }
  requireDigest(source.base, change.baseDigest!, `Generated base '${change.path}'`);
  requireDigest(source.target, change.targetDigest!, `Generated target '${change.path}'`);
  if (change.kind === "replace") return { path: change.path, before, after: Buffer.from(source.target) };
  const merged = mergeGeneratedText(source.base, before.toString("utf8"), source.target);
  if (merged.status === "conflict" || merged.content === undefined) {
    throw new UpdateApplicationError(`Generated merge now conflicts: ${change.path}`, "update.generatedConflict");
  }
  return { path: change.path, before, after: Buffer.from(merged.content) };
}

async function prepareMutations(plan: UpdatePlan, options: UpdateApplicationOptions, root: string): Promise<PreparedMutation[]> {
  const generated = sourceMap(options.generatedSources ?? []);
  let currentOwnership: OwnershipManifest;
  try {
    currentOwnership = JSON.parse((await readRegularFile(root, ".flower/ownership.json")).toString("utf8")) as OwnershipManifest;
  } catch (error) {
    if (error instanceof UpdateApplicationError) throw error;
    throw new UpdateApplicationError("Ownership manifest is invalid", "update.invalidOwnership");
  }
  const mutations: PreparedMutation[] = [
    ...await prepareManifestMutations(plan, options, root),
    ...await prepareModuleMutations(plan, options, root)
  ];
  const ownershipMutation = mutations.find(({ path: mutationPath }) => mutationPath === ".flower/ownership.json");
  let finalOwnership = currentOwnership;
  if (ownershipMutation?.after) {
    try {
      finalOwnership = JSON.parse(ownershipMutation.after.toString("utf8")) as OwnershipManifest;
    } catch {
      throw new UpdateApplicationError("Migrated ownership manifest is invalid", "update.invalidOwnership");
    }
  }
  for (const change of plan.generatedFiles) {
    const currentClassification = classifyPath(currentOwnership, change.path);
    const finalClassification = classifyPath(finalOwnership, change.path);
    if ([currentClassification, finalClassification].some(({ rule }) =>
      rule?.owner !== "generated" || rule.policy === "never-overwrite")) {
      throw new UpdateApplicationError(
        `Generated update would violate ownership: ${change.path}`,
        "update.ownershipViolation"
      );
    }
    mutations.push(await prepareGeneratedMutation(change, generated.get(change.path), root));
  }
  const seen = new Set<string>();
  for (const mutation of mutations) {
    if (seen.has(mutation.path)) {
      throw new UpdateApplicationError(`Update path is planned more than once: ${mutation.path}`, "update.duplicateMutation");
    }
    seen.add(mutation.path);
  }
  return mutations.sort((left, right) => left.path.localeCompare(right.path));
}

async function atomicWrite(destination: string, contents: Buffer): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const suffix = randomUUID();
  const temporary = `${destination}.flower-update-${suffix}.tmp`;
  const backup = `${destination}.flower-update-${suffix}.bak`;
  const existing = await optionalRegularFile(path.dirname(destination), path.basename(destination));
  let originalMoved = false;
  let replacementInstalled = false;
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    if (existing) {
      await rename(destination, backup);
      originalMoved = true;
    }
    await rename(temporary, destination);
    replacementInstalled = true;
    if (originalMoved) await rm(backup, { force: true });
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (originalMoved) {
      try {
        if (replacementInstalled) await rm(destination, { force: true });
        await rename(backup, destination);
      } catch {
        // The outer transaction reports incomplete recovery if restoration later fails.
      }
    }
    throw error;
  }
}

async function verifyPreconditions(plan: UpdatePlan, options: UpdateApplicationOptions, root: string): Promise<void> {
  const checks: Array<[string, string]> = [
    [".flower/project.json", plan.preconditions.projectManifestDigest],
    [".flower/lock.json", plan.preconditions.lockDigest],
    [".flower/ownership.json", plan.preconditions.ownershipDigest]
  ];
  if (plan.preconditions.generatedStateDigest) {
    if (!options.generatedStatePath) {
      throw new UpdateApplicationError("Generated-state precondition has no configured path", "update.generatedStateMissing");
    }
    checks.push([options.generatedStatePath, plan.preconditions.generatedStateDigest]);
  }
  if (plan.preconditions.releasePackageDigest && options.releasePackageDigest !== plan.preconditions.releasePackageDigest) {
    throw new UpdateApplicationError("Release package changed after update planning", "update.releasePackageChanged");
  }
  for (const [relativePath, digest] of checks) {
    requireDigest(await readRegularFile(root, relativePath), digest, `Update precondition '${relativePath}'`);
  }
}

export async function applyUpdatePlan(plan: UpdatePlan, options: UpdateApplicationOptions): Promise<UpdateApplicationResult> {
  verifyUpdatePlan(plan);
  if (plan.state === "blocked" || plan.ownershipConflicts.length > 0) {
    throw new UpdateApplicationError("Blocked update plans cannot be applied", "update.planBlocked");
  }
  const root = path.resolve(options.projectRoot);
  const rootDetails = await lstat(root);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new UpdateApplicationError("Update target is not a regular directory", "update.unsafeTarget");
  }
  if (plan.dependencyChanges.length > 0 || plan.databaseMigrations.length > 0) {
    throw new UpdateApplicationError(
      "This update contains package or database effects that the current application slice cannot apply",
      "update.unsupportedEffect"
    );
  }
  const approvals = new Set(options.approvals ?? []);
  const missingApprovals = plan.requiredApprovals.filter(({ id }) => !approvals.has(id));
  if (missingApprovals.length > 0) {
    throw new UpdateApplicationError(
      `Required update approvals are missing: ${missingApprovals.map(({ id }) => id).join(", ")}`,
      "update.approvalMissing"
    );
  }
  if (plan.verificationCommands.length > 0 && !options.runVerification) {
    throw new UpdateApplicationError("Update verification runner is required", "update.verificationUnavailable");
  }
  await verifyPreconditions(plan, options, root);
  if (plan.state === "unchanged") {
    return { status: "unchanged", planId: plan.planId, projectRoot: root, changedPaths: [] };
  }

  const mutations = await prepareMutations(plan, options, root);
  const journalWriter = options.hooks?.writeJournal ?? writeLocalJournal;
  const changedPaths = mutations.map(({ path: mutationPath }) => mutationPath);
  await journalWriter(root, createJournalEntry("flower update", "started", { planId: plan.planId, changedPaths }));
  const applied: PreparedMutation[] = [];
  try {
    for (const [index, mutation] of mutations.entries()) {
      await assertSafeParents(root, mutation.path);
      const destination = absolutePath(root, mutation.path);
      const current = await optionalRegularFile(root, mutation.path);
      if ((mutation.before === undefined && current !== undefined) ||
          (mutation.before !== undefined && (current === undefined || !current.equals(mutation.before)))) {
        throw new UpdateApplicationError(`Update file changed during application: ${mutation.path}`, "update.projectChanged");
      }
      if (mutation.after === undefined) await rm(destination);
      else await atomicWrite(destination, mutation.after);
      applied.push(mutation);
      await options.hooks?.afterMutation?.(mutation.path, index);
    }
    for (const command of plan.verificationCommands) {
      await options.runVerification!(command, root);
    }
    const journalPath = await journalWriter(root, createJournalEntry("flower update", "completed", {
      planId: plan.planId,
      changedPaths,
      result: { currentVersion: plan.currentVersion, targetVersion: plan.targetVersion }
    }));
    return { status: "completed", planId: plan.planId, projectRoot: root, changedPaths, journalPath };
  } catch (error) {
    let rollbackComplete = true;
    for (const mutation of [...applied].reverse()) {
      const destination = absolutePath(root, mutation.path);
      try {
        if (mutation.before === undefined) await rm(destination, { force: true });
        else await atomicWrite(destination, mutation.before);
      } catch {
        rollbackComplete = false;
      }
    }
    try {
      await journalWriter(root, createJournalEntry("flower update", rollbackComplete ? "failed" : "partial", {
        planId: plan.planId,
        changedPaths,
        errorCode: rollbackComplete ? "update.rolledBack" : "update.rollbackIncomplete",
        result: { error: error instanceof Error ? error.message : "Update application failed" }
      }));
    } catch {
      // The returned error still communicates whether manual recovery is required.
    }
    throw new UpdateApplicationError(
      error instanceof Error ? error.message : "Update application failed",
      rollbackComplete ? "update.rolledBack" : "update.rollbackIncomplete",
      rollbackComplete
    );
  }
}
