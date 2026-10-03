# ADR 0045: Project-Specific Planning from Verified Release Packages

## Status

Accepted for the fourth F7 update-application slice.

## Context

ADR 0044 defines and verifies a data-only release package, but it does not inspect a managed project or produce an update plan. The package describes intended effects; the planner must bind them to the project's exact current bytes, migration versions, installed modules, ownership rules, and generated-file drift before any plan can be reviewed or persisted.

A release package alone cannot decide whether a generated replacement is pristine, whether a three-way merge conflicts, whether project and lock metadata agree, or whether a generated path became project-owned. Those are project-specific facts that must be captured in the F6 plan identity.

## Decision

- Add `createReleasePackageUpdatePlan` as the only kernel bridge from a verified release package and a managed project to an F6 `UpdatePlan`.
- Require regular, non-symbolic project, lock, ownership, module-configuration, and generated files under one regular project root.
- Validate current project and ownership manifests and the lock's minimum semantic shape before planning.
- Require both project and lock Flower versions to equal the package source version, and require their module maps to agree independent of JSON key order.
- Recompute exact project, lock, ownership, and module migration chains from current documents and the package's verified declarative definitions.
- Apply metadata migrations in memory and require project and lock metadata to reach the package target version. Require migrated project and lock module versions to reach every declared module-migration target.
- Classify generated paths against both current and migrated ownership. Any unclassified, conflicting, project-owned, or never-overwrite result blocks the plan.
- Derive create, remove, pristine replacement, or three-way merge actions from the current file bytes and the package's verified base and target sources. Preserve already-converged or project-only changes; represent drift and merge conflicts as explicit blocked-plan conflicts.
- Bind the plan to the verified release-package digest in addition to project, lock, and ownership digests. Update application must receive the same package digest or fail before mutation.
- Preserve package-declared dependency, database, approval, verification, and rollback metadata in the resulting plan. Existing application limits still reject unsupported external effects.
- Keep CLI loading and package persistence outside this slice. The next integration will select a package during `update --plan` and make it available again during `update --apply`.

## Consequences

- A verified package can now produce one deterministic plan for one exact project state.
- The existing F6 plan and F7 transaction remain the source of truth; no parallel update model is introduced.
- Generated product customizations can survive a framework update when the three-way merge is conflict-free.
- Project-owned bytes are not read as update sources or included as mutations.
- Applying a package-derived plan without the exact verified package is rejected with `update.releasePackageChanged`.
- The CLI still needs a local package cache/reference so apply-by-plan-ID can recover the exact package without accepting an arbitrary replacement.

## Rejected alternatives

- Treating all generated files as pristine was rejected because it would overwrite legitimate project customization.
- Replanning during application was rejected because it would invalidate prior review.
- Trusting only the project manifest version was rejected because lock drift was a recurring pilot failure mode.
- Silently skipping inconsistent module metadata was rejected because the resulting migration chain would be ambiguous.
- Allowing ownership only at application time was rejected because the dry-run must show blocking conflicts before approval.

## Review triggers

Review when package caching is connected to the CLI, when package-manager or database effects are applied, when additional manifest schema versions require target-schema validation, or before the F7 exit audit.
