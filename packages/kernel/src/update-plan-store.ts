import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sha256 } from "./template.js";
import { verifyUpdatePlan } from "./update-plan.js";
import type { UpdatePlan } from "./types.js";

const PLAN_ID = /^update-[a-f0-9]{16}$/;

interface UpdatePlanEnvelope {
  schemaVersion: 1;
  digest: string;
  plan: UpdatePlan;
}

export class UpdatePlanStoreError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "UpdatePlanStoreError";
    this.code = code;
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

function planDigest(plan: UpdatePlan): string {
  return sha256(JSON.stringify(canonicalValue(plan)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function parsePlan(value: unknown, requestedPlanId: string): UpdatePlan {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.command !== "update" ||
      typeof value.planId !== "string" || typeof value.digest !== "string" ||
      !["apply", "unchanged", "blocked"].includes(String(value.state)) ||
      typeof value.currentVersion !== "string" || typeof value.targetVersion !== "string" ||
      !Array.isArray(value.moduleCompatibility) || !Array.isArray(value.dependencyChanges) ||
      !Array.isArray(value.manifestMigrations) || !Array.isArray(value.moduleMigrations) ||
      !Array.isArray(value.generatedFiles) || !Array.isArray(value.databaseMigrations) ||
      !Array.isArray(value.ownershipConflicts) || !Array.isArray(value.requiredApprovals) ||
      !Array.isArray(value.verificationCommands) || !Array.isArray(value.rollbackLimitations) ||
      !isRecord(value.preconditions)) {
    throw new Error("persisted update plan fields are invalid");
  }
  const plan = structuredClone(value) as unknown as UpdatePlan;
  if (plan.planId !== requestedPlanId) throw new Error("persisted update plan identity does not match its filename");
  verifyUpdatePlan(plan);
  return plan;
}

function parseEnvelope(value: unknown, planId: string): UpdatePlanEnvelope {
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "digest", "plan"]) ||
      value.schemaVersion !== 1 || typeof value.digest !== "string") {
    throw new Error("persisted update plan envelope is invalid");
  }
  const plan = parsePlan(value.plan, planId);
  if (value.digest !== planDigest(plan)) throw new Error("persisted update plan checksum does not match its contents");
  return { schemaVersion: 1, digest: value.digest, plan };
}

async function assertDirectory(pathname: string, label: string, allowMissing: boolean): Promise<void> {
  try {
    const details = await lstat(pathname);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new UpdatePlanStoreError(`${label} is not a safe directory`, "update.planStoreUnsafe");
    }
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (error instanceof UpdatePlanStoreError) throw error;
    throw new UpdatePlanStoreError(`${label} is unavailable`, "update.planStoreUnsafe");
  }
}

async function existingFile(filePath: string): Promise<boolean> {
  try {
    const details = await lstat(filePath);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new UpdatePlanStoreError("Persisted update plan path is unsafe", "update.planStoreUnsafe");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class LocalUpdatePlanStore {
  readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  private assertPlanId(planId: string): void {
    if (!PLAN_ID.test(planId)) {
      throw new UpdatePlanStoreError("Update plan id is unsafe for local storage", "update.planIdInvalid");
    }
  }

  private async directory(): Promise<string> {
    const flower = path.join(this.projectRoot, ".flower");
    const cache = path.join(flower, "cache");
    const plans = path.join(cache, "update-plans");
    await assertDirectory(this.projectRoot, "Project root", false);
    await assertDirectory(flower, "Flower control directory", false);
    await assertDirectory(cache, "Flower cache directory", true);
    await assertDirectory(plans, "Update plan directory", true);
    try {
      await mkdir(plans, { recursive: true });
      await assertDirectory(cache, "Flower cache directory", false);
      await assertDirectory(plans, "Update plan directory", false);
      const [resolvedRoot, resolvedPlans] = await Promise.all([realpath(this.projectRoot), realpath(plans)]);
      const relation = path.relative(resolvedRoot, resolvedPlans);
      if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
        throw new UpdatePlanStoreError("Update plan directory escaped the project root", "update.planStoreUnsafe");
      }
      return resolvedPlans;
    } catch (error) {
      if (error instanceof UpdatePlanStoreError) throw error;
      throw new UpdatePlanStoreError("Update plan directory could not be created", "update.planStoreUnsafe");
    }
  }

  private async filePath(planId: string): Promise<string> {
    this.assertPlanId(planId);
    return path.join(await this.directory(), `${planId}.json`);
  }

  async load(planId: string): Promise<UpdatePlan | undefined> {
    const filePath = await this.filePath(planId);
    if (!await existingFile(filePath)) return undefined;
    try {
      return parseEnvelope(JSON.parse(await readFile(filePath, "utf8")) as unknown, planId).plan;
    } catch (error) {
      if (error instanceof UpdatePlanStoreError) throw error;
      throw new UpdatePlanStoreError(
        `Persisted update plan is corrupt: ${error instanceof Error ? error.message : "invalid data"}`,
        "update.planCorrupt"
      );
    }
  }

  async save(plan: UpdatePlan): Promise<string> {
    verifyUpdatePlan(plan);
    this.assertPlanId(plan.planId);
    const filePath = await this.filePath(plan.planId);
    const lockPath = `${filePath}.lock`;
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    let lock;
    let output;
    try {
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new UpdatePlanStoreError("Update plan is locked by another writer", "update.planLocked");
        }
        throw error;
      }
      const existing = await this.load(plan.planId);
      if (existing) {
        if (existing.digest !== plan.digest) {
          throw new UpdatePlanStoreError("A different update plan already uses this identity", "update.planConflict");
        }
        return filePath;
      }
      const envelope: UpdatePlanEnvelope = { schemaVersion: 1, digest: planDigest(plan), plan };
      output = await open(temporaryPath, "wx", 0o600);
      await output.writeFile(`${JSON.stringify(envelope, null, 2)}\n`, "utf8");
      await output.sync();
      await output.close();
      output = undefined;
      await rename(temporaryPath, filePath);
      return filePath;
    } catch (error) {
      await output?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (error instanceof UpdatePlanStoreError) throw error;
      throw new UpdatePlanStoreError(
        `Update plan could not be persisted: ${error instanceof Error ? error.message : "filesystem failure"}`,
        "update.planWriteFailed"
      );
    } finally {
      await lock?.close().catch(() => undefined);
      if (lock) await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
}
