# ADR 0030: Digest-Protected Update Plans

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-22

## Context

Phase F6 needs a reviewable boundary between selecting a framework version and changing a project. Version resolution alone does not bind the other consequences of an update: package changes, manifest transitions, generated files, database migrations, ownership conflicts, approvals, verification, rollback constraints, or the project state inspected during planning.

## Decision

- Update planning is a pure kernel operation. It does not read or write the project, install dependencies, or apply migrations.
- A plan binds the current and target Flower versions, release channel, selected module-compatibility evidence, dependency changes, manifest migrations, generated-file operations, database migrations, ownership conflicts, required approvals, verification commands, rollback limitations, and project-state precondition digests.
- Equivalent unordered inputs are normalized by stable identities before the plan digest is computed. Duplicate identities are rejected instead of being silently collapsed.
- Project, lock, and ownership manifests require SHA-256 precondition digests. Generated state is bound when it exists. File and migration content identities must also be valid SHA-256 digests.
- Generated-file paths must already be canonical, project-relative paths. Planning rejects absolute, traversing, or normalization-dependent paths.
- Review-required and destructive database migrations automatically add explicit approval requirements. Callers cannot omit those approvals from the plan.
- Unresolved ownership conflicts produce a digest-protected `blocked` plan. They are preserved for review rather than discarded as an exception.
- The stable plan ID is derived from the first 16 hexadecimal characters of the complete plan digest and is prefixed with `update-`.
- Applying a plan is outside this slice. A later application boundary must verify the plan identity and every precondition before making changes.

## Consequences

- Reviewers can see the whole known update surface in one deterministic artifact.
- Reordering catalogs or discovery results does not create a different plan.
- Any changed command, conflict, migration, digest, approval, or rollback statement invalidates an existing plan identity.
- A digest detects mutation but is not a signature or authorization. Approval remains a separate workflow decision.
- Three-way merge computation, manifest migration execution, database application, transaction rollback, and plan persistence remain later F6 work.

## Alternatives considered

- Separate per-subsystem plans were rejected because they could be reviewed or applied against different project states.
- Trusting caller-provided database approvals was rejected because destructive classification must mechanically imply approval.
- Omitting blocked plans was rejected because conflicts are part of the update result and need a stable review artifact.
- Hashing only action lists was rejected because verification and rollback claims are also security-relevant operator inputs.

## Review date

Review when transactional update application or signed release metadata is introduced.
