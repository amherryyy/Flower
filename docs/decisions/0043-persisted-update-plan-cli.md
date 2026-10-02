# ADR 0043: Persisted Update Plans and CLI Selection

## Status

Accepted for the second F7 update-application slice.

## Context

ADR 0042 added a transactional kernel boundary for verified filesystem update effects, but intentionally left persistence and command-line selection outside that boundary. A user still could not review a plan in one command and later apply that exact artifact by identity. Replanning during application would weaken the review boundary, while accepting an arbitrary plan path would make path traversal, substitution, and accidental cross-project application easier.

Flower also does not yet ship a release-package catalog containing a future framework version and its migration definitions. The CLI must not invent an upgrade or claim that a current installation can consume an unavailable release.

## Decision

- Add `flower update --plan [--project <path>] [--dry-run] [--json]` and `flower update --apply <plan-id> [--project <path>] [--json]`.
- Persist plans only beneath `.flower/cache/update-plans`, which is already classified as local and never committed.
- Derive filenames exclusively from deterministic `update-<hex>` plan identities. Reject unsafe identifiers, symbolic-link directory components, non-directory components, and paths that resolve outside the project root.
- Wrap each plan in a versioned envelope with an independent canonical SHA-256 checksum. On load, verify the envelope checksum, filename identity, and the F6 plan identity before using any field.
- Write plans atomically through a private temporary file while holding an exclusive per-plan writer lock. Re-saving the same verified plan is idempotent; a different plan with the same identity fails closed.
- Bind the first CLI slice to the currently installed Flower release. It therefore produces a useful persisted no-op plan that captures exact project, lock, and ownership-manifest digests and proves selection, tamper detection, and stale-state rejection without claiming that a future update package exists.
- Applying a persisted current-release plan reuses `applyUpdatePlan`, including precondition verification. A changed project is rejected instead of silently replanned.
- Reject non-unchanged persisted plans at the CLI with `update.packageUnavailable` until Flower ships and verifies the release package that supplies their migrations and generated sources.
- A dry run prints the same deterministic plan but does not create the cache or persist an artifact.

## Consequences

- Users can now create, review, save, and later select one exact update plan by ID.
- Corrupt, substituted, stale, locked, missing, or path-unsafe plans have explicit machine-readable errors.
- The CLI syntax promised by the specification exists, but this slice deliberately does not advertise a future-version update. A real upgrade remains dependent on release-package and effect-adapter work.
- Plan artifacts remain machine-local operational state rather than repository content.

## Rejected alternatives

- Replanning inside `--apply` was rejected because the applied plan could differ from the reviewed plan.
- Accepting a caller-provided filesystem path was rejected because Flower owns the plan location and identity boundary.
- Storing plans in committed project metadata was rejected because plans contain ephemeral preconditions and local operational state.
- Creating a fictional `0.2.0` release entry was rejected because no packaged release definition exists to prove its effects.
- Applying action plans with empty migration registries was rejected because failure must be explicit before mutation.

## Review triggers

Review when a signed or digest-indexed release-package catalog is introduced, when package-manager or database effects are supported, when plan portability between machines is required, or before the F7 exit audit.
