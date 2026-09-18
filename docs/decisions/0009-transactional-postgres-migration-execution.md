# ADR 0009: Transactional PostgreSQL Migration Execution

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-19

## Context

ADR 0008 defines immutable migration packages and deterministic plans. Applying those plans must prevent concurrent runners, detect state changes between planning and execution, and record history atomically with schema changes without embedding credentials or a particular database driver in the kernel.

## Decision

- The kernel consumes a minimal injected PostgreSQL query client. Connection lifecycle, credentials, and driver selection remain outside the migration engine.
- Read-only history discovery uses `to_regclass` and does not create schemas or tables, preserving dry-run behavior.
- Execution opens one transaction, acquires a transaction-scoped advisory lock, and creates `flower_internal.schema_migrations` when needed.
- After locking, the executor rereads history and requires an exact match with the plan's applied-history precondition.
- Every planned and already-applied migration source is rechecked against its recorded digest before a transaction is opened.
- Pending SQL and its parameterized history insert run in the same transaction. Any failure rolls back the whole plan.
- Migration SQL may not contain top-level transaction-control statements; Flower owns the transaction boundary.
- An unchanged plan still takes the lock and verifies database history before committing a no-op.
- A rollback failure is surfaced distinctly and marks recovery as incomplete.

## Consequences

- Concurrent migration attempts serialize on one database-scoped lock.
- A plan cannot apply against history that changed after the dry run.
- Successful history rows identify the module version, exact SQL digest, and plan that applied them.
- Multi-migration plans are atomic for PostgreSQL statements that support transactional execution.
- Operations that PostgreSQL forbids inside a transaction cannot be represented by this executor and require a future explicit non-transactional migration contract.
- A concrete Node PostgreSQL driver adapter and integration tests against an isolated server are still required.

## Alternatives considered

- One transaction per migration was rejected because a later failure would leave a partially applied plan.
- Creating the history table during planning was rejected because dry runs must not mutate external state.
- Optimistic history checks without an advisory lock were rejected because another runner could pass the same check concurrently.
- Allowing migration-owned commits was rejected because it breaks rollback and history atomicity.
- Binding the kernel directly to one driver was rejected because the execution state machine only needs a small query port.

## Review date

Review when the concrete driver adapter and isolated PostgreSQL test environment are introduced.
