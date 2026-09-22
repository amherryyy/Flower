# Phase F5 Exit Audit

## Verdict

Phase F5 is complete at merge commit `950ac42` on 2026-09-22.

The implementation satisfies the specification's exit criterion: the same canonical workflow produces deterministic tool-specific adapters, while approval and ownership enforcement remain inside the workflow engine and cannot be weakened by an adapter.

## Requirement evidence

| Requirement | Implementation evidence | Verification evidence |
| --- | --- | --- |
| Typed workflow engine | `schemas/workflow/v1.json`, `packages/kernel/src/workflow.ts`, and `workflows/feature.json` define and execute versioned typed workflow data. | Workflow tests reject invalid actions, inputs, effects, and tampered plans. |
| Approval steps | `approval.require` is handled by the engine rather than an adapter action handler. | Tests stop at `awaiting-approval` and resume only with approval for the exact step. |
| Journal and resumability | The durable local store writes checksummed, revisioned state beneath `.flower/journal/workflows`. | Tests cover atomic persistence, process-independent resume, corruption, stale revisions, unsafe paths, and replay prevention. |
| Ownership enforcement | Delegated writes require an ownership manifest and the step's declared ownership allowlist. | Tests fail closed without ownership, reject undeclared writes, and resume without replaying completed effects. |
| Codex and Claude adapters | The deterministic generator renders both views from the same validated project, ownership, policy, decision, and workflow inputs. | Tests prove byte-identical output for equivalent inputs, capability reporting, checksummed state, and drift detection. |
| CI adapter | The GitHub Actions adapter projects only registered `checks.run` identifiers through framework-owned command mappings. | Tests prove read-only permissions, immutable action pins, exclusion of approval/delegation/write steps, and blocking of unknown checks. |
| Drift validation | Generated artifacts and state record canonical input and output digests. | Tests distinguish missing, stale, manually modified, orphaned, unsafe, and unsupported output. |
| Transactional synchronization | `flower adapters sync` creates a digest-protected plan and materializes generated files with state written last. | Tests cover dry run, no-op replay, stale replacement, disabled-adapter removal, rollback, and incomplete recovery reporting. |
| Adapter independence | Adapter enablement is optional in the project manifest. | Projects without adapters continue to validate; prior state is still checked until pristine orphaned files are removed. |

## Verification record

- GitHub pull request 7 completed five required checks before merge.
- The merged tree and tested feature tree have the same Git tree identity: `52781b902c83da2834cdcbc6b15099419286afed`.
- The normalized Windows checkout passed all 24 test files and all 149 tests.
- TypeScript typechecking passed for the kernel and CLI.
- `flower security check` passed against two CI workflows.
- `flower validate .` passed.
- The repository was clean and synchronized with `origin/main` before this audit branch was created.

## Platform note

A long-lived Windows checkout retained CRLF bytes in checksum-protected template files after the repository adopted `eol=lf`. Git considered the normalized content unchanged, but Flower correctly rejected the differing raw bytes. Normalizing the template working-tree files and setting repository-local `core.autocrlf=false` restored the declared digests and the complete test suite. This was a checkout-state issue, not a committed-tree or F5 implementation defect.

## Remaining scope

Phase F6 owns framework update planning and application. Adoption of existing projects and the later security-hardening items listed in the README remain outside the F5 exit criterion.
