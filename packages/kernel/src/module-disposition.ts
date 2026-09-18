import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createJournalEntry, writeLocalJournal } from "./journal.js";
import { classifyPath } from "./ownership.js";
import { renderTemplate, sha256 } from "./template.js";
import type {
  Diagnostic,
  ModuleDisposition,
  ModuleDispositionPlan,
  ModuleDispositionResult,
  OwnershipManifest,
  ProjectManifest,
  VerifiedModulePackage
} from "./types.js";

interface ProjectLock {
  lockVersion: number;
  flowerVersion: string;
  template?: { id: string; version: string; digest: string };
  modules: Record<string, { version: string; digest: string; migrations: string[] }>;
  generatedFiles: Record<string, string>;
}

interface State {
  projectBytes: Buffer;
  lockBytes: Buffer;
  ownershipBytes: Buffer;
  project: ProjectManifest;
  lock: ProjectLock;
  ownership: OwnershipManifest;
}

export class ModuleDispositionError extends Error {
  readonly code: string;
  readonly diagnostics: Diagnostic[];
  readonly rollbackComplete: boolean;

  constructor(message: string, code: string, diagnostics: Diagnostic[] = [], rollbackComplete = true) {
    super(message);
    this.name = "ModuleDispositionError";
    this.code = code;
    this.diagnostics = diagnostics;
    this.rollbackComplete = rollbackComplete;
  }
}

async function readState(projectRoot: string): Promise<State> {
  const control = path.join(projectRoot, ".flower");
  for (const directory of [projectRoot, control]) {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new ModuleDispositionError(`Project control path is not a regular directory: ${directory}`, "module.unsafeControlFile");
    }
  }
  const projectPath = path.join(control, "project.json");
  const lockPath = path.join(control, "lock.json");
  const ownershipPath = path.join(control, "ownership.json");
  for (const filePath of [projectPath, lockPath, ownershipPath]) {
    const details = await lstat(filePath);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new ModuleDispositionError(`Control file is not a regular file: ${filePath}`, "module.unsafeControlFile");
    }
  }
  const [projectBytes, lockBytes, ownershipBytes] = await Promise.all([
    readFile(projectPath),
    readFile(lockPath),
    readFile(ownershipPath)
  ]);
  return {
    projectBytes,
    lockBytes,
    ownershipBytes,
    project: JSON.parse(projectBytes.toString("utf8")) as ProjectManifest,
    lock: JSON.parse(lockBytes.toString("utf8")) as ProjectLock,
    ownership: JSON.parse(ownershipBytes.toString("utf8")) as OwnershipManifest
  };
}

function identity(payload: Omit<ModuleDispositionPlan, "planId" | "digest">): ModuleDispositionPlan {
  const digest = sha256(JSON.stringify(payload));
  return { ...payload, planId: `${payload.command}-${digest.slice(7, 19)}`, digest };
}

export function verifyModuleDispositionPlan(plan: ModuleDispositionPlan): void {
  const { planId, digest, ...payload } = plan;
  const expected = identity(payload);
  if (planId !== expected.planId || digest !== expected.digest) {
    throw new ModuleDispositionError("Module disposition plan digest is invalid", "module.invalidPlan");
  }
}

function renderValues(project: ProjectManifest, modulePackage: VerifiedModulePackage): Record<string, string> {
  return {
    projectId: project.project.id,
    projectIdJson: JSON.stringify(project.project.id),
    projectNameJson: JSON.stringify(project.project.name),
    moduleId: modulePackage.manifest.id,
    moduleIdJson: JSON.stringify(modulePackage.manifest.id),
    moduleVersion: modulePackage.manifest.version,
    moduleVersionJson: JSON.stringify(modulePackage.manifest.version)
  };
}

function unchangedPlan(
  command: ModuleDisposition,
  projectRoot: string,
  moduleId: string,
  state: State
): ModuleDispositionPlan {
  return identity({
    schemaVersion: 1,
    command,
    state: "unchanged",
    projectRoot,
    module: { id: moduleId, version: "0.0.0", digest: sha256("") },
    packages: [],
    files: [],
    preconditions: {
      projectManifestDigest: sha256(state.projectBytes),
      lockDigest: sha256(state.lockBytes),
      ownershipDigest: sha256(state.ownershipBytes)
    }
  });
}

async function assertRegularManagedFile(projectRoot: string, relativePath: string): Promise<string> {
  const segments = relativePath.replaceAll("\\", "/").split("/");
  let current = projectRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]!);
    const details = await lstat(current);
    if (details.isSymbolicLink()) {
      throw new ModuleDispositionError(`Managed path traverses a symbolic link: ${relativePath}`, "module.unsafeGeneratedPath");
    }
    if (index < segments.length - 1 && !details.isDirectory()) {
      throw new ModuleDispositionError(`Managed path parent is not a directory: ${relativePath}`, "module.unsafeGeneratedPath");
    }
    if (index === segments.length - 1 && !details.isFile()) {
      throw new ModuleDispositionError(`Managed path is not a regular file: ${relativePath}`, "module.unsafeGeneratedPath");
    }
  }
  return current;
}

export async function createModuleDispositionPlan(
  projectRootInput: string,
  moduleId: string,
  command: ModuleDisposition,
  packages: readonly VerifiedModulePackage[]
): Promise<ModuleDispositionPlan> {
  const projectRoot = path.resolve(projectRootInput);
  const state = await readState(projectRoot);
  if (state.project.mode !== "project") {
    throw new ModuleDispositionError("Modules can only be changed in project mode", "module.invalidProjectMode");
  }
  if (state.lock.lockVersion !== 1) {
    throw new ModuleDispositionError(`Unsupported lock version ${state.lock.lockVersion}`, "module.unsupportedLockVersion");
  }
  const installedVersion = state.project.modules?.[moduleId];
  if (!installedVersion) {
    if (state.lock.modules?.[moduleId]) {
      throw new ModuleDispositionError(`Lock contains module '${moduleId}' but the project manifest does not`, "module.installedStateMismatch");
    }
    return unchangedPlan(command, projectRoot, moduleId, state);
  }

  const packagesById = new Map(packages.map((modulePackage) => [modulePackage.manifest.id, modulePackage]));
  for (const installedId of Object.keys(state.project.modules ?? {}).sort()) {
    const installedPackage = packagesById.get(installedId);
    const locked = state.lock.modules?.[installedId];
    if (!installedPackage || !locked || locked.version !== installedPackage.manifest.version || locked.digest !== installedPackage.digest) {
      throw new ModuleDispositionError(`Installed module package is unavailable or does not match the lock: ${installedId}`, "module.installedStateMismatch");
    }
    if (installedId !== moduleId && Object.hasOwn(installedPackage.manifest.dependsOn, moduleId)) {
      throw new ModuleDispositionError(`Module '${moduleId}' is required by installed module '${installedId}'`, "module.requiredByInstalled");
    }
  }

  const modulePackage = packagesById.get(moduleId)!;
  const lockedModule = state.lock.modules[moduleId]!;
  if (installedVersion !== modulePackage.manifest.version || lockedModule.version !== installedVersion) {
    throw new ModuleDispositionError(`Installed version of '${moduleId}' does not match its package`, "module.installedStateMismatch");
  }

  const files: ModuleDispositionPlan["files"] = [];
  for (const artifact of modulePackage.artifacts) {
    const classification = classifyPath(state.ownership, artifact.path);
    if (!classification.rule || classification.conflict || classification.rule.owner !== "generated") {
      throw new ModuleDispositionError(`Managed path is not classified as generated: ${artifact.path}`, "module.ownershipDenied");
    }
    const source = await readFile(artifact.sourcePath);
    if (sha256(source) !== artifact.sourceDigest) {
      throw new ModuleDispositionError(`Module package changed during planning: ${moduleId}`, "module.packageChanged");
    }
    const managedDigest = sha256(renderTemplate(source.toString("utf8"), renderValues(state.project, modulePackage)));
    const lockedDigest = state.lock.generatedFiles?.[artifact.path];
    let currentDigest: string;
    try {
      currentDigest = sha256(await readFile(await assertRegularManagedFile(projectRoot, artifact.path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ModuleDispositionError(`Managed generated file is missing: ${artifact.path}`, "module.generatedFileDrift");
      }
      throw error;
    }
    if (!lockedDigest || lockedDigest !== managedDigest) {
      throw new ModuleDispositionError(`Lock state does not match the module package: ${artifact.path}`, "module.installedStateMismatch");
    }
    if (command === "remove" && currentDigest !== managedDigest) {
      throw new ModuleDispositionError(`Generated file drift prevents removal: ${artifact.path}`, "module.generatedFileDrift");
    }
    files.push({ path: artifact.path, currentDigest, managedDigest });
  }

  return identity({
    schemaVersion: 1,
    command,
    state: "apply",
    projectRoot,
    module: { id: moduleId, version: modulePackage.manifest.version, digest: modulePackage.digest },
    packages: Object.keys(state.project.modules ?? {}).sort().map((installedId) => {
      const installedPackage = packagesById.get(installedId)!;
      return { id: installedId, version: installedPackage.manifest.version, digest: installedPackage.digest };
    }),
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    preconditions: {
      projectManifestDigest: sha256(state.projectBytes),
      lockDigest: sha256(state.lockBytes),
      ownershipDigest: sha256(state.ownershipBytes)
    }
  });
}

async function replaceFile(filePath: string, contents: Buffer): Promise<void> {
  const suffix = randomUUID();
  const temporary = `${filePath}.${suffix}.tmp`;
  const backup = `${filePath}.${suffix}.bak`;
  await writeFile(temporary, contents, { flag: "wx" });
  let originalMoved = false;
  let replacementInstalled = false;
  try {
    await rename(filePath, backup);
    originalMoved = true;
    await rename(temporary, filePath);
    replacementInstalled = true;
    await rm(backup, { force: true });
  } catch (error) {
    await rm(temporary, { force: true });
    if (originalMoved) {
      try {
        if (replacementInstalled) await rm(filePath, { force: true });
        await rename(backup, filePath);
      } catch {
        // The outer rollback reports incomplete recovery.
      }
    }
    throw error;
  }
}

export async function applyModuleDispositionPlan(
  plan: ModuleDispositionPlan,
  packages: readonly VerifiedModulePackage[]
): Promise<ModuleDispositionResult> {
  verifyModuleDispositionPlan(plan);
  const state = await readState(plan.projectRoot);
  if (
    sha256(state.projectBytes) !== plan.preconditions.projectManifestDigest ||
    sha256(state.lockBytes) !== plan.preconditions.lockDigest ||
    sha256(state.ownershipBytes) !== plan.preconditions.ownershipDigest
  ) {
    throw new ModuleDispositionError("Project control files changed after planning", "module.projectChanged");
  }
  if (plan.state === "unchanged") {
    return { status: "unchanged", planId: plan.planId, projectRoot: plan.projectRoot, moduleId: plan.module.id, command: plan.command, changedPaths: [] };
  }

  const packagesById = new Map(packages.map((modulePackage) => [modulePackage.manifest.id, modulePackage]));
  for (const plannedPackage of plan.packages) {
    const currentPackage = packagesById.get(plannedPackage.id);
    if (
      !currentPackage ||
      currentPackage.manifest.version !== plannedPackage.version ||
      currentPackage.digest !== plannedPackage.digest ||
      sha256(await readFile(currentPackage.manifestPath)) !== currentPackage.manifestDigest ||
      sha256(await readFile(currentPackage.configurationPath)) !== currentPackage.configurationDigest
    ) {
      throw new ModuleDispositionError(`Module package changed after planning: ${plannedPackage.id}`, "module.packageChanged");
    }
    for (const artifact of currentPackage.artifacts) {
      if (sha256(await readFile(artifact.sourcePath)) !== artifact.sourceDigest) {
        throw new ModuleDispositionError(`Module package changed after planning: ${plannedPackage.id}`, "module.packageChanged");
      }
    }
    for (const migration of currentPackage.migrations) {
      if (
        sha256(await readFile(migration.sourcePath)) !== migration.sourceDigest ||
        sha256(await readFile(migration.descriptorPath)) !== migration.descriptorDigest
      ) {
        throw new ModuleDispositionError(`Module package changed after planning: ${plannedPackage.id}`, "module.packageChanged");
      }
    }
  }
  for (const file of plan.files) {
    if (sha256(await readFile(await assertRegularManagedFile(plan.projectRoot, file.path))) !== file.currentDigest) {
      throw new ModuleDispositionError(`Managed file changed after planning: ${file.path}`, "module.projectChanged");
    }
  }

  const removedFiles = new Map<string, Buffer>();
  try {
    if (plan.command === "remove") {
      for (const file of plan.files) {
        const filePath = path.join(plan.projectRoot, file.path);
        removedFiles.set(filePath, await readFile(filePath));
        await rm(filePath);
      }
    }

    const nextProject = structuredClone(state.project);
    nextProject.modules = { ...(nextProject.modules ?? {}) };
    delete nextProject.modules[plan.module.id];
    const nextLock = structuredClone(state.lock);
    nextLock.modules = { ...(nextLock.modules ?? {}) };
    nextLock.generatedFiles = { ...(nextLock.generatedFiles ?? {}) };
    delete nextLock.modules[plan.module.id];
    for (const file of plan.files) delete nextLock.generatedFiles[file.path];

    const nextOwnership = structuredClone(state.ownership);
    if (plan.command === "eject") {
      for (const file of plan.files) {
        nextOwnership.rules.push({ pattern: file.path, owner: "project", policy: "never-overwrite" });
      }
    }

    const projectPath = path.join(plan.projectRoot, ".flower", "project.json");
    const lockPath = path.join(plan.projectRoot, ".flower", "lock.json");
    const ownershipPath = path.join(plan.projectRoot, ".flower", "ownership.json");
    await replaceFile(projectPath, Buffer.from(`${JSON.stringify(nextProject, null, 2)}\n`));
    await replaceFile(lockPath, Buffer.from(`${JSON.stringify(nextLock, null, 2)}\n`));
    if (plan.command === "eject") {
      await replaceFile(ownershipPath, Buffer.from(`${JSON.stringify(nextOwnership, null, 2)}\n`));
    }
    const changedPaths = [
      ...plan.files.map((file) => file.path),
      ".flower/project.json",
      ".flower/lock.json",
      ...(plan.command === "eject" ? [".flower/ownership.json"] : [])
    ];
    const journalPath = await writeLocalJournal(plan.projectRoot, createJournalEntry(`flower ${plan.command}`, "completed", {
      planId: plan.planId,
      changedPaths,
      result: { module: plan.module, disposition: plan.command }
    }));
    return {
      status: "completed",
      planId: plan.planId,
      projectRoot: plan.projectRoot,
      moduleId: plan.module.id,
      command: plan.command,
      changedPaths,
      journalPath
    };
  } catch (error) {
    let rollbackComplete = true;
    try {
      for (const [filePath, contents] of removedFiles) {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, contents);
      }
      await writeFile(path.join(plan.projectRoot, ".flower", "project.json"), state.projectBytes);
      await writeFile(path.join(plan.projectRoot, ".flower", "lock.json"), state.lockBytes);
      await writeFile(path.join(plan.projectRoot, ".flower", "ownership.json"), state.ownershipBytes);
    } catch {
      rollbackComplete = false;
    }
    if (!rollbackComplete) {
      try {
        await writeLocalJournal(plan.projectRoot, createJournalEntry(`flower ${plan.command}`, "partial", {
          planId: plan.planId,
          changedPaths: plan.files.map((file) => file.path),
          errorCode: "module.rollbackIncomplete",
          result: { error: error instanceof Error ? error.message : "Module operation failed" }
        }));
      } catch {
        // The returned error still requires manual recovery.
      }
    }
    throw new ModuleDispositionError(
      error instanceof Error ? error.message : "Module operation failed",
      rollbackComplete ? "module.rolledBack" : "module.rollbackIncomplete",
      error instanceof ModuleDispositionError ? error.diagnostics : [],
      rollbackComplete
    );
  }
}
