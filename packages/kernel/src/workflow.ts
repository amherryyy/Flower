import type {
  Diagnostic,
  ValidationResult,
  WorkflowActionHandler,
  WorkflowDefinition,
  WorkflowJournalStore,
  WorkflowPlan,
  WorkflowRunJournal,
  WorkflowRunOptions,
  WorkflowStepDefinition,
  WorkflowStepReport
} from "./types.js";
import { classifyPath, matchesProjectPattern } from "./ownership.js";
import { sha256 } from "./template.js";
import { combineValidationResults, validateDocument } from "./validation.js";

const APPROVAL_ACTION = "approval.require";

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

function digest(value: unknown): string {
  return sha256(JSON.stringify(canonicalValue(value)));
}

function stableDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message)
  );
}

function semanticWorkflowValidation(
  workflow: WorkflowDefinition,
  allowedActions: ReadonlySet<string>
): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  const inputIds = new Set<string>();
  const stepIds = new Set<string>();

  workflow.inputs.forEach((input, index) => {
    if (inputIds.has(input.id)) {
      diagnostics.push({
        code: "workflow.duplicateInput",
        path: `/inputs/${index}/id`,
        message: `Workflow input '${input.id}' is duplicated`,
        severity: "error"
      });
    }
    inputIds.add(input.id);
  });

  workflow.steps.forEach((step, index) => {
    if (stepIds.has(step.id)) {
      diagnostics.push({
        code: "workflow.duplicateStep",
        path: `/steps/${index}/id`,
        message: `Workflow step '${step.id}' is duplicated`,
        severity: "error"
      });
    }
    stepIds.add(step.id);

    if (step.action !== APPROVAL_ACTION && !allowedActions.has(step.action)) {
      diagnostics.push({
        code: "workflow.unknownAction",
        path: `/steps/${index}/action`,
        message: `Workflow action '${step.action}' is not registered`,
        severity: "error"
      });
    }

    if (step.action === APPROVAL_ACTION && (step.writes.length > 0 || step.externalEffects.length > 0)) {
      diagnostics.push({
        code: "workflow.approvalHasEffects",
        path: `/steps/${index}`,
        message: "Approval steps cannot declare writes or external effects",
        severity: "error"
      });
    }

    if (step.action === "agent.delegate" && !step.ownership?.allow.length) {
      diagnostics.push({
        code: "workflow.agentOwnershipMissing",
        path: `/steps/${index}/ownership`,
        message: "Agent delegation steps must declare allowed ownership classes",
        severity: "error"
      });
    }
  });

  return {
    valid: diagnostics.length === 0,
    diagnostics: stableDiagnostics(diagnostics)
  };
}

export function validateWorkflowDefinition(
  schema: object,
  document: unknown,
  allowedActions: Iterable<string>
): ValidationResult {
  const schemaResult = validateDocument(schema, document, "workflow");
  if (!schemaResult.valid) return schemaResult;
  const actions = new Set(allowedActions);
  return combineValidationResults(
    schemaResult,
    semanticWorkflowValidation(document as WorkflowDefinition, actions)
  );
}

function validateInputs(
  workflow: WorkflowDefinition,
  inputs: Record<string, unknown>
): Record<string, string | number | boolean> {
  const definitions = new Map(workflow.inputs.map((input) => [input.id, input]));
  for (const key of Object.keys(inputs)) {
    if (!definitions.has(key)) {
      throw new WorkflowDefinitionError(`Unknown workflow input '${key}'`, "workflow.inputUnknown");
    }
  }

  const validated: Record<string, string | number | boolean> = {};
  for (const definition of workflow.inputs) {
    const value = inputs[definition.id];
    if (value === undefined) {
      if (definition.required) {
        throw new WorkflowDefinitionError(
          `Required workflow input '${definition.id}' is missing`,
          "workflow.inputRequired"
        );
      }
      continue;
    }
    if (typeof value !== definition.type || (typeof value === "number" && !Number.isFinite(value))) {
      throw new WorkflowDefinitionError(
        `Workflow input '${definition.id}' must be a ${definition.type}`,
        "workflow.inputType"
      );
    }
    validated[definition.id] = value as string | number | boolean;
  }
  return validated;
}

function cloneStep(step: WorkflowStepDefinition): WorkflowStepDefinition {
  return {
    id: step.id,
    action: step.action,
    reads: [...step.reads],
    writes: [...step.writes],
    externalEffects: [...step.externalEffects],
    ...(step.ownership ? { ownership: { allow: [...step.ownership.allow] } } : {}),
    ...(step.checks ? { checks: [...step.checks] } : {})
  };
}

function planPayload(plan: Omit<WorkflowPlan, "digest" | "planId">): unknown {
  return plan;
}

export class WorkflowDefinitionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly diagnostics: Diagnostic[] = []
  ) {
    super(message);
    this.name = "WorkflowDefinitionError";
  }
}

export class WorkflowExecutionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "WorkflowExecutionError";
  }
}

export function createWorkflowPlan(
  schema: object,
  document: unknown,
  inputs: Record<string, unknown>,
  allowedActions: Iterable<string>
): WorkflowPlan {
  const actions = [...allowedActions];
  const validation = validateWorkflowDefinition(schema, document, actions);
  if (!validation.valid) {
    throw new WorkflowDefinitionError(
      `Workflow definition is invalid: ${validation.diagnostics.map((item) => `${item.path} ${item.message}`).join("; ")}`,
      "workflow.invalid",
      validation.diagnostics
    );
  }

  const workflow = document as WorkflowDefinition;
  const validatedInputs = validateInputs(workflow, inputs);
  const payload: Omit<WorkflowPlan, "digest" | "planId"> = {
    schemaVersion: 1,
    command: "workflow",
    workflow: {
      id: workflow.id,
      version: workflow.version,
      digest: digest(workflow)
    },
    inputDigest: digest(validatedInputs),
    steps: workflow.steps.map(cloneStep)
  };
  const planDigest = digest(planPayload(payload));
  return {
    ...payload,
    planId: `workflow-${planDigest.slice("sha256:".length, "sha256:".length + 12)}`,
    digest: planDigest
  };
}

export function verifyWorkflowPlan(plan: WorkflowPlan): void {
  const { digest: declaredDigest, planId, ...payload } = plan;
  const actualDigest = digest(planPayload(payload));
  const actualPlanId = `workflow-${actualDigest.slice("sha256:".length, "sha256:".length + 12)}`;
  if (declaredDigest !== actualDigest || planId !== actualPlanId) {
    throw new WorkflowDefinitionError("Workflow plan digest does not match its contents", "workflow.planDrift");
  }
}

function initialJournal(plan: WorkflowPlan): WorkflowRunJournal {
  return {
    schemaVersion: 1,
    revision: 0,
    runId: plan.planId,
    planId: plan.planId,
    planDigest: plan.digest,
    workflowId: plan.workflow.id,
    status: "running",
    nextStepIndex: 0,
    steps: plan.steps.map((step) => ({ id: step.id, action: step.action, status: "pending" }))
  };
}

function verifyJournal(journal: WorkflowRunJournal, plan: WorkflowPlan): void {
  const matches =
    journal.schemaVersion === 1 &&
    Number.isInteger(journal.revision) &&
    journal.revision >= 0 &&
    journal.planId === plan.planId &&
    journal.planDigest === plan.digest &&
    journal.workflowId === plan.workflow.id &&
    journal.nextStepIndex >= 0 &&
    journal.nextStepIndex <= plan.steps.length &&
    journal.steps.length === plan.steps.length &&
    journal.steps.every((step, index) => {
      const planned = plan.steps[index];
      const positionValid =
        index < journal.nextStepIndex
          ? step.status === "completed"
          : index === journal.nextStepIndex && journal.nextStepIndex < plan.steps.length
            ? step.status !== "completed"
            : step.status === "pending";
      return planned?.id === step.id && planned.action === step.action && positionValid;
    }) &&
    (journal.status !== "completed" || journal.nextStepIndex === plan.steps.length) &&
    (journal.status !== "awaiting-approval" || journal.steps[journal.nextStepIndex]?.status === "awaiting-approval") &&
    (journal.status !== "failed" || journal.steps[journal.nextStepIndex]?.status === "failed");
  if (!matches) {
    throw new WorkflowExecutionError("Workflow journal does not match the verified plan", "workflow.journalDrift");
  }
}

function validateReport(
  step: WorkflowStepDefinition,
  report: WorkflowStepReport,
  options: WorkflowRunOptions
): void {
  if (!Array.isArray(report.writes) || !Array.isArray(report.externalEffects)) {
    throw new WorkflowExecutionError("Workflow action returned an invalid effect report", "workflow.reportInvalid");
  }
  for (const writtenPath of report.writes) {
    let allowed = false;
    try {
      allowed = step.writes.some((pattern) => matchesProjectPattern(pattern, writtenPath));
    } catch {
      allowed = false;
    }
    if (!allowed) {
      throw new WorkflowExecutionError(
        `Workflow step '${step.id}' wrote undeclared path '${writtenPath}'`,
        "workflow.writeDenied"
      );
    }
    if (step.ownership) {
      if (!options.ownership) {
        throw new WorkflowExecutionError(
          `Workflow step '${step.id}' requires an ownership manifest`,
          "workflow.ownershipUnavailable"
        );
      }
      const classification = classifyPath(options.ownership, writtenPath);
      if (
        classification.conflict ||
        !classification.rule ||
        !step.ownership.allow.includes(classification.rule.owner)
      ) {
        throw new WorkflowExecutionError(
          `Workflow step '${step.id}' cannot write '${writtenPath}' under the declared ownership scope`,
          "workflow.ownershipDenied"
        );
      }
    }
  }
  for (const effect of report.externalEffects) {
    if (!step.externalEffects.includes(effect)) {
      throw new WorkflowExecutionError(
        `Workflow step '${step.id}' performed undeclared external effect '${effect}'`,
        "workflow.externalEffectDenied"
      );
    }
  }
}

export async function executeWorkflow(
  plan: WorkflowPlan,
  workflow: WorkflowDefinition,
  inputs: Record<string, unknown>,
  handlers: ReadonlyMap<string, WorkflowActionHandler>,
  journalStore: WorkflowJournalStore,
  options: WorkflowRunOptions = {}
): Promise<WorkflowRunJournal> {
  verifyWorkflowPlan(plan);
  if (digest(workflow) !== plan.workflow.digest) {
    throw new WorkflowExecutionError("Workflow definition changed after planning", "workflow.definitionDrift");
  }
  if (
    workflow.id !== plan.workflow.id ||
    workflow.version !== plan.workflow.version ||
    digest(workflow.steps.map(cloneStep)) !== digest(plan.steps)
  ) {
    throw new WorkflowExecutionError("Workflow plan is not bound to the supplied definition", "workflow.planDrift");
  }
  const validatedInputs = validateInputs(workflow, inputs);
  if (digest(validatedInputs) !== plan.inputDigest) {
    throw new WorkflowExecutionError("Workflow inputs changed after planning", "workflow.inputDrift");
  }

  const stored = await journalStore.load(plan.planId);
  const journal = stored ?? initialJournal(plan);
  verifyJournal(journal, plan);
  if (journal.status === "completed") return journal;

  journal.status = "running";
  delete journal.errorCode;
  const currentJournalStep = journal.steps[journal.nextStepIndex];
  if (currentJournalStep && currentJournalStep.status !== "completed") {
    currentJournalStep.status = "pending";
  }
  await journalStore.save(journal);

  const approvals = new Set(options.approvals ?? []);
  while (journal.nextStepIndex < plan.steps.length) {
    const index = journal.nextStepIndex;
    const step = plan.steps[index]!;
    const journalStep = journal.steps[index]!;

    if (step.action === APPROVAL_ACTION) {
      if (!approvals.has(step.id)) {
        journalStep.status = "awaiting-approval";
        journal.status = "awaiting-approval";
        await journalStore.save(journal);
        return journal;
      }
      journalStep.status = "completed";
      journal.nextStepIndex += 1;
      await journalStore.save(journal);
      continue;
    }

    try {
      const handler = handlers.get(step.action);
      if (!handler) {
        throw new WorkflowExecutionError(
          `No handler is registered for workflow action '${step.action}'`,
          "workflow.handlerMissing"
        );
      }
      const report = await handler({
        inputs: Object.freeze({ ...validatedInputs }),
        step: Object.freeze(cloneStep(step)),
        completedSteps: Object.freeze(
          journal.steps.filter((item) => item.status === "completed").map((item) => item.id)
        )
      });
      validateReport(step, report, options);
      journalStep.status = "completed";
      journal.nextStepIndex += 1;
      await journalStore.save(journal);
    } catch (error) {
      const executionError =
        error instanceof WorkflowExecutionError
          ? error
          : new WorkflowExecutionError(
              error instanceof Error ? error.message : "Workflow action failed",
              "workflow.actionFailed"
            );
      journalStep.status = "failed";
      journal.status = "failed";
      journal.errorCode = executionError.code;
      await journalStore.save(journal);
      throw executionError;
    }
  }

  journal.status = "completed";
  await journalStore.save(journal);
  return journal;
}
