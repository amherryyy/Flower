# ADR 0023: Typed Workflow Engine and Approval Boundary

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-20

## Context

Phase F5 needs one canonical workflow definition to drive human, CI, and AI-tool adapters without moving safety policy into generated prompts or tool-specific configuration. Workflows must be deterministic, resumable, explicit about effects, and unable to skip required approval.

## Decision

- Workflow definitions use the strict versioned `schemas/workflow/v1.json` schema. Inputs have explicit primitive types, and every step declares reads, writes, external effects, and optional ownership or check limits.
- Planning validates the schema, rejects duplicate inputs or steps and unregistered actions, validates input values, and binds the definition, inputs, and ordered steps into a deterministic digest-protected plan.
- `approval.require` is an engine action, not an adapter handler. Execution stops with `awaiting-approval` until the exact step ID is approved; adapters cannot replace or omit the gate without invalidating the plan digest.
- Action handlers return their actual writes and external effects. The engine rejects paths or effect identifiers that the step did not declare. Delegated-agent writes additionally require a real ownership manifest and must resolve to one of the step's allowed ownership classes.
- A journal store is an injected port. The engine persists progress before execution and after each step, resumes at the first incomplete step, rejects journal drift, and does not persist raw inputs or handler output.
- Agent delegation requires an explicit ownership allowlist and fails closed when execution has no ownership manifest. Adapter generation remains a subsequent F5 slice.

## Consequences

- Canonical workflows and their input bindings are reproducible across adapters.
- Completed steps are not replayed after an approval pause or recoverable action failure.
- The engine can enforce declared output boundaries but cannot observe undeclared reads inside a handler; handlers remain trusted ports and adapters must preserve the supplied scope.
- Journal implementations can be local or hosted without changing execution semantics, provided they preserve the journal contract.

## Alternatives considered

- Free-form prompt workflows were rejected because they cannot be schema validated or compared across adapters.
- Adapter-owned approval prompts were rejected because an adapter could omit or reinterpret them.
- Persisting handler results was rejected because arbitrary output can contain secrets, prompts, command output, or private project data.
- Automatically replaying the full workflow after failure was rejected because completed external effects may not be idempotent.

## Review date

Review when the first Codex, Claude, or CI adapter is introduced. ADR 0024 supplies the local journal adapter.
