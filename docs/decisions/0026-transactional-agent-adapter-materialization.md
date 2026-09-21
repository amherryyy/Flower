# ADR 0026: Transactional Agent Adapter Materialization

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-21

## Context

ADR 0025 defines deterministic Codex and Claude adapter bundles and checksummed state, but deliberately leaves filesystem mutation to a later transaction. Materialization must support a trustworthy dry run, regenerate stale views, remove disabled adapters, preserve manual work, resist stale plans and unsafe paths, and recover from partial failure.

## Decision

- Materialization first creates a deterministic, digest-protected plan. The plan contains only create, replace, and remove actions with before and after digests; planning performs no writes.
- The generated state file is provenance. A tracked artifact may be replaced or removed only when its current digest still matches the recorded output digest. A byte-identical current target can be retained while state is repaired.
- A pre-existing target without provenance is never overwritten unless it already equals the expected generated output. A tracked artifact with any other digest is treated as manually modified and blocks the operation.
- Disabling an adapter removes its file only while that file remains pristine. A missing disabled artifact simply disappears from the next state.
- Bundle contents, embedded state, state schema, generator versions, paths, output digests, and unsupported capabilities are verified before planning or applying. Unsupported capabilities block materialization.
- Application verifies the plan digest, bundle digest, and a newly computed plan immediately before mutation. Existing files and parents must be regular non-symbolic-link paths contained by the real project root.
- Artifact mutations run in deterministic path order and the state file is written last. Each write uses a same-directory temporary file and rename; every completed mutation has an in-memory pre-operation snapshot.
- Any mutation, verification, hook, or completion-journal failure restores completed actions in reverse order and removes newly created empty directories. Incomplete recovery emits a partial local journal when possible and returns an explicit recovery error.

## Consequences

- Dry-run output is stable and useful for review without changing the project.
- Re-running an already materialized bundle is a verified no-op.
- Legitimate canonical changes replace pristine generated views, while manual edits and untracked collisions fail closed.
- State cannot claim success before all adapter files have been verified.
- The transaction holds small generated files in memory for rollback; this is appropriate for instruction views but not a generic large-artifact transaction engine.

## Alternatives considered

- Blindly rewriting generated paths was rejected because `replace-if-unmodified` requires provenance and drift protection.
- Writing state before adapter files was rejected because interruption could record outputs that were never installed.
- Treating disabled adapters as permanent files was rejected because stale agent instructions can contradict current project configuration.
- Reusing the module lock was rejected because adapter generation has separate inputs, lifecycle, and drift semantics.

## Review date

Review when adapter materialization is exposed through the CLI, adapters become large binary artifacts, or cross-process locking is added.
