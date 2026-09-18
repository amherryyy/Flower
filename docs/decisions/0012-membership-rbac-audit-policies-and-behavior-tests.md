# ADR 0012: Membership, RBAC, and Audit Policies with Behavior Scenarios

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-19

## Context

The initial schema is structurally fail-closed, but applications need narrowly scoped read access and tests that distinguish members, outsiders, anonymous callers, and privileged server operations. Catalog inspection alone cannot prove what an actor can observe or mutate.

## Decision

- `organizations-002` adds a private security-definer membership predicate and read policies for organizations and memberships.
- The predicate derives the caller from `auth.uid()` and accepts no user-id argument, preventing callers from probing another user's memberships.
- `rbac-002` adds a private permission predicate that joins the caller's organization membership, assigned role, and role permissions. Roles and permission definitions are readable only by organization members.
- `audit-002` permits audit reads only when the caller has the organization-scoped `audit.read` permission.
- Audit now depends on RBAC because its visibility contract depends on the permission predicate.
- Helper functions lock their search path, revoke public execution, and grant execution only to `authenticated`.
- Ordinary application roles receive read privileges only. Membership, role, permission, organization, and audit writes remain denied by the absence of write policies.
- Each policy migration includes executable verification for policy presence and helper-function privileges.
- The behavior harness runs every scenario in a separate transaction, validates and quotes the selected role, sets the local Supabase user claim, evaluates one scalar or expected SQLSTATE, and always rolls back.

## Consequences

- Member visibility and cross-tenant hiding have explicit policy definitions instead of UI-only conventions.
- Permission-protected audit reads compose through the module dependency graph.
- Security-definer recursion is avoided when membership policies consult the membership table itself.
- Role assignment, organization creation, membership administration, audit insertion, and final-owner enforcement require narrow server-side workflows that are not implemented in this slice.
- The harness is ready for real PostgreSQL cases, but current unit tests use a state-machine client because this environment has no PostgreSQL server or driver.

## Alternatives considered

- Passing a user id into security-definer helpers was rejected because authenticated callers could probe arbitrary principals.
- Direct self-referential membership policy subqueries were rejected because PostgreSQL RLS recursion can fail or behave unexpectedly.
- Allowing all members to read audit events was rejected in favor of the explicit `audit.read` permission.
- Adding broad write policies was rejected until role assignment and final-owner invariants can be tested live.

## Review date

Review after isolated PostgreSQL behavior tests and the first approved write workflows are implemented.
