# ADR 0007: Official F3 Module Contracts

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-18

## Context

Phase F3 requires the initial `auth`, `organizations`, `rbac`, and `audit` modules to compose through the real module engine. The database migration planner, isolated Postgres tests, and runtime security validator are deliberately scheduled for F4. Shipping generated code that appears to enforce security before those facilities exist would create a false guarantee.

## Decision

- The repository-owned `modules/` directory is the default official catalog.
- `auth` is foundational. `organizations` depends on `auth`; `rbac` and `audit` depend on `organizations`.
- Each F3 module includes a strict manifest, module-local configuration schema, generated TypeScript integration descriptor, lifecycle metadata, and human-readable boundary documentation.
- Official F3 manifests declare no migrations. Their generated descriptors expose composition facts but do not implement authentication, tenant isolation, authorization, database auditing, or security policy enforcement.
- Golden-project tests exercise manifest loading, deterministic transitive resolution, installation, dependency-guarded removal, and ejection against the official catalog.

## Consequences

- Users can install and compose the named capabilities through a stable, inspectable contract without hidden side effects.
- Generated files are dependency-free and can compile in the thin F2 application template.
- Runtime security is explicitly absent until F4 supplies executable migrations and verification. Documentation and generated comments make this boundary visible.
- Adding migrations or runtime packages will require manifest-contract evolution and new lifecycle tests rather than an undocumented change to these packages.

## Alternatives considered

- Pretending that static descriptors enforce security was rejected because it would contradict Flower's executable-invariant principle.
- Deferring all official packages until F4 was rejected because it would leave F3 composition and lifecycle behavior tested only against fixtures.
- Making `audit` depend on `rbac` was rejected because recording organization-scoped events should not require a particular authorization implementation.

## Review date

Review during F4 when migration, configuration application, package dependency, and security-check contracts become executable.
