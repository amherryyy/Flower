# ADR 0011: Migration Descriptors, Verification, and RLS Inspection

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-19

## Context

SQL checksums and transaction execution establish immutability and atomicity, but they do not describe provider compatibility, destructive risk, dependencies, rollback guidance, postconditions, or RLS intent. Flower must not record a migration as successful until its declared postconditions have actually passed.

## Decision

- Every declared migration requires a versioned `migrations/<id>.json` descriptor validated by `schemas/migration/v1.json`.
- A descriptor records its PostgreSQL provider, required transactional execution, destructive classification, migration dependencies, verification queries, rollback guidance, and RLS expectations.
- SQL and descriptor digests both participate in module package identity and lifecycle precondition checks.
- Migration dependencies must exist and precede the dependent migration in the deterministic plan.
- Destructive migrations require explicit approval by migration id before any transaction begins.
- Each verification query runs after its migration SQL but before its history insert. It must return exactly one row and one scalar equal to the descriptor's expected value.
- Failed verification rolls back the migration SQL and all earlier work in the plan.
- Migration and verification queries may not issue transaction-control statements.
- The RLS inspector derives table expectations from verified descriptors and reads PostgreSQL catalogs for table existence, RLS enablement, public data privileges, and policy counts.
- `deny-by-default` requires zero policies; `policies-required` requires at least one. Public `SELECT`, `INSERT`, `UPDATE`, or `DELETE` is always a failure.

## Consequences

- Migration success is tied to executable postconditions rather than successful SQL submission alone.
- Review and automation can identify destructive work before connecting to a database.
- The current official schema is machine-verifiably fail-closed and can later transition to tested application policies without changing the inspection API.
- Catalog inspection proves structural posture, not tenant behavior; live actor-versus-tenant tests remain required.
- Descriptor changes alter package identity even when SQL is unchanged.

## Alternatives considered

- Markdown-only migration notes were rejected because they cannot gate execution.
- Verification after commit was rejected because failure would leave unverified schema changes applied.
- Treating any nonempty query result as success was rejected because it permits ambiguous checks.
- Static SQL matching alone was rejected because database catalogs are the runtime source of truth.

## Review date

Review when the first RLS policy migrations and isolated tenant-behavior test harness are added.
