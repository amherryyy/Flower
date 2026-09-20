import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  WorkflowDefinitionError,
  WorkflowExecutionError,
  createWorkflowPlan,
  executeWorkflow,
  validateWorkflowDefinition,
  verifyWorkflowPlan,
  type WorkflowActionHandler,
  type WorkflowDefinition,
  type WorkflowJournalStore,
  type OwnershipManifest,
  type WorkflowRunJournal
} from "../packages/kernel/src/index.js";

async function workflowSchema(): Promise<object> {
  return JSON.parse(
    await readFile(new URL("../schemas/workflow/v1.json", import.meta.url), "utf8")
  ) as object;
}

function featureWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    id: "feature",
    version: 1,
    description: "Plan, approve, implement, and verify one feature",
    inputs: [
      { id: "taskId", type: "string", required: true },
      { id: "summary", type: "string", required: true }
    ],
    steps: [
      {
        id: "preflight",
        action: "project.validate",
        reads: [".flower/**"],
        writes: [],
        externalEffects: []
      },
      {
        id: "approve",
        action: "approval.require",
        reads: [],
        writes: [],
        externalEffects: []
      },
      {
        id: "implement",
        action: "agent.delegate",
        reads: ["**"],
        writes: ["src/**", "tests/**"],
        externalEffects: ["agent.invoke"],
        ownership: { allow: ["project"] }
      },
      {
        id: "verify",
        action: "checks.run",
        reads: ["**"],
        writes: [],
        externalEffects: ["process.execute"],
        checks: ["tests", "typecheck", "security"]
      }
    ]
  };
}

const actionIds = ["project.validate", "agent.delegate", "checks.run"];
const inputs = { taskId: "FLOWER-42", summary: "Typed workflows" };
const ownership: OwnershipManifest = {
  version: 1,
  rules: [
    { pattern: "src/**", owner: "project", policy: "never-overwrite" },
    { pattern: "tests/**", owner: "project", policy: "never-overwrite" },
    { pattern: ".flower/**", owner: "protected", policy: "never-overwrite" }
  ]
};

class MemoryJournalStore implements WorkflowJournalStore {
  journal?: WorkflowRunJournal;
  saves: WorkflowRunJournal[] = [];

  async load(): Promise<WorkflowRunJournal | undefined> {
    return this.journal ? structuredClone(this.journal) : undefined;
  }

  async save(journal: WorkflowRunJournal): Promise<void> {
    this.journal = structuredClone(journal);
    this.saves.push(structuredClone(journal));
  }
}

function report(writes: string[] = [], externalEffects: string[] = []): WorkflowActionHandler {
  return async () => ({ writes, externalEffects });
}

describe("F5 typed workflow engine", () => {
  it("validates workflow semantics and rejects adapter-unsafe definitions", async () => {
    const schema = await workflowSchema();
    const canonical = JSON.parse(
      await readFile(new URL("../workflows/feature.json", import.meta.url), "utf8")
    ) as unknown;
    expect(validateWorkflowDefinition(
      schema,
      canonical,
      ["project.validate", "feature.plan", "agent.delegate", "checks.run", "verification.write"]
    )).toEqual({ valid: true, diagnostics: [] });
    expect(validateWorkflowDefinition(schema, featureWorkflow(), actionIds)).toEqual({
      valid: true,
      diagnostics: []
    });

    const invalid = featureWorkflow();
    invalid.inputs.push({ id: "taskId", type: "string", required: false });
    invalid.steps[0]!.action = "unknown.execute";
    invalid.steps[1]!.writes = ["approval.txt"];
    delete invalid.steps[2]!.ownership;
    const result = validateWorkflowDefinition(schema, invalid, actionIds);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "workflow.duplicateInput",
      "workflow.unknownAction",
      "workflow.approvalHasEffects",
      "workflow.agentOwnershipMissing"
    ]);
  });

  it("creates deterministic, tamper-evident plans from typed inputs", async () => {
    const schema = await workflowSchema();
    const first = createWorkflowPlan(schema, featureWorkflow(), inputs, actionIds);
    const second = createWorkflowPlan(
      schema,
      featureWorkflow(),
      { summary: inputs.summary, taskId: inputs.taskId },
      actionIds
    );

    expect(first).toEqual(second);
    expect(first.planId).toMatch(/^workflow-[a-f0-9]{12}$/);
    expect(() => verifyWorkflowPlan(first)).not.toThrow();
    expect(() => verifyWorkflowPlan({ ...first, steps: first.steps.slice(1) })).toThrow(
      /digest does not match/
    );
    expect(() => createWorkflowPlan(schema, featureWorkflow(), { taskId: "FLOWER-42" }, actionIds))
      .toThrowError(expect.objectContaining<Partial<WorkflowDefinitionError>>({ code: "workflow.inputRequired" }));
  });

  it("stops at approval and resumes the exact verified plan after approval", async () => {
    const schema = await workflowSchema();
    const workflow = featureWorkflow();
    const plan = createWorkflowPlan(schema, workflow, inputs, actionIds);
    const store = new MemoryJournalStore();
    const calls: string[] = [];
    const handlers = new Map<string, WorkflowActionHandler>([
      ["project.validate", async ({ step }) => { calls.push(step.id); return { writes: [], externalEffects: [] }; }],
      ["agent.delegate", async ({ step, completedSteps }) => {
        calls.push(`${step.id}:${completedSteps.join(",")}`);
        return { writes: ["src/feature.ts", "tests/feature.test.ts"], externalEffects: ["agent.invoke"] };
      }],
      ["checks.run", async ({ step }) => { calls.push(step.id); return { writes: [], externalEffects: ["process.execute"] }; }]
    ]);

    const waiting = await executeWorkflow(plan, workflow, inputs, handlers, store);
    expect(waiting.status).toBe("awaiting-approval");
    expect(waiting.nextStepIndex).toBe(1);
    expect(calls).toEqual(["preflight"]);

    const completed = await executeWorkflow(plan, workflow, inputs, handlers, store, {
      approvals: ["approve"],
      ownership
    });
    expect(completed.status).toBe("completed");
    expect(completed.nextStepIndex).toBe(4);
    expect(completed.steps.map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed"
    ]);
    expect(calls).toEqual(["preflight", "implement:preflight,approve", "verify"]);
  });

  it("requires ownership scope and resumes a failed step without replaying completed work", async () => {
    const schema = await workflowSchema();
    const workflow = featureWorkflow();
    const plan = createWorkflowPlan(schema, workflow, inputs, actionIds);
    const store = new MemoryJournalStore();
    let preflightCalls = 0;
    let implementationCalls = 0;
    const handlers = new Map<string, WorkflowActionHandler>([
      ["project.validate", async () => { preflightCalls += 1; return { writes: [], externalEffects: [] }; }],
      ["agent.delegate", async () => {
        implementationCalls += 1;
        return { writes: ["src/feature.ts"], externalEffects: ["agent.invoke"] };
      }],
      ["checks.run", report([], ["process.execute"])]
    ]);

    await expect(
      executeWorkflow(plan, workflow, inputs, handlers, store, { approvals: ["approve"] })
    ).rejects.toMatchObject<Partial<WorkflowExecutionError>>({ code: "workflow.ownershipUnavailable" });
    expect(store.journal).toMatchObject({
      status: "failed",
      nextStepIndex: 2,
      errorCode: "workflow.ownershipUnavailable"
    });

    const resumed = await executeWorkflow(plan, workflow, inputs, handlers, store, {
      approvals: ["approve"],
      ownership
    });
    expect(resumed.status).toBe("completed");
    expect(preflightCalls).toBe(1);
    expect(implementationCalls).toBe(2);
  });

  it("rejects writes and external effects outside the declared step boundary", async () => {
    const schema = await workflowSchema();
    const workflow = featureWorkflow();
    const plan = createWorkflowPlan(schema, workflow, inputs, actionIds);
    const handlers = new Map<string, WorkflowActionHandler>([
      ["project.validate", report()],
      ["agent.delegate", report([".flower/project.json"], ["agent.invoke"])],
      ["checks.run", report([], ["process.execute"])]
    ]);

    await expect(executeWorkflow(
      plan,
      workflow,
      inputs,
      handlers,
      new MemoryJournalStore(),
      { approvals: ["approve"], ownership }
    )).rejects.toMatchObject<Partial<WorkflowExecutionError>>({ code: "workflow.writeDenied" });
  });
});
