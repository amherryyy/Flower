import { randomUUID } from "node:crypto";
import { access, lstat, mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createJournalEntry, writeLocalJournal } from "./journal.js";
import { resolveModules } from "./module.js";
import { normalizeProjectPath, validateMutationOwnership } from "./ownership.js";
import { renderTemplate, sha256 } from "./template.js";
import type {
  Diagnostic,
  ModuleAddPlan,
  ModuleAddResult,
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

interface ProjectState {
  projectBytes: Buffer;
  lockBytes: Buffer;
  ownershipBytes: Buffer;
  project: ProjectManifest;
  lock: ProjectLock;
  ownership: OwnershipManifest;
}

export class ModuleAddError extends Error {
  readonly code: string;
  readonly diagnostics: Diagnostic[];
  readonly rollbackComplete: boolean;

  constructor(message: string, code: string, diagnostics: Diagnostic[] = [], rollbackComplete = true) {
    super(message);
    this.name = "ModuleAddError";
    this.code = code;
    this.diagnostics = diagnostics;
    this.rollbackComplete = rollbackComplete;
  }
}

async function readProjectState(projectRoot: string): Promise<ProjectState> {
  const control = path.join(projectRoot, ".flower");
  for (const directory of [projectRoot, control]) {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new ModuleAddError(`Project control path is not a regular directory: ${directory}`, "module.unsafeControlFile");
    }
  }
  const paths = [path.join(control, "project.json"), path.join(control, "lock.json"), path.join(control, "ownership.json")];
  for (const controlPath of paths) {
    const details = await lstat(controlPath);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new ModuleAddError(`Control file is not a regular file: ${controlPath}`, "module.unsafeControlFile");
    }
  }
  const [projectBytes, lockBytes, ownershipBytes] = await Promise.all([
    readFile(paths[0]!),
    readFile(paths[1]!),
    readFile(paths[2]!)
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

function planIdentity(payload: Omit<ModuleAddPlan, "planId" | "digest">): ModuleAddPlan {
  const digest = sha256(JSON.stringify(payload));
  return { ...payload, planId: `add-${digest.slice(7, 19)}`, digest };
}

export function verifyModuleAddPlan(plan: ModuleAddPlan): void {
  const { planId, digest, ...payload } = plan;
  const expected = planIdentity(payload);
  if (planId !== expected.planId || digest !== expected.digest) {
    throw new ModuleAddError("Module add plan digest is invalid", "module.invalidPlan");
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

export async function createModuleAddPlan(
  projectRootInput: string,
  requestedInput: readonly string[],
  packages: readonly VerifiedModulePackage[]
): Promise<ModuleAddPlan> {
  const projectRoot = path.resolve(projectRootInput);
  const state = await readProjectState(projectRoot);
  if (state.project.mode !== "project") {
    throw new ModuleAddError("Modules can only be added in project mode", "module.invalidProjectMode");
  }
  if (state.lock.lockVersion !== 1) {
    throw new ModuleAddError(`Unsupported lock version ${state.lock.lockVersion}`, "module.unsupportedLockVersion");
  }
  const resolution = resolveModules(packages.map((modulePackage) => modulePackage.manifest), requestedInput, state.project.modules ?? {});
  if (!resolution.valid) {
    throw new ModuleAddError("Module dependency resolution failed", "module.resolutionFailed", resolution.diagnostics);
  }
  const packagesById = new Map(packages.map((modulePackage) => [modulePackage.manifest.id, modulePackage]));
  const installIds = resolution.actions.filter((action) => action.kind === "install").map((action) => action.moduleId);
  const retainIds = resolution.actions.filter((action) => action.kind === "retain").map((action) => action.moduleId);
  const resolvedPackages = resolution.resolved.map((moduleId) => {
    const modulePackage = packagesById.get(moduleId)!;
    return { id: moduleId, version: modulePackage.manifest.version, digest: modulePackage.digest };
  });
  const modules = installIds.map((moduleId) => {
    const modulePackage = packagesById.get(moduleId)!;
    return { id: moduleId, version: modulePackage.manifest.version, digest: modulePackage.digest };
  });
  const files: ModuleAddPlan["files"] = [];
  const targets = new Set<string>();

  for (const moduleId of retainIds) {
    const modulePackage = packagesById.get(moduleId)!;
    const lockedModule = state.lock.modules?.[moduleId];
    if (
      !lockedModule ||
      lockedModule.version !== modulePackage.manifest.version ||
      lockedModule.digest !== modulePackage.digest
    ) {
      throw new ModuleAddError(`Installed module state does not match the lock: ${moduleId}`, "module.installedStateMismatch");
    }
    for (const artifact of modulePackage.artifacts) {
      const expected = state.lock.generatedFiles?.[artifact.path];
      try {
        const source = await readFile(artifact.sourcePath);
        const rendered = renderTemplate(source.toString("utf8"), renderValues(state.project, modulePackage));
        const packageExpected = sha256(rendered);
        const actual = sha256(await readFile(path.join(projectRoot, artifact.path)));
        if (sha256(source) !== artifact.sourceDigest || !expected || expected !== packageExpected || actual !== packageExpected) {
          throw new ModuleAddError(`Generated file drift detected: ${artifact.path}`, "module.generatedFileDrift");
        }
      } catch (error) {
        if (error instanceof ModuleAddError) throw error;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new ModuleAddError(`Generated file is missing: ${artifact.path}`, "module.generatedFileDrift");
        }
        throw error;
      }
    }
  }

  for (const moduleId of installIds) {
    const modulePackage = packagesById.get(moduleId)!;
    for (const artifact of modulePackage.artifacts) {
      const target = normalizeProjectPath(artifact.path);
      const portableTarget = target.toLowerCase();
      const lockedTargets = Object.keys(state.lock.generatedFiles ?? {}).map((lockedTarget) => lockedTarget.toLowerCase());
      if (targets.has(portableTarget) || lockedTargets.includes(portableTarget)) {
        throw new ModuleAddError(`Generated path '${target}' is already managed`, "module.generatedPathConflict");
      }
      targets.add(portableTarget);
      const ownership = validateMutationOwnership(state.ownership, [target], ["generated"]);
      if (!ownership.valid) {
        throw new ModuleAddError(`Generated path '${target}' is not writable by the module workflow`, "module.ownershipDenied", ownership.diagnostics);
      }
      try {
        await access(path.join(projectRoot, target));
        throw new ModuleAddError(`Generated path already exists: ${target}`, "module.pathExists");
      } catch (error) {
        if (error instanceof ModuleAddError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const source = await readFile(artifact.sourcePath);
      if (sha256(source) !== artifact.sourceDigest) {
        throw new ModuleAddError(`Module source changed after verification: ${moduleId}/${target}`, "module.sourceChanged");
      }
      const output = renderTemplate(source.toString("utf8"), renderValues(state.project, modulePackage));
      files.push({ moduleId, path: target, sourceDigest: artifact.sourceDigest, outputDigest: sha256(output) });
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return planIdentity({
    schemaVersion: 1,
    command: "add",
    state: modules.length === 0 ? "unchanged" : "apply",
    projectRoot,
    requested: resolution.requested,
    resolved: resolution.resolved,
    packages: resolvedPackages,
    modules,
    files,
    preconditions: {
      projectManifestDigest: sha256(state.projectBytes),
      lockDigest: sha256(state.lockBytes),
      ownershipDigest: sha256(state.ownershipBytes)
    }
  });
}

async function assertNoSymlinkParents(projectRoot: string, relativePath: string): Promise<void> {
  const segments = normalizeProjectPath(relativePath).split("/").slice(0, -1);
  let current = projectRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) throw new ModuleAddError(`Generated path traverses a symbolic link: ${relativePath}`, "module.unsafeGeneratedPath");
      if (!details.isDirectory()) throw new ModuleAddError(`Generated path parent is not a directory: ${relativePath}`, "module.unsafeGeneratedPath");
    } catch (error) {
      if (error instanceof ModuleAddError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
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
        // The outer rollback reports incomplete recovery if restoration also fails.
      }
    }
    throw error;
  }
}

async function removeCreatedDirectories(projectRoot: string, directories: string[]): Promise<void> {
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    if (directory === projectRoot) continue;
    try {
      await rmdir(directory);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
}

export async function applyModuleAddPlan(
  plan: ModuleAddPlan,
  packages: readonly VerifiedModulePackage[]
): Promise<ModuleAddResult> {
  verifyModuleAddPlan(plan);
  const state = await readProjectState(plan.projectRoot);
  if (
    sha256(state.projectBytes) !== plan.preconditions.projectManifestDigest ||
    sha256(state.lockBytes) !== plan.preconditions.lockDigest ||
    sha256(state.ownershipBytes) !== plan.preconditions.ownershipDigest
  ) {
    throw new ModuleAddError("Project control files changed after planning", "module.projectChanged");
  }
  const packagesById = new Map(packages.map((modulePackage) => [modulePackage.manifest.id, modulePackage]));
  for (const plannedModule of plan.packages) {
    const modulePackage = packagesById.get(plannedModule.id);
    if (
      !modulePackage ||
      modulePackage.manifest.version !== plannedModule.version ||
      modulePackage.digest !== plannedModule.digest ||
      sha256(await readFile(modulePackage.manifestPath)) !== modulePackage.manifestDigest ||
      sha256(await readFile(modulePackage.configurationPath)) !== modulePackage.configurationDigest
    ) {
      throw new ModuleAddError(`Module package changed after planning: ${plannedModule.id}`, "module.packageChanged");
    }
    for (const artifact of modulePackage.artifacts) {
      if (sha256(await readFile(artifact.sourcePath)) !== artifact.sourceDigest) {
        throw new ModuleAddError(`Module package changed after planning: ${plannedModule.id}`, "module.packageChanged");
      }
    }
    for (const migration of modulePackage.migrations) {
      if (sha256(await readFile(migration.sourcePath)) !== migration.sourceDigest) {
        throw new ModuleAddError(`Module package changed after planning: ${plannedModule.id}`, "module.packageChanged");
      }
    }
  }
  if (plan.state === "unchanged") {
    return { status: "unchanged", planId: plan.planId, projectRoot: plan.projectRoot, installedModules: [], changedPaths: [] };
  }

  const createdFiles: string[] = [];
  const createdDirectories: string[] = [];
  try {
    for (const plannedFile of plan.files) {
      const modulePackage = packagesById.get(plannedFile.moduleId)!;
      const artifact = modulePackage.artifacts.find((candidate) => candidate.path === plannedFile.path);
      if (!artifact) throw new ModuleAddError(`Module artifact changed after planning: ${plannedFile.path}`, "module.packageChanged");
      const source = await readFile(artifact.sourcePath);
      const output = renderTemplate(source.toString("utf8"), renderValues(state.project, modulePackage));
      if (sha256(source) !== plannedFile.sourceDigest || sha256(output) !== plannedFile.outputDigest) {
        throw new ModuleAddError(`Module artifact changed after planning: ${plannedFile.path}`, "module.packageChanged");
      }
      await assertNoSymlinkParents(plan.projectRoot, plannedFile.path);
      const destination = path.join(plan.projectRoot, plannedFile.path);
      let current = path.dirname(destination);
      const missing: string[] = [];
      while (current !== plan.projectRoot) {
        try { await access(current); break; } catch { missing.push(current); current = path.dirname(current); }
      }
      await mkdir(path.dirname(destination), { recursive: true });
      createdDirectories.push(...missing);
      await writeFile(destination, output, { flag: "wx" });
      createdFiles.push(destination);
      if (sha256(await readFile(destination)) !== plannedFile.outputDigest) {
        throw new ModuleAddError(`Generated file verification failed: ${plannedFile.path}`, "module.generatedFileVerificationFailed");
      }
    }

    const nextProject = structuredClone(state.project);
    nextProject.modules = { ...(nextProject.modules ?? {}) };
    const nextLock = structuredClone(state.lock);
    nextLock.modules = { ...(nextLock.modules ?? {}) };
    nextLock.generatedFiles = { ...(nextLock.generatedFiles ?? {}) };
    for (const plannedModule of plan.modules) {
      const modulePackage = packagesById.get(plannedModule.id)!;
      nextProject.modules[plannedModule.id] = plannedModule.version;
      nextLock.modules[plannedModule.id] = {
        version: plannedModule.version,
        digest: plannedModule.digest,
        migrations: [...modulePackage.manifest.migrations]
      };
    }
    for (const plannedFile of plan.files) nextLock.generatedFiles[plannedFile.path] = plannedFile.outputDigest;

    const projectPath = path.join(plan.projectRoot, ".flower", "project.json");
    const lockPath = path.join(plan.projectRoot, ".flower", "lock.json");
    await replaceFile(projectPath, Buffer.from(`${JSON.stringify(nextProject, null, 2)}\n`));
    await replaceFile(lockPath, Buffer.from(`${JSON.stringify(nextLock, null, 2)}\n`));
    const changedPaths = [...plan.files.map((file) => file.path), ".flower/project.json", ".flower/lock.json"];
    const journalPath = await writeLocalJournal(plan.projectRoot, createJournalEntry("flower add", "completed", {
      planId: plan.planId,
      changedPaths,
      result: { modules: plan.modules.map((module) => ({ id: module.id, version: module.version })) }
    }));
    return {
      status: "completed",
      planId: plan.planId,
      projectRoot: plan.projectRoot,
      installedModules: plan.modules.map((module) => module.id),
      changedPaths,
      journalPath
    };
  } catch (error) {
    let rollbackComplete = true;
    try {
      await Promise.all(createdFiles.map((filePath) => rm(filePath, { force: true })));
      await removeCreatedDirectories(plan.projectRoot, createdDirectories);
      await writeFile(path.join(plan.projectRoot, ".flower", "project.json"), state.projectBytes);
      await writeFile(path.join(plan.projectRoot, ".flower", "lock.json"), state.lockBytes);
    } catch {
      rollbackComplete = false;
    }
    if (!rollbackComplete) {
      try {
        await writeLocalJournal(plan.projectRoot, createJournalEntry("flower add", "partial", {
          planId: plan.planId,
          changedPaths: plan.files.map((file) => file.path),
          errorCode: "module.rollbackIncomplete",
          result: { error: error instanceof Error ? error.message : "Module installation failed" }
        }));
      } catch {
        // The returned error still requires manual recovery.
      }
    }
    throw new ModuleAddError(
      error instanceof Error ? error.message : "Module installation failed",
      rollbackComplete ? "module.rolledBack" : "module.rollbackIncomplete",
      error instanceof ModuleAddError ? error.diagnostics : [],
      rollbackComplete
    );
  }
}
