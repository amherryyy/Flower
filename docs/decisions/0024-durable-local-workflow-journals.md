# ADR 0024: Durable Local Workflow Journals

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-20

## Context

The typed workflow engine can pause for approval and resume failed steps through an injected journal port. Phase F5 now needs a concrete cross-platform store that survives process exit without exposing workflow inputs, replaying completed effects, following unsafe links, or silently losing progress when multiple processes target the same plan.

## Decision

- Local workflow state lives at `.flower/journal/workflows/<plan-id>.json`, separate from immutable command-history entries.
- Each file is a strict envelope containing only the workflow state contract and its SHA-256 checksum. Unknown fields, malformed step records, filename/identity mismatches, and checksum mismatches fail closed as corruption.
- Saves increment an optimistic revision. A stale revision is rejected instead of overwriting newer progress.
- Saves acquire an exclusive per-plan lock file, write a unique same-directory temporary file with owner-only permissions where supported, flush it, and atomically rename it over the journal. An existing or crash-stale lock fails closed and requires explicit recovery.
- The store resolves and checks the real journal directory beneath the real project root. Existing journal paths must be regular files rather than symbolic links.
- Raw workflow inputs, action return values, prompts, command output, and secrets are absent from the journal schema. The plan stores only the input digest.

## Consequences

- A new Flower process can resume the exact verified plan at its first incomplete step.
- Corrupt, stale, concurrent, and path-escaping state is distinguishable through stable workflow error codes.
- A process crash may leave an orphan temporary or lock file. Temporary files are ignored; a stale lock deliberately blocks writes until an operator verifies that no writer is active and removes it.
- The checksum detects accidental corruption but is not cryptographic tamper evidence against a user who can rewrite both the journal and checksum.

## Alternatives considered

- Reusing timestamped command-history records was rejected because resumable state needs one authoritative current revision.
- In-place writes were rejected because interruption can leave truncated JSON.
- Last-writer-wins saves were rejected because they can replay or erase externally visible step progress.
- Persisting the full execution context was rejected because it could retain secrets, prompts, or private action output.

## Review date

Review when workflow rollback, distributed journal storage, or automatic stale-lock recovery is introduced.
