# ADR 0044: Verified Declarative Release Packages

## Status

Accepted for the third F7 update-application slice.

## Context

The F6 planner and F7 application boundary can verify and execute update effects, and ADR 0043 lets the CLI persist and select one exact plan. Flower still lacks a package that supplies the release transition itself. Without a package boundary, the CLI cannot know which metadata migrations, module-configuration migrations, generated bases and targets, dependency changes, database effects, approvals, or verification commands belong to a target release.

Loading executable migration modules from an update package would turn release consumption into arbitrary code execution before the user has reviewed a plan. Accepting undeclared files or trusting manifest digests without reading the artifacts would also leave substitution and packaging mistakes undetected.

## Decision

- Define strict version-one schemas for `flower.release.json` and declarative update-migration documents.
- A release package declares one increasing semantic-version transition, its channel, every update effect, approval, verification command, and rollback limitation.
- Manifest and module-configuration migrations use only ordered `set` and `remove` operations over explicit JSON object paths. Prototype-related keys, duplicate paths, malformed operation shapes, and missing parents fail closed.
- Compile those declarative documents into the existing F6 migration-definition interfaces. Existing migration planning and application therefore retain their chain, digest, stale-source, and postcondition checks.
- Require all artifact sources to be package-local regular files. Reject traversal, symbolic links, invalid UTF-8 generated text, empty SQL, missing files, checksum drift, duplicate declarations, and any package file not declared by the manifest.
- Bind generated changes to separately checksummed base and target sources. Create, remove, replace, and merge declarations have distinct required source shapes.
- Compute a deterministic package digest from the exact manifest bytes and the sorted declared source/digest index.
- Load and expose package effects without yet changing CLI planning. The next slice will build a project-specific update plan from one verified package and current project bytes.

## Consequences

- Flower has a data-only, auditable source of truth for a release transition.
- Release package verification occurs before update planning and cannot run package-provided code.
- The format already represents dependency and database effects, but the application boundary continues to reject those effects until dedicated adapters exist.
- Version one intentionally supports JSON-object metadata transformations, not arbitrary project-code rewrites or array-edit scripting.
- The CLI still produces only the installed-release no-op plan until verified package planning is connected.

## Rejected alternatives

- Dynamic JavaScript or TypeScript migration modules were rejected because verification would require executing untrusted package code.
- JSON Patch was not adopted wholesale because its complete pointer and array semantics are broader than Flower currently needs.
- Allowing extra files was rejected because a release artifact should have a closed, reviewable contents set.
- Embedding generated source text directly in the manifest was rejected because separate files produce clearer diffs and independent checksums.
- Bundling a nominal `0.2.0` release in the framework repository was deferred until its complete effects and package-manager behavior are implemented and reviewed.

## Review triggers

Review when CLI package planning is connected, when array transformations are demonstrated as necessary, when package signing or provenance is added in F8, when binary generated artifacts are required, or before the F7 exit audit.
