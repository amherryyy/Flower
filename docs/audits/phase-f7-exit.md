# Phase F7 Exit Audit

## Verdict

Phase F7 is complete at the audited revision on 2026-10-04.

The implementation satisfies the bounded F7 exit criterion: representative existing projects can be adopted reproducibly without modifying pre-existing project-owned bytes, and the repository-owned 0.1.0-to-0.2.0 release package applies through the public CLI with exact package recovery, explicit approval, transactional filesystem mutation, stale-state rejection, injected-failure rollback, repeatable output, and project-owned-byte preservation.

## Requirement evidence

| Requirement | Implementation evidence | Verification evidence |
| --- | --- | --- |
| Read-only adoption inspection | `packages/kernel/src/adoption-inspection.ts` detects stack, package manager, database paths, CI, agent instructions, Git state, bounded files, and unsafe links without mutation. | `tests/adoption-inspection.test.ts` covers representative detection, bounds, exclusions, links, and unsupported states. |
| Deterministic adoption planning | `packages/kernel/src/adoption-plan.ts` classifies inspected existing paths as project-owned, binds source and package digests, and reports adapter or ownership conflicts. | `tests/adoption-plan.test.ts` proves deterministic plans, stale evidence rejection, safe metadata creation, and conflict reporting. |
| Transactional adoption | `packages/kernel/src/adoption-application.ts` composes metadata, module, and adapter application beneath one rollback boundary and records immutable adoption evidence. | Adoption application and CLI tests cover dry-run, selected capabilities, no-op repetition, stale state, journaling, and rollback after nested work. |
| Persisted update identity | `packages/kernel/src/update-plan-store.ts` stores checksummed plans by validated identity beneath local cache ownership. | Store and CLI tests reject missing, tampered, conflicting, unsafe, and stale plans. |
| Verified package and exact recovery | `releases/0.2.0`, `packages/kernel/src/release-package.ts`, and `release-package-store.ts` define a closed declarative package and cache its exact verified bytes by digest. | Release-package, package-store, CLI, and F7 exit tests reject unsafe, undeclared, changed, missing, corrupt, or substituted artifacts. |
| Project-specific update planning | `packages/kernel/src/release-update-plan.ts` recomputes metadata chains, ownership, generated merges, target postconditions, and package binding from the exact project. | Planning tests cover deterministic results, drift, merge conflicts, source mismatch, module mismatch, and incomplete release postconditions. |
| Public transactional update | `flower update --plan --release-package <path>` caches the package and plan; `flower update --apply <plan-id> --approve <ids>` recovers and applies only that package. | `tests/phase-f7-exit.test.ts` performs two independent CLI upgrades with identical plans and exact expected project, lock, auth, runtime, and project-owned bytes. |
| Stale-state and rollback safety | `packages/kernel/src/update-application.ts` verifies all preconditions before writes and reverses applied filesystem mutations on failure. | The F7 exit test rejects changed project metadata before mutation and injects a mid-transaction failure, then compares every managed file byte-for-byte with its pre-application state. |
| Unsupported effects | Update application rejects dependency or database effects before any filesystem mutation. | `tests/update-application.test.ts` proves `update.unsupportedEffect`; package manifests retain those effects for review without execution. |
| Lean agentic boundary | First-party inspect-only skills guide context and risk-classified planning but grant no write, approval, network, deployment, or delegation authority. | Skill verification binds declared files and digests; the final slice needed no additional agent or autonomous effect layer. |

## Verification record

- The repository-owned release package is schema-valid, closed, digest-protected, and contains no executable migration code.
- Two fresh copies of the certified fixture produce the same package-bound plan and exact final bytes.
- The customized generated banner survives the three-way merge.
- `src/domain/account.ts` remains byte-for-byte unchanged.
- Missing approval, missing cache, corrupt cache, stale project state, generated conflicts, unsupported effects, and injected mutation failures all fail closed.
- The complete suite passes 39 test files and 229 tests.
- TypeScript typechecking, Flower validation, the offline security check, adapter drift validation, and the whitespace check all pass.

## Scope boundary

F7 certifies local inspection, adoption, verified release-package planning, exact local recovery, and transactional filesystem updates. It does not claim public package distribution, release signing, registry transport, package-manager mutation, arbitrary verification-command execution, hosted database mutation, deployment, or distributed rollback across files and external systems.

## Next phase

Phase F8 owns public packaging and release experience: final package names, prerelease publication, immutable provenance and checksums, changelogs, clean-machine installation, documented upgrades, diagnostics, and cross-platform smoke tests.
