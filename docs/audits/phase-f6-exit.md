# Phase F6 Exit Audit

## Verdict

Phase F6 is complete at merge commit `0ca57ae` on 2026-09-23.

The implementation satisfies the specification's exit criterion: the canonical 0.1-to-0.2 fixture produces the same verified update plan and exact output bytes across reordered inputs, turns overlapping generated-file edits into an explicit blocked plan, rejects stale metadata, and preserves project-owned code byte-for-byte.

## Requirement evidence

| Requirement | Implementation evidence | Verification evidence |
| --- | --- | --- |
| Version resolver | `packages/kernel/src/update-version.ts` selects channel-eligible releases only after checking exact installed-module compatibility. | Resolution tests cover deterministic selection, channels, requested versions, prereleases, incompatible modules, duplicate catalogs, invalid versions, downgrades, and unchanged projects. |
| Update planning and plan digests | `packages/kernel/src/update-plan.ts` canonicalizes and binds framework, dependency, manifest, module, generated-file, database, ownership, approval, verification, rollback, and project-precondition evidence into one SHA-256 identity. | Planning tests prove order independence, no-op and blocked plans, mutation detection, selected-version compatibility, canonical paths, unique entries, and valid digests. |
| Generated-file three-way merge | `packages/kernel/src/generated-text-merge.ts` compares the previous generated base, current project copy, and new framework target without emitting conflict markers. | Merge tests cover replacement, preservation, convergence, independent edits, insertions, deletions, structured conflicts, exact line endings, binary rejection, and complexity limits. |
| Manifest and module migrations | `packages/kernel/src/metadata-migration.ts` builds consecutive, digest-bound manifest chains and exact forward semantic-version module chains, then verifies inputs and definitions again during application. | Migration tests cover every manifest version field, multi-step application, unchanged plans, gaps, ambiguity, downgrades, overshoots, source drift, definition drift, invalid postconditions, and tampered plans. |
| Upgrade scenario matrix | `tests/upgrade-scenarios/0.1-to-0.2` separates source, previous base, new target, expected output, and conflict fixtures; `tests/upgrade-scenario.test.ts` composes the public F6 kernel boundaries against those files. | Two clean runs with reversed catalogs and registries produce identical plans and bytes; expected metadata and generated output match exactly; conflict and stale-input scenarios fail closed. |
| Project ownership preservation | The successful plan contains only the generated `src/flower/runtime.ts` path. The project-owned `src/domain/account.ts` is never an update artifact. | The scenario copies a real project, materializes the planned results, and compares the project-owned file with its source byte-for-byte after both runs. |

## Verification record

- GitHub pull requests 9 through 13 each completed all five required checks before merge.
- Phase F6 implementation is merged through commit `0ca57ae`.
- The audit branch was created from a clean, synchronized `origin/main` at that commit.
- The complete Windows test suite passes all 29 test files and all 180 tests.
- TypeScript typechecking passes for the kernel and CLI.
- `flower security check` passes against both CI workflows.
- `flower validate .` passes.
- `git diff --check` reports no whitespace errors.

## Scope boundary

This verdict covers the Phase F6 kernel roadmap and its stated fixture exit criterion. The fixture test deliberately composes public kernel boundaries so failures between resolution, planning, merging, and migrations are observable. It does not masquerade as a production filesystem applier.

A user-facing transactional update command still needs to define package-manager execution, approval collection, database application, durable recovery, and CLI presentation around these verified kernel contracts. That productization must add its own transactional and failure-injection tests. It does not weaken the completed F6 claims because none of those behaviors are asserted by this audit.

## Remaining scope

The next planned framework work is Phase F7 adoption: inspection, ownership proposal, dry-run adoption, and migration of existing project structure without overwriting project code. Hosted Supabase proof, stronger audit tamper evidence, concrete upload inspection providers, data-flow-aware logging checks, richer online advisory enrichment, and production update-command orchestration remain later slices.
