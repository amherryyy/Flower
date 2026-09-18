import { spawn } from "node:child_process";
import { readFile, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createJournalEntry,
  writeLocalJournal
} from "./journal.js";
import { normalizeProjectPath } from "./ownership.js";
import { packageManager } from "./package-manager.js";
import { renderTemplate, sha256 } from "./template.js";
import { FLOWER_VERSION, type CommandRunner, type InitOptions, type InitPlan, type InitResult, type VerifiedTemplate } from "./types.js";

const PROJECT_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export class InitializationError extends Error {
  readonly code: string;
  readonly rollbackComplete: boolean;

  constructor(message: string, code: string, rollbackComplete = true) {
    super(message);
    this.name = "InitializationError";
    this.code = code;
    this.rollbackComplete = rollbackComplete;
  }
}

function planPayload(plan: Omit<InitPlan, "planId" | "digest">): string {
  return JSON.stringify(plan);
}

function withIdentity(plan: Omit<InitPlan, "planId" | "digest">): InitPlan {
  const digest = sha256(planPayload(plan));
  return { ...plan, planId: `init-${digest.slice(7, 19)}`, digest };
}

export function verifyInitPlan(plan: InitPlan): void {
  const { planId, digest, ...payload } = plan;
  const expected = withIdentity(payload);
  if (digest !== expected.digest || planId !== expected.planId) {
    throw new InitializationError("Initialization plan digest is invalid", "init.invalidPlan");
  }
}

async function targetState(target: string): Promise<"missing" | "empty" | "non-empty"> {
  try {
    const details = await lstat(target);
    if (!details.isDirectory()) return "non-empty";
    return (await readdir(target)).length === 0 ? "empty" : "non-empty";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function matchesExistingInitialization(
  target: string,
  options: InitOptions,
  template: VerifiedTemplate
): Promise<boolean> {
  try {
    const [projectDocument, lockDocument] = await Promise.all([
      readFile(path.join(target, ".flower", "project.json"), "utf8"),
      readFile(path.join(target, ".flower", "lock.json"), "utf8")
    ]);
    const project = JSON.parse(projectDocument) as {
      project?: { id?: string; name?: string };
      stack?: { packageManager?: string };
    };
    const lock = JSON.parse(lockDocument) as {
      template?: { id?: string; version?: string; digest?: string };
    };
    return project.project?.id === options.projectId &&
      project.project.name === options.projectName &&
      project.stack?.packageManager === options.packageManager &&
      lock.template?.id === template.manifest.id &&
      lock.template.version === template.manifest.version &&
      lock.template.digest === template.digest;
  } catch {
    return false;
  }
}

function assertOptions(options: InitOptions, template: VerifiedTemplate): void {
  if (!PROJECT_ID.test(options.projectId) || options.projectId.length > 64) {
    throw new InitializationError("Project id must be a lowercase kebab-case identifier", "init.invalidProjectId");
  }
  if (!options.projectName.trim() || options.projectName.length > 100) {
    throw new InitializationError("Project name must contain 1-100 characters", "init.invalidProjectName");
  }
  if (options.templateId !== template.manifest.id) {
    throw new InitializationError(
      `Loaded template '${template.manifest.id}' does not match requested template '${options.templateId}'`,
      "init.templateMismatch"
    );
  }
  packageManager(options.packageManager);
}

export async function createInitPlan(options: InitOptions, template: VerifiedTemplate): Promise<InitPlan> {
  assertOptions(options, template);
  const target = path.resolve(options.target);
  const state = await targetState(target);
  if (state === "non-empty") {
    if (await matchesExistingInitialization(target, options, template)) {
      return withIdentity({
        schemaVersion: 1,
        command: "init",
        state: "unchanged",
        target,
        project: { id: options.projectId, name: options.projectName },
        template: { id: template.manifest.id, version: template.manifest.version, digest: template.digest },
        packageManager: options.packageManager,
        install: options.install,
        initializeGit: options.initializeGit,
        actions: []
      });
    }
    throw new InitializationError("Initialization target must not exist or must be empty", "init.targetNotEmpty");
  }

  const adapter = packageManager(options.packageManager);
  const actions: InitPlan["actions"] = [
    { kind: "reserve-directory", path: "." },
    ...template.manifest.files
      .map((file) => ({ kind: "write-file" as const, path: normalizeProjectPath(file.target) }))
      .sort((left, right) => (left.path ?? "").localeCompare(right.path ?? ""))
  ];
  if (options.install) {
    const install = adapter.install(target);
    actions.push({ kind: "install-dependencies", command: [install.executable, ...install.args].join(" ") });
    for (const script of template.manifest.verificationScripts) {
      const command = adapter.runScript(target, script);
      actions.push({ kind: "run-script", command: [command.executable, ...command.args].join(" ") });
    }
  }
  if (options.initializeGit) actions.push({ kind: "initialize-git", command: "git init" });
  actions.push({ kind: "write-journal", path: ".flower/journal/local" });

  return withIdentity({
    schemaVersion: 1,
    command: "init",
    state: "create",
    target,
    project: { id: options.projectId, name: options.projectName },
    template: {
      id: template.manifest.id,
      version: template.manifest.version,
      digest: template.digest
    },
    packageManager: options.packageManager,
    install: options.install,
    initializeGit: options.initializeGit,
    actions
  });
}

export const spawnCommand: CommandRunner = async ({ executable, args, cwd }) => {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
};

async function runChecked(runner: CommandRunner, invocation: Parameters<CommandRunner>[0]): Promise<void> {
  const result = await runner(invocation);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
    throw new Error(`${invocation.executable} ${invocation.args.join(" ")} failed: ${detail}`);
  }
}

async function rollbackTarget(target: string, targetExisted: boolean): Promise<boolean> {
  try {
    if (targetExisted) {
      for (const child of await readdir(target)) {
        await rm(path.join(target, child), { recursive: true, force: true });
      }
    } else {
      await rm(target, { recursive: true, force: true });
    }
    return true;
  } catch {
    return false;
  }
}

export async function applyInitPlan(
  plan: InitPlan,
  template: VerifiedTemplate,
  runner: CommandRunner = spawnCommand
): Promise<InitResult> {
  verifyInitPlan(plan);
  if (template.manifest.id !== plan.template.id || template.manifest.version !== plan.template.version || template.digest !== plan.template.digest) {
    throw new InitializationError("Template changed after the initialization plan was created", "init.templateChanged");
  }
  if (plan.state === "unchanged") {
    const options: InitOptions = {
      target: plan.target,
      projectId: plan.project.id,
      projectName: plan.project.name,
      templateId: plan.template.id,
      packageManager: plan.packageManager,
      install: plan.install,
      initializeGit: plan.initializeGit
    };
    if (!await matchesExistingInitialization(plan.target, options, template)) {
      throw new InitializationError("Initialized project changed after planning", "init.targetChanged");
    }
    return { status: "unchanged", planId: plan.planId, target: plan.target, changedPaths: [] };
  }
  const state = await targetState(plan.target);
  if (state === "non-empty") {
    throw new InitializationError("Initialization target changed after planning", "init.targetChanged");
  }
  const targetExisted = state === "empty";
  const changedPaths: string[] = [];

  try {
    if (!targetExisted) await mkdir(plan.target, { recursive: true });
    const values = {
      projectId: plan.project.id,
      projectName: plan.project.name,
      projectNameJson: JSON.stringify(plan.project.name),
      flowerVersion: FLOWER_VERSION,
      packageManager: plan.packageManager,
      templateId: plan.template.id,
      templateVersion: plan.template.version,
      templateDigest: plan.template.digest
    };

    for (const file of template.manifest.files) {
      const relativeTarget = normalizeProjectPath(file.target);
      const destination = path.resolve(plan.target, relativeTarget);
      const relation = path.relative(plan.target, destination);
      if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
        throw new Error(`Template target '${relativeTarget}' escapes the project root`);
      }
      const source = path.resolve(template.root, normalizeProjectPath(file.source));
      const raw = await readFile(source);
      if (sha256(raw) !== file.digest) {
        throw new Error(`Template digest mismatch for '${file.source}'`);
      }
      const contents = file.render ? Buffer.from(renderTemplate(raw.toString("utf8"), values)) : raw;
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents, { flag: "wx" });
      changedPaths.push(relativeTarget);
    }

    const adapter = packageManager(plan.packageManager);
    if (plan.install) {
      await runChecked(runner, adapter.install(plan.target));
      for (const script of template.manifest.verificationScripts) {
        await runChecked(runner, adapter.runScript(plan.target, script));
      }
    }
    if (plan.initializeGit) {
      await runChecked(runner, { executable: "git", args: ["init"], cwd: plan.target });
    }

    const journal = createJournalEntry("flower init", "completed", {
      planId: plan.planId,
      changedPaths,
      result: { template: plan.template, packageManager: plan.packageManager }
    });
    const journalPath = await writeLocalJournal(plan.target, journal);
    return { status: "completed", planId: plan.planId, target: plan.target, changedPaths, journalPath };
  } catch (error) {
    const rollbackComplete = await rollbackTarget(plan.target, targetExisted);
    if (!rollbackComplete) {
      try {
        const journal = createJournalEntry("flower init", "partial", {
          planId: plan.planId,
          changedPaths,
          errorCode: "init.rollbackIncomplete",
          result: { error: error instanceof Error ? error.message : "Initialization failed" }
        });
        await writeLocalJournal(plan.target, journal);
      } catch {
        // The thrown error still reports that manual recovery is required.
      }
    }
    throw new InitializationError(
      error instanceof Error ? error.message : "Initialization failed",
      rollbackComplete ? "init.rolledBack" : "init.rollbackIncomplete",
      rollbackComplete
    );
  }
}
