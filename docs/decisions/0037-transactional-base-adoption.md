# ADR 0037: Transactional Base Adoption

## Status

Accepted for Phase F7.

## Context

The adoption planner binds every pre-existing project file, but a plan alone does not make an existing project Flower-managed. Applying adoption must create control metadata without changing any pre-existing project byte, must reject stale plans, and must leave either a complete verified result or no new Flower state.

## Decision

- `flower adopt <existing-project>` applies base adoption. `--inspect` remains read-only and `--dry-run` emits the plan without writes.
- The plan carries the detected stack and the digest of every exact metadata document it will create. `.flower/adoption.json` records the immutable original adoption inputs needed for idempotency.
- Application verifies plan identity, rejects blocked plans and changed project classifications, validates project and ownership manifests, and creates `.flower` only when no control path exists.
- A started journal is written before metadata, every metadata write is digest-verified, and a completed journal is written before success is returned.
- Any ordinary failure removes the complete `.flower` tree created by the transaction. Incomplete rollback is reported with the partial exit contract and a best-effort recovery journal.
- Reapplying the same adoption returns unchanged. The adoption record remains immutable, while `project.json`, `ownership.json`, and `lock.json` may evolve through later verified Flower operations.
- Selected modules and adapters are deliberately rejected during application in this slice. Their dry-run selection is retained for the next composed transaction, which must bind verified module packages and adapter output before writes.

## Consequences

- Existing application source remains byte-for-byte project-owned through successful application and rollback tests.
- A process interrupted after transaction start leaves a started journal for recovery inspection.
- Existing initialized Flower projects cannot be mistaken for adopted projects because idempotency requires a valid adoption record.
- The CLI now uses explicit `--inspect` when a user wants observation without application.

## Rejected alternatives

- Writing metadata without rechecking project bytes was rejected because a reviewed plan could become stale before application.
- Treating all existing `.flower` directories as idempotent adoption was rejected because initialized, partial, and unrelated control state are materially different.
- Permanently hashing mutable project and lock manifests in the adoption record was rejected because legitimate later module and framework updates must not break adoption identity.
- Composing unbound module packages into this transaction was rejected because the merged planning contract does not yet record their verified versions, package digests, and generated outputs.

## Review trigger

Review when selected modules and adapters are composed into adoption, when crash recovery gains an automatic resume command, or when another package manager is supported.
