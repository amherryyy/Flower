import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createJournalEntry, writeLocalJournal } from "./journal.js";
import { normalizeProjectPath } from "./ownership.js";
import { sha256 } from "./template.js";
import type {
  AgentAdapterBundle,
  AgentAdapterMaterializationAction,
  AgentAdapterMaterializationHooks,
  AgentAdapterMaterializationPlan,
  AgentAdapterMaterializationResult,
  AgentAdapterState,
  Diagnostic
} from "./types.js";
import { validateDocument } from "./validation.js";

export class AgentAdapterMaterializationError extends Error {
  readonly code: string;
  readonly diagnostics: Diagnostic[];
  readonly rollbackComplete: boolean;

  constructor(message: string, code: string, diagnostics: Diagnostic[] = [], rollbackComplete = true) {
    super(message);
    this.name = "AgentAdapterMaterializationError";
    this.code = code;
    this.diagnostics = diagnostics;
    this.rollbackComplete = rollbackComplete;
  }
}

export function agentAdapterBundleDigest(bundle: AgentAdapterBundle): string {
  return sha256(JSON.stringify({
    stateDigest: bundle.stateDigest,
    artifacts: bundle.artifacts.map(({ adapter, path: artifactPath, generatorVersion, inputDigest, outputDigest }) => ({
      adapter,
      path: artifactPath,
      generatorVersion,
      inputDigest,
      outputDigest
    }))
  }));
}

function assertBundle(bundle: AgentAdapterBundle): void {
  const canonicalState = `${JSON.stringify(bundle.state, null, 2)}\n`;
  if (bundle.statePath !== ".flower/generated/agent-adapters.json" ||
      bundle.stateContent !== canonicalState ||
      bundle.stateDigest !== sha256(bundle.stateContent)) {
    throw new AgentAdapterMaterializationError("Agent adapter bundle state is invalid", "adapter.invalidBundle");
  }
  const paths = new Set<string>();
  for (const artifact of bundle.artifacts) {
    const normalized = normalizeProjectPath(artifact.path);
    if (normalized !== artifact.path || paths.has(normalized) || sha256(artifact.content) !== artifact.outputDigest) {
      throw new AgentAdapterMaterializationError(`Agent adapter artifact is invalid: ${artifact.path}`, "adapter.invalidBundle");
    }
    if (artifact.missingCapabilities.length > 0) {
      throw new AgentAdapterMaterializationError(
        `Agent adapter '${artifact.adapter}' has unsupported capabilities: ${artifact.missingCapabilities.join(", ")}`,
        "adapter.capabilityMissing"
      );
    }
    paths.add(normalized);
  }
  const expectedState = bundle.artifacts.map(({ adapter, path: artifactPath, inputDigest, outputDigest }) => ({
    adapter,
    path: artifactPath,
    inputDigest,
    outputDigest
  }));
  if (JSON.stringify(bundle.state.artifacts) !== JSON.stringify(expectedState) ||
      bundle.artifacts.some(({ generatorVersion }) => generatorVersion !== bundle.state.generatorVersion)) {
    throw new AgentAdapterMaterializationError("Agent adapter bundle metadata is inconsistent", "adapter.invalidBundle");
  }
}

function withIdentity(
  payload: Omit<AgentAdapterMaterializationPlan, "planId" | "digest">
): AgentAdapterMaterializationPlan {
  const digest = sha256(JSON.stringify(payload));
  return { ...payload, planId: `adapters-${digest.slice(7, 19)}`, digest };
}

export function verifyAgentAdapterMaterializationPlan(plan: AgentAdapterMaterializationPlan): void {
  const { planId, digest, ...payload } = plan;
  const expected = withIdentity(payload);
  if (planId !== expected.planId || digest !== expected.digest) {
    throw new AgentAdapterMaterializationError("Agent adapter materialization plan digest is invalid", "adapter.invalidPlan");
  }
}

function contained(root: string, target: string): boolean {
  const relation = path.relative(root, target);
  return !path.isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${path.sep}`);
}

async function assertSafeRoot(root: string): Promise<string> {
  const details = await lstat(root);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new AgentAdapterMaterializationError("Project root is not a regular directory", "adapter.unsafePath");
  }
  return await realpath(root);
}

async function readManagedFile(root: string, realRoot: string, relativePath: string): Promise<Buffer | undefined> {
  const normalized = normalizeProjectPath(relativePath);
  if (normalized !== relativePath) {
    throw new AgentAdapterMaterializationError(`Adapter path is not canonical: ${relativePath}`, "adapter.unsafePath");
  }
  const absolute = path.resolve(root, normalized);
  if (!contained(root, absolute)) {
    throw new AgentAdapterMaterializationError(`Adapter path escapes the project root: ${relativePath}`, "adapter.unsafePath");
  }
  let current = root;
  for (const segment of normalized.split("/").slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink() || !details.isDirectory()) {
        throw new AgentAdapterMaterializationError(`Adapter path has an unsafe parent: ${relativePath}`, "adapter.unsafePath");
      }
    } catch (error) {
      if (error instanceof AgentAdapterMaterializationError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  try {
    const details = await lstat(absolute);
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new AgentAdapterMaterializationError(`Adapter path is not a regular file: ${relativePath}`, "adapter.unsafePath");
    }
    const resolved = await realpath(absolute);
    if (!contained(realRoot, resolved)) {
      throw new AgentAdapterMaterializationError(`Adapter path escapes the project root: ${relativePath}`, "adapter.unsafePath");
    }
    return await readFile(absolute);
  } catch (error) {
    if (error instanceof AgentAdapterMaterializationError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function parsePreviousState(contents: Buffer | undefined, stateSchema: object): AgentAdapterState | undefined {
  if (!contents) return undefined;
  let document: unknown;
  try {
    document = JSON.parse(contents.toString("utf8")) as unknown;
  } catch (error) {
    throw new AgentAdapterMaterializationError(
      error instanceof Error ? error.message : "Generated adapter state is invalid JSON",
      "adapter.invalidState"
    );
  }
  const validation = validateDocument(stateSchema, document, "adapterState");
  if (!validation.valid) {
    throw new AgentAdapterMaterializationError("Generated adapter state is invalid", "adapter.invalidState", validation.diagnostics);
  }
  const state = document as AgentAdapterState;
  if (new Set(state.artifacts.map(({ path: artifactPath }) => artifactPath)).size !== state.artifacts.length) {
    throw new AgentAdapterMaterializationError("Generated adapter state contains duplicate paths", "adapter.invalidState");
  }
  return state;
}

function action(
  kind: AgentAdapterMaterializationAction["kind"],
  artifactPath: string,
  before: Buffer | undefined,
  afterDigest?: string
): AgentAdapterMaterializationAction {
  return {
    kind,
    path: artifactPath,
    ...(before ? { beforeDigest: sha256(before) } : {}),
    ...(afterDigest ? { afterDigest } : {})
  };
}

export async function createAgentAdapterMaterializationPlan(
  projectRootInput: string,
  bundle: AgentAdapterBundle,
  stateSchema: object
): Promise<AgentAdapterMaterializationPlan> {
  assertBundle(bundle);
  const expectedStateValidation = validateDocument(stateSchema, bundle.state, "adapterState");
  if (!expectedStateValidation.valid) {
    throw new AgentAdapterMaterializationError(
      "Agent adapter bundle state does not match the state schema",
      "adapter.invalidBundle",
      expectedStateValidation.diagnostics
    );
  }
  const projectRoot = path.resolve(projectRootInput);
  const realRoot = await assertSafeRoot(projectRoot);
  const stateBytes = await readManagedFile(projectRoot, realRoot, bundle.statePath);
  const previous = parsePreviousState(stateBytes, stateSchema);
  const previousByPath = new Map(previous?.artifacts.map((artifact) => [artifact.path, artifact]));
  const expectedByPath = new Map(bundle.artifacts.map((artifact) => [artifact.path, artifact]));
  const actions: AgentAdapterMaterializationAction[] = [];

  for (const artifact of bundle.artifacts) {
    const current = await readManagedFile(projectRoot, realRoot, artifact.path);
    const prior = previousByPath.get(artifact.path);
    if (!current) {
      actions.push(action("create", artifact.path, undefined, artifact.outputDigest));
      continue;
    }
    const currentDigest = sha256(current);
    if (currentDigest === artifact.outputDigest) continue;
    if (!prior) {
      throw new AgentAdapterMaterializationError(
        `Refusing to replace untracked adapter file: ${artifact.path}`,
        "adapter.unmanagedCollision"
      );
    }
    if (currentDigest !== prior.outputDigest) {
      throw new AgentAdapterMaterializationError(
        `Refusing to replace modified adapter file: ${artifact.path}`,
        "adapter.modified"
      );
    }
    actions.push(action("replace", artifact.path, current, artifact.outputDigest));
  }

  for (const prior of previous?.artifacts ?? []) {
    if (expectedByPath.has(prior.path)) continue;
    const current = await readManagedFile(projectRoot, realRoot, prior.path);
    if (!current) continue;
    if (sha256(current) !== prior.outputDigest) {
      throw new AgentAdapterMaterializationError(
        `Refusing to remove modified adapter file: ${prior.path}`,
        "adapter.modified"
      );
    }
    actions.push(action("remove", prior.path, current));
  }

  actions.sort((left, right) => left.path.localeCompare(right.path));
  if (!stateBytes) actions.push(action("create", bundle.statePath, undefined, bundle.stateDigest));
  else if (sha256(stateBytes) !== bundle.stateDigest) {
    actions.push(action("replace", bundle.statePath, stateBytes, bundle.stateDigest));
  }
  return withIdentity({
    schemaVersion: 1,
    command: "adapter-materialize",
    state: actions.length === 0 ? "unchanged" : "apply",
    projectRoot,
    bundleDigest: agentAdapterBundleDigest(bundle),
    actions
  });
}

async function missingParentDirectories(root: string, relativePath: string): Promise<string[]> {
  const directories: string[] = [];
  let current = root;
  let missing = false;
  for (const segment of normalizeProjectPath(relativePath).split("/").slice(0, -1)) {
    current = path.join(current, segment);
    if (missing) {
      directories.push(current);
      continue;
    }
    try {
      await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing = true;
      directories.push(current);
    }
  }
  return directories;
}

async function atomicWrite(filePath: string, contents: Buffer): Promise<void> {
  const suffix = randomUUID();
  const temporary = `${filePath}.${suffix}.tmp`;
  const backup = `${filePath}.${suffix}.bak`;
  await writeFile(temporary, contents, { flag: "wx" });
  let moved = false;
  try {
    try {
      await rename(filePath, backup);
      moved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(temporary, filePath);
    if (moved) await rm(backup, { force: true });
  } catch (error) {
    await rm(temporary, { force: true });
    if (moved) {
      try {
        await rm(filePath, { force: true });
        await rename(backup, filePath);
      } catch {
        // The transaction rollback reports incomplete recovery if restoration fails too.
      }
    }
    throw error;
  }
}

async function removeCreatedDirectories(root: string, directories: string[]): Promise<void> {
  const unique = [...new Set(directories)].sort((left, right) => right.length - left.length);
  for (const directory of unique) {
    if (directory === root) continue;
    try {
      await rmdir(directory);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
}

function contentsFor(bundle: AgentAdapterBundle, artifactPath: string): Buffer {
  if (artifactPath === bundle.statePath) return Buffer.from(bundle.stateContent);
  const artifact = bundle.artifacts.find((candidate) => candidate.path === artifactPath);
  if (!artifact) {
    throw new AgentAdapterMaterializationError(`Planned adapter output is missing: ${artifactPath}`, "adapter.bundleChanged");
  }
  return Buffer.from(artifact.content);
}

export async function applyAgentAdapterMaterializationPlan(
  plan: AgentAdapterMaterializationPlan,
  bundle: AgentAdapterBundle,
  stateSchema: object,
  hooks: AgentAdapterMaterializationHooks = {}
): Promise<AgentAdapterMaterializationResult> {
  verifyAgentAdapterMaterializationPlan(plan);
  assertBundle(bundle);
  if (agentAdapterBundleDigest(bundle) !== plan.bundleDigest) {
    throw new AgentAdapterMaterializationError("Agent adapter bundle changed after planning", "adapter.bundleChanged");
  }
  const currentPlan = await createAgentAdapterMaterializationPlan(plan.projectRoot, bundle, stateSchema);
  if (JSON.stringify(currentPlan) !== JSON.stringify(plan)) {
    throw new AgentAdapterMaterializationError("Adapter files changed after planning", "adapter.projectChanged");
  }
  if (plan.state === "unchanged") {
    return { status: "unchanged", planId: plan.planId, projectRoot: plan.projectRoot, changedPaths: [] };
  }

  const realRoot = await assertSafeRoot(plan.projectRoot);
  const snapshots = new Map<string, Buffer | undefined>();
  for (const plannedAction of plan.actions) {
    snapshots.set(plannedAction.path, await readManagedFile(plan.projectRoot, realRoot, plannedAction.path));
  }
  const executed: AgentAdapterMaterializationAction[] = [];
  const createdDirectories: string[] = [];
  try {
    for (const [index, plannedAction] of plan.actions.entries()) {
      const absolute = path.join(plan.projectRoot, plannedAction.path);
      if (plannedAction.kind === "remove") {
        await rm(absolute);
      } else {
        const missing = await missingParentDirectories(plan.projectRoot, plannedAction.path);
        await mkdir(path.dirname(absolute), { recursive: true });
        createdDirectories.push(...missing);
        const output = contentsFor(bundle, plannedAction.path);
        if (sha256(output) !== plannedAction.afterDigest) {
          throw new AgentAdapterMaterializationError(`Adapter output changed: ${plannedAction.path}`, "adapter.bundleChanged");
        }
        await atomicWrite(absolute, output);
      }
      executed.push(plannedAction);
      const after = await readManagedFile(plan.projectRoot, realRoot, plannedAction.path);
      if (plannedAction.kind === "remove" ? after !== undefined : !after || sha256(after) !== plannedAction.afterDigest) {
        throw new AgentAdapterMaterializationError(
          `Adapter write verification failed: ${plannedAction.path}`,
          "adapter.verificationFailed"
        );
      }
      await hooks.afterAction?.(plannedAction, index);
    }
    const changedPaths = plan.actions.map(({ path: actionPath }) => actionPath);
    const journalPath = await writeLocalJournal(plan.projectRoot, createJournalEntry("flower adapters materialize", "completed", {
      planId: plan.planId,
      changedPaths,
      result: { adapters: bundle.artifacts.map(({ adapter }) => adapter) }
    }));
    return { status: "completed", planId: plan.planId, projectRoot: plan.projectRoot, changedPaths, journalPath };
  } catch (error) {
    let rollbackComplete = true;
    for (const plannedAction of [...executed].reverse()) {
      try {
        const snapshot = snapshots.get(plannedAction.path);
        const absolute = path.join(plan.projectRoot, plannedAction.path);
        if (snapshot) await atomicWrite(absolute, snapshot);
        else await rm(absolute, { force: true });
      } catch {
        rollbackComplete = false;
      }
    }
    try {
      await removeCreatedDirectories(plan.projectRoot, createdDirectories);
    } catch {
      rollbackComplete = false;
    }
    if (!rollbackComplete) {
      try {
        await writeLocalJournal(plan.projectRoot, createJournalEntry("flower adapters materialize", "partial", {
          planId: plan.planId,
          changedPaths: plan.actions.map(({ path: actionPath }) => actionPath),
          errorCode: "adapter.rollbackIncomplete",
          result: { error: error instanceof Error ? error.message : "Adapter materialization failed" }
        }));
      } catch {
        // The returned error still requires manual recovery.
      }
    }
    throw new AgentAdapterMaterializationError(
      error instanceof Error ? error.message : "Adapter materialization failed",
      rollbackComplete ? "adapter.rolledBack" : "adapter.rollbackIncomplete",
      error instanceof AgentAdapterMaterializationError ? error.diagnostics : [],
      rollbackComplete
    );
  }
}
