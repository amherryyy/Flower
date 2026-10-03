# ADR 0049: Exact Local Release-Package Recovery

## Status

Accepted for the fifth F7 update-application slice.

## Context

Flower could verify a release package and derive a project-specific plan, but `flower update --apply <plan-id>` had no safe way to recover the package that produced the reviewed plan. Accepting another path during apply would permit substitution, while retaining only the original path would make application depend on mutable external state.

## Decision

- Add `--release-package <path>` to `flower update --plan` as an explicit local package-selection boundary.
- After verification and planning, copy the package's exact closed file set to `.flower/cache/update-packages/<digest>` and re-verify the copy before persisting the plan.
- Keep `--dry-run` read-only: it neither caches the package nor persists the plan.
- During apply, recover the package solely from the digest embedded in the persisted plan, re-run full package verification, and reject missing, corrupt, changed, or substituted bytes before mutation.
- Add `--approve <comma-separated-ids>` as explicit CLI evidence for package-declared approvals. Unknown or missing approvals remain rejected by the update application boundary.
- Preserve current-release no-op planning when no release package is selected.
- Continue to reject dependency and database effects before filesystem mutation. Do not execute arbitrary package-declared verification commands until a separately reviewed command boundary exists.

## Consequences

- Planning and application use the same immutable package bytes without requiring a registry or network connection.
- Local package caches are disposable and never committed; deleting a needed cache causes a fail-closed error rather than replanning.
- A reviewed filesystem-only release can now move through the public CLI transactionally.
- F7 still needs one complete repository-owned 0.1-to-0.2 release fixture and its exit audit.

## Agentic workflow finding

The CRITICAL planning workflow exposed that declared approval requirements need an explicit evidence path at the user-facing boundary. Adding `--approve` resolves that recurring implementation gap without expanding agent authority: an agent may surface required IDs, but only the caller supplies approval evidence.

## Rejected alternatives

- Supplying a package path again during apply was rejected because it creates a substitution opportunity.
- Persisting only the original absolute path was rejected because the source can move or change after review.
- Automatically approving every requirement in a selected package was rejected because package selection and consequential approval are distinct decisions.
- Executing declared command strings through a shell was rejected in this slice because package verification does not by itself grant process-execution authority.

## Review triggers

Review when Flower gains a release registry, signed packages, garbage collection, a constrained verification-command runner, or dependency execution.
