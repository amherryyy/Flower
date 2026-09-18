# ADR 0010: Node PostgreSQL Adapter and Initial Official Schema

## Status

Accepted for Flower 0.1 development. This supersedes ADR 0007's temporary decision that official F3 packages contain no migrations.

## Date

2026-09-19

## Context

The migration executor requires every transaction query to use one checked-out database session. The initial capability modules also need real schema units before RLS policy and tenant-isolation work can be tested. This development environment has neither Docker nor a PostgreSQL client or driver, so the repository must not claim live verification that did not occur.

## Decision

- Flower exposes a structural adapter compatible with a node-postgres pool and client without making the kernel own connection strings or credentials.
- The adapter checks out exactly one client for the operation, delegates to the transactional executor, and always releases it. Failed operations discard the pooled connection.
- `organizations-001` creates organizations and explicit user memberships against Supabase's `auth.users`.
- `rbac-001` creates organization-scoped roles and permissions and adds a composite membership-to-role foreign key that prevents cross-organization role assignment.
- The new membership role link is nullable so installing RBAC into an existing organization does not invent privileges or require an unsafe automatic backfill.
- `audit-001` creates organization-scoped durable audit events.
- Every application table enables row-level security and revokes `public` privileges. No application policies are created in this slice, leaving access fail-closed.
- UUID values are supplied by callers; the migrations do not depend on an extension-provided UUID default.
- Current automated coverage verifies package digests, migration ordering, transactional adapter behavior, required DDL boundaries, RLS enablement, and absence of permissive policies.
- Live PostgreSQL execution is not claimed until an isolated database and driver are available in the test environment.

## Consequences

- Applications using node-postgres can execute Flower plans while preserving session-scoped transactions and advisory locks.
- The initial schema cannot be used by ordinary application roles until explicit, tested policies are added.
- The official migrations currently target Supabase PostgreSQL because membership and audit actors reference `auth.users`.
- Final-owner enforcement, append-only audit privileges, retention, policy verification, and cross-tenant tests remain incomplete.
- A richer migration descriptor is still needed for destructive classification, verification queries, rollback guidance, provider compatibility, and RLS expectations.

## Alternatives considered

- Calling `pool.query` directly was rejected because separate calls may use different sessions and invalidate transaction and advisory-lock guarantees.
- Adding a hard dependency on one PostgreSQL driver was deferred because the dependency is unavailable in this environment and the kernel requires only a structural pool contract.
- Shipping permissive starter policies was rejected because unverified policies could expose cross-tenant data.
- Claiming live integration from a fake client was rejected; state-machine tests and live database tests prove different things.

## Review date

Review when the isolated PostgreSQL test job, migration descriptors, and first RLS policies land.
