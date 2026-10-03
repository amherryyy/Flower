# ADR 0050: Repository-Owned F7 Release Package

## Status

Accepted for the Phase F7 closeout.

## Context

The F7 update pipeline already verified arbitrary local release packages and bound their exact bytes to persisted plans. Closing the phase still required one complete, reviewable package owned by the Flower repository and exercised through the public CLI against a representative customized application fixture.

## Decision

- Store the certified filesystem-only 0.1.0-to-0.2.0 package under `releases/0.2.0` as framework-owned, package-managed source.
- Reuse the established upgrade scenario: project and lock manifests advance to version 2, the auth module advances through 1.1.0 to 2.0.0, and generated runtime code is three-way merged.
- Preserve the fixture's customized generated banner and project-owned domain file byte-for-byte.
- Require the explicit `framework-update` approval during application.
- Keep package verification commands empty until Flower has a constrained command runner; repository CI performs the exit verification externally.
- Prove deterministic planning and output using two fresh projects, then separately prove stale-state rejection and injected filesystem rollback.
- Keep dependency and database effects absent from this package while retaining existing fail-closed tests for packages that declare them.

## Consequences

- F7 has a real package artifact rather than only dynamically assembled test packages.
- The public CLI path and the lower-level injected-failure path share the same verified release bytes.
- The artifact is a certification fixture, not a published Flower 0.2.0 release. Publication, provenance, signing, changelogs, and clean-machine installation belong to F8.

## Agentic workflow finding

The lean CRITICAL workflow kept the release artifact, approval evidence, external verification, and unsupported effects as separate authority boundaries. No additional agent, hook, or service was needed; the existing planning skill was sufficient after its approval-evidence refinement.

## Review triggers

Review when F8 defines public package layout, artifact signing, registry transport, release retention, or constrained verification-command execution.
