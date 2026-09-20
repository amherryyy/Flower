import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkflowJournalStore, WorkflowRunJournal, WorkflowStepStatus } from "./types.js";
import { sha256 } from "./template.js";
import { WorkflowExecutionError } from "./workflow.js";

const PLAN_ID = /^workflow-[a-f0-9]{12}$/;
const JOURNAL_STATUS = new Set(["running", "awaiting-approval", "completed", "failed"]);
const STEP_STATUS = new Set<WorkflowStepStatus>(["pending", "completed", "failed", "awaiting-approval"]);

interface WorkflowJournalEnvelope {
  schemaVersion: 1;
  digest: string;
  journal: WorkflowRunJournal;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)])
    );
  }
  return value;
}

function journalDigest(journal: WorkflowRunJournal): string {
  return sha256(JSON.stringify(canonicalValue(journal)));
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === allowed.length && keys.every((key, index) => key === [...allowed].sort()[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJournal(value: unknown): WorkflowRunJournal {
  if (!isRecord(value)) throw new Error("journal must be an object");
  const allowedKeys = [
    "schemaVersion",
    "revision",
    "runId",
    "planId",
    "planDigest",
    "workflowId",
    "status",
    "nextStepIndex",
    "steps",
    ...(value.errorCode === undefined ? [] : ["errorCode"])
  ];
  if (!exactKeys(value, allowedKeys)) throw new Error("journal contains unknown or missing fields");
  if (
    value.schemaVersion !== 1 ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.runId !== "string" ||
    typeof value.planId !== "string" ||
    typeof value.planDigest !== "string" ||
    typeof value.workflowId !== "string" ||
    typeof value.status !== "string" ||
    !JOURNAL_STATUS.has(value.status) ||
    !Number.isInteger(value.nextStepIndex) ||
    (value.nextStepIndex as number) < 0 ||
    !Array.isArray(value.steps) ||
    (value.errorCode !== undefined && typeof value.errorCode !== "string")
  ) {
    throw new Error("journal fields are invalid");
  }

  for (const step of value.steps) {
    if (
      !isRecord(step) ||
      !exactKeys(step, ["id", "action", "status"]) ||
      typeof step.id !== "string" ||
      typeof step.action !== "string" ||
      typeof step.status !== "string" ||
      !STEP_STATUS.has(step.status as WorkflowStepStatus)
    ) {
      throw new Error("journal step is invalid");
    }
  }
  return structuredClone(value) as unknown as WorkflowRunJournal;
}

function parseEnvelope(value: unknown, planId: string): WorkflowJournalEnvelope {
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "digest", "journal"])) {
    throw new Error("journal envelope is invalid");
  }
  if (value.schemaVersion !== 1 || typeof value.digest !== "string") {
    throw new Error("journal envelope fields are invalid");
  }
  const journal = parseJournal(value.journal);
  if (journal.planId !== planId || journal.runId !== planId) {
    throw new Error("journal identity does not match its filename");
  }
  if (value.digest !== journalDigest(journal)) {
    throw new Error("journal checksum does not match its contents");
  }
  return { schemaVersion: 1, digest: value.digest, journal };
}

async function existingFile(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new WorkflowExecutionError("Workflow journal path is not a regular file", "workflow.journalUnsafe");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertSafeDirectoryComponent(directoryPath: string): Promise<void> {
  try {
    const stats = await lstat(directoryPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new WorkflowExecutionError(
        "Workflow journal directory contains an unsafe filesystem entry",
        "workflow.journalUnsafe"
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

export class LocalWorkflowJournalStore implements WorkflowJournalStore {
  readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  private assertPlanId(planId: string): void {
    if (!PLAN_ID.test(planId)) {
      throw new WorkflowExecutionError("Workflow plan id is unsafe for journal storage", "workflow.journalPathInvalid");
    }
  }

  private async directory(): Promise<string> {
    try {
      const flowerDirectory = path.resolve(this.projectRoot, ".flower");
      const journalDirectory = path.join(flowerDirectory, "journal");
      const directory = path.join(journalDirectory, "workflows");
      for (const component of [flowerDirectory, journalDirectory, directory]) {
        await assertSafeDirectoryComponent(component);
      }
      await mkdir(directory, { recursive: true });
      const [root, resolvedDirectory] = await Promise.all([
        realpath(this.projectRoot),
        realpath(directory)
      ]);
      const relative = path.relative(root, resolvedDirectory);
      if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
        throw new WorkflowExecutionError(
          "Workflow journal directory escaped the project root through a symbolic link",
          "workflow.journalUnsafe"
        );
      }
      return resolvedDirectory;
    } catch (error) {
      if (error instanceof WorkflowExecutionError) throw error;
      throw new WorkflowExecutionError(
        `Workflow journal directory is unavailable: ${error instanceof Error ? error.message : "filesystem failure"}`,
        "workflow.journalUnsafe"
      );
    }
  }

  private async filePath(planId: string): Promise<string> {
    this.assertPlanId(planId);
    return path.join(await this.directory(), `${planId}.json`);
  }

  async load(planId: string): Promise<WorkflowRunJournal | undefined> {
    const filePath = await this.filePath(planId);
    if (!(await existingFile(filePath))) return undefined;
    try {
      const envelope = parseEnvelope(JSON.parse(await readFile(filePath, "utf8")) as unknown, planId);
      return envelope.journal;
    } catch (error) {
      if (error instanceof WorkflowExecutionError) throw error;
      throw new WorkflowExecutionError(
        `Workflow journal is corrupt: ${error instanceof Error ? error.message : "invalid data"}`,
        "workflow.journalCorrupt"
      );
    }
  }

  async save(journal: WorkflowRunJournal): Promise<void> {
    this.assertPlanId(journal.planId);
    if (journal.runId !== journal.planId) {
      throw new WorkflowExecutionError("Workflow journal identity is inconsistent", "workflow.journalCorrupt");
    }
    const filePath = await this.filePath(journal.planId);
    const lockPath = `${filePath}.lock`;
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    let handle;
    let lockHandle;
    try {
      try {
        lockHandle = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new WorkflowExecutionError(
            "Workflow journal is locked by another process or interrupted writer",
            "workflow.journalLocked"
          );
        }
        throw error;
      }

      const current = await this.load(journal.planId);
      const expectedRevision = current?.revision ?? 0;
      if (journal.revision !== expectedRevision) {
        throw new WorkflowExecutionError(
          "Workflow journal was updated by another process",
          "workflow.journalConflict"
        );
      }
      const persisted = parseJournal(structuredClone({ ...journal, revision: expectedRevision + 1 }));
      const envelope: WorkflowJournalEnvelope = {
        schemaVersion: 1,
        digest: journalDigest(persisted),
        journal: persisted
      };
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(envelope, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, filePath);
      journal.revision = persisted.revision;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (error instanceof WorkflowExecutionError) throw error;
      throw new WorkflowExecutionError(
        `Could not persist workflow journal: ${error instanceof Error ? error.message : "filesystem failure"}`,
        "workflow.journalWriteFailed"
      );
    } finally {
      await lockHandle?.close().catch(() => undefined);
      if (lockHandle) await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
}
