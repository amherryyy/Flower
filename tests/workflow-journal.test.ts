import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalWorkflowJournalStore,
  createWorkflowPlan,
  executeWorkflow,
  type OwnershipManifest,
  type WorkflowActionHandler,
  type WorkflowDefinition,
  type WorkflowExecutionError
} from "../packages/kernel/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flower-workflow-journal-"));
  temporaryDirectories.push(root);
  return root;
}

async function schema(): Promise<object> {
  return JSON.parse(await readFile(new URL("../schemas/workflow/v1.json", import.meta.url), "utf8")) as object;
}

function workflow(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    id: "journal-test",
    version: 1,
    description: "Exercise durable workflow resumption",
    inputs: [{ id: "summary", type: "string", required: true }],
    steps: [
      { id: "preflight", action: "project.validate", reads: [".flower/**"], writes: [], externalEffects: [] },
      { id: "approve", action: "approval.require", reads: [], writes: [], externalEffects: [] },
      {
        id: "implement",
        action: "agent.delegate",
        reads: ["src/**"],
        writes: ["src/**"],
        externalEffects: ["agent.invoke"],
        ownership: { allow: ["project"] }
      }
    ]
  };
}

const ownership: OwnershipManifest = {
  version: 1,
  rules: [{ pattern: "src/**", owner: "project", policy: "never-overwrite" }]
};

describe("local workflow journal store", () => {
  it("persists an approval pause atomically and resumes without storing inputs or replaying work", async () => {
    const root = await projectRoot();
    const definition = workflow();
    const inputs = { summary: "private customer prompt must not be journaled" };
    const plan = createWorkflowPlan(await schema(), definition, inputs, ["project.validate", "agent.delegate"]);
    const calls: string[] = [];
    const handlers = new Map<string, WorkflowActionHandler>([
      ["project.validate", async ({ step }) => { calls.push(step.id); return { writes: [], externalEffects: [] }; }],
      ["agent.delegate", async ({ step }) => {
        calls.push(step.id);
        return { writes: ["src/feature.ts"], externalEffects: ["agent.invoke"] };
      }]
    ]);

    const waiting = await executeWorkflow(
      plan,
      definition,
      inputs,
      handlers,
      new LocalWorkflowJournalStore(root)
    );
    expect(waiting).toMatchObject({ status: "awaiting-approval", nextStepIndex: 1 });

    const journalDirectory = path.join(root, ".flower", "journal", "workflows");
    const journalPath = path.join(journalDirectory, `${plan.planId}.json`);
    const stored = await readFile(journalPath, "utf8");
    expect(stored).not.toContain(inputs.summary);
    expect((await readdir(journalDirectory)).filter((name) => name.endsWith(".tmp") || name.endsWith(".lock"))).toEqual([]);

    const completed = await executeWorkflow(
      plan,
      definition,
      inputs,
      handlers,
      new LocalWorkflowJournalStore(root),
      { approvals: ["approve"], ownership }
    );
    expect(completed.status).toBe("completed");
    expect(completed.revision).toBeGreaterThan(waiting.revision);
    expect(calls).toEqual(["preflight", "implement"]);
  });

  it("detects checksum corruption and unsafe journal identifiers", async () => {
    const root = await projectRoot();
    const definition = workflow();
    const inputs = { summary: "safe" };
    const plan = createWorkflowPlan(await schema(), definition, inputs, ["project.validate", "agent.delegate"]);
    const store = new LocalWorkflowJournalStore(root);
    await executeWorkflow(
      plan,
      definition,
      inputs,
      new Map([["project.validate", async () => ({ writes: [], externalEffects: [] })]]),
      store
    );

    const journalPath = path.join(root, ".flower", "journal", "workflows", `${plan.planId}.json`);
    const document = JSON.parse(await readFile(journalPath, "utf8")) as { journal: { nextStepIndex: number } };
    document.journal.nextStepIndex = 99;
    await writeFile(journalPath, `${JSON.stringify(document, null, 2)}\n`);

    await expect(store.load(plan.planId)).rejects.toMatchObject<Partial<WorkflowExecutionError>>({
      code: "workflow.journalCorrupt"
    });
    await expect(store.load("../escape")).rejects.toMatchObject<Partial<WorkflowExecutionError>>({
      code: "workflow.journalPathInvalid"
    });
  });

  it("rejects a stale writer instead of overwriting newer progress", async () => {
    const root = await projectRoot();
    const definition = workflow();
    const inputs = { summary: "safe" };
    const plan = createWorkflowPlan(await schema(), definition, inputs, ["project.validate", "agent.delegate"]);
    const store = new LocalWorkflowJournalStore(root);
    await executeWorkflow(
      plan,
      definition,
      inputs,
      new Map([["project.validate", async () => ({ writes: [], externalEffects: [] })]]),
      store
    );

    const first = await store.load(plan.planId);
    const stale = await store.load(plan.planId);
    expect(first).toBeDefined();
    expect(stale).toBeDefined();
    await store.save(first!);
    await expect(store.save(stale!)).rejects.toMatchObject<Partial<WorkflowExecutionError>>({
      code: "workflow.journalConflict"
    });
  });

  it("rejects child-directory symlinks before creating journal paths", async () => {
    const root = await projectRoot();
    const outside = await projectRoot();
    await symlink(outside, path.join(root, ".flower"), process.platform === "win32" ? "junction" : "dir");

    await expect(
      new LocalWorkflowJournalStore(root).load("workflow-aaaaaaaaaaaa")
    ).rejects.toMatchObject<Partial<WorkflowExecutionError>>({ code: "workflow.journalUnsafe" });
    expect(await readdir(outside)).toEqual([]);
  });
});
