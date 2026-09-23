# ADR 0033: Fixture-Driven Upgrade Scenario Matrix

## Status

Accepted for Phase F6.

## Context

The update resolver, digest-protected plan, generated-text merge, and metadata migration registries each have focused tests. Phase F6 also requires evidence that these boundaries compose into a reproducible 0.1-to-0.2 upgrade, surface conflicts, and leave project-owned code intact. An integration scenario must use real files rather than restating the same examples as in-memory constants.

## Decision

- The canonical scenario lives under `tests/upgrade-scenarios/0.1-to-0.2` with separate source, previous generated base, new framework target, expected output, and conflict inputs.
- The scenario test copies the source project to a fresh temporary directory and composes the public kernel APIs for version resolution, manifest and module migration, generated-text merge, update planning, plan verification, and output materialization.
- The clean scenario runs twice with release, module, and migration inputs in different orders. Both the update plan and every asserted output byte must be identical.
- Project-owned code is copied with the project but is excluded from the generated-file plan and compared byte-for-byte after materialization.
- Overlapping generated edits produce structured merge conflicts and a verified blocked update plan. Changed metadata after planning is rejected before materialization.
- Fixture text uses repository-controlled LF bytes because update identities and preservation claims are byte-sensitive.

## Consequences

- Phase F6 has an end-to-end regression fixture that will detect coordination failures between otherwise-correct update components.
- Expected outputs make review straightforward and prevent a test from accepting whatever the current implementation happens to emit.
- The matrix validates the kernel update contract. A future user-facing update command must reuse these boundaries and add its own transactional I/O, package-manager, database, approval, and recovery tests rather than treating this test harness as a production applier.

## Rejected alternatives

- In-memory-only examples were rejected because they do not prove file-byte preservation or realistic fixture layout.
- Snapshotting only the final directory was rejected because it would not independently assert plan determinism, conflict structure, and project-ownership exclusion.
- Silently choosing the project or framework side of an overlapping edit was rejected because it would either discard a framework change or overwrite project work.

## Review trigger

Review when the production transactional update application boundary or a user-facing update command is introduced.
