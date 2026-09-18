# ADR 0008: Migration Registry and Deterministic Planning

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-18

## Context

F4 needs database migrations that can be inspected, ordered, and verified before any database connection is opened. Module manifests already declare migration ids, but F3 intentionally did not assign those ids to files or define applied-history behavior.

## Decision

- A declared migration id maps to `migrations/<id>.sql` within its module package.
- Declared SQL must exist and be non-empty. SQL files not declared by the manifest are rejected.
- Migration source digests participate in the module package digest and are rechecked by module lifecycle application.
- Migration ids are globally unique within a catalog.
- The planner orders modules through the existing dependency resolver, then preserves each manifest's migration order.
- Applied history records the migration id, module id, module version, and source digest. It must be an exact prefix of the computed plan.
- Unknown, duplicate, reordered, or digest/version-drifted history is a blocking error.
- Plans are deterministic and digest-protected. With a complete history, planning is a verified no-op.
- This slice does not connect to or mutate a database.

## Consequences

- SQL changes alter the owning module package identity and cannot silently reuse an applied migration id.
- Partial migration progress can be resumed only when recorded history still matches verified package content.
- Dependency migrations always precede dependent-module migrations.
- A future database adapter can consume the plan without redefining ordering or drift semantics.
- Module removal with applied migrations, database transaction boundaries, rollback strategy, locking, and repair remain explicit follow-up decisions.

## Alternatives considered

- Filename discovery without manifest declarations was rejected because ordering and package intent would be implicit.
- Treating any known applied set as valid was rejected because gaps and reordered history can hide partially configured schemas.
- Recording only migration ids was rejected because edited SQL would be indistinguishable from the applied source.
- Executing SQL in the initial planner slice was rejected because connection, locking, transaction, and failure-journal contracts need separate tests and decisions.

## Review date

Review when the first Postgres execution adapter and official module migrations are introduced.
