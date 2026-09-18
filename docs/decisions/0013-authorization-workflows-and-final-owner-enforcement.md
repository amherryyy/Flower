# ADR 0013: Authorization Workflows and Final-Owner Enforcement

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-19

## Context

RLS read policies protect tenant visibility, but ordinary table writes cannot safely express multi-table authorization invariants. Organization creation must bootstrap an owner atomically, administrative changes require explicit permissions, role ids must stay in their organization, and no path—including privileged direct SQL—may leave an organization without an owner.

## Decision

- Authorization-state tables keep direct authenticated writes disabled.
- Security-definer workflows provide organization bootstrap, role creation, permission changes, member addition and removal, and role assignment.
- Organization bootstrap requires an authenticated caller and atomically creates the organization, owner role, owner permissions, and caller membership.
- Membership administration requires `organization.membership.manage`; role and permission administration requires `organization.role.manage`.
- Granting or revoking `organization.owner` additionally requires the caller to be an owner.
- All helpers derive the caller through `auth.uid()`, fully qualify referenced objects, lock their search path, revoke public execution, and grant only intended entry points to `authenticated`.
- Composite foreign keys continue to prevent assigning a role from another organization.
- Deferred constraint triggers assert that every existing organization has at least one membership whose role carries `organization.owner` after organization creation, membership removal or reassignment, and owner-permission removal.
- Workflow functions repeat the final-owner check immediately for useful errors; deferred triggers protect multi-step privileged transactions and direct service-role SQL.
- Canonical live scenarios now cover member and outsider visibility, permission-gated audit reads, anonymous denial, direct role-write denial, and last-owner self-removal failure.

## Consequences

- Application clients mutate authorization state through a narrow, reviewable contract instead of broad table policies.
- Organization creation cannot commit in a half-bootstrapped ownerless state.
- Multi-step owner transfers can succeed within one transaction because enforcement is deferrable.
- The final-owner invariant also protects privileged operations that bypass RLS.
- Authenticated organization creation can still be abused for resource spam; quotas and durable rate limiting remain security-baseline work.
- Live PostgreSQL tests are still necessary to certify trigger, RLS, and Supabase role behavior together.

## Alternatives considered

- Broad authenticated write policies were rejected because multi-table owner and permission invariants are difficult to encode safely in row predicates.
- Application-only final-owner checks were rejected because service-role or maintenance SQL could bypass them.
- Immediate-only triggers were rejected because they prevent safe transactional owner transfers.
- Allowing callers to supply the acting user id was rejected because authorization must derive from database session identity.

## Review date

Review after live PostgreSQL certification and before exposing additional organization-management operations.
