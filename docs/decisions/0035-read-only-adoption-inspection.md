# ADR 0035: Read-Only Adoption Inspection

## Status

Accepted for Phase F7.

## Context

Adoption begins with an existing project whose structure and ownership Flower did not create. Planning or writing before understanding that project could overwrite application code, select the wrong package manager, collide with existing control metadata, or replace CI and agent instructions. The first F7 boundary therefore needs to collect deterministic evidence without creating `.flower` state or treating guesses as facts.

## Decision

- `flower adopt <existing-project-path>` is inspection-only in this slice. It returns readable output or a stable JSON document and never writes to the target.
- Inspection reports language and runtime evidence, recognized web and database stacks, package-manager declarations and lockfiles, conventional database paths, CI providers and workflow files, agent-instruction files, and Git worktree state.
- Package-manager evidence is taken from npm, pnpm, Yarn, and Bun lockfiles plus the `packageManager` field. Conflicting evidence blocks adoption rather than choosing by precedence.
- Multiple recognized web frameworks, existing Flower control state, malformed or oversized package metadata, unsafe `.flower` links, and inconsistent Git roots are blocking diagnostics.
- Missing stack evidence, a missing Git worktree, an ancestor Git root, and a dirty worktree are explicit warnings. Later planning policy decides which warnings must be resolved.
- The target root must be a real directory. Known evidence paths are inspected without following symbolic links, and source reads are bounded.
- Diagnostics and every multi-value result are sorted so equivalent projects produce equivalent inspection documents.
- This slice does not classify every project path or create an adoption plan. Those depend on a reviewed inspection contract and belong to the next F7 slice.

## Consequences

- Existing projects can be assessed safely before Flower claims ownership or creates metadata.
- JSON output provides a stable input for the later adoption planner while remaining useful to people through readable CLI output.
- Git commands are read-only and injected through the existing command-runner boundary, allowing deterministic tests without mutating repositories.
- A ready inspection means no ambiguity was found; it is not approval to apply adoption changes.

## Rejected alternatives

- Creating `.flower` during inspection was rejected because observation must be repeatable and side-effect free.
- Selecting a package manager by fixed precedence was rejected because stale lockfiles and mismatched declarations require human resolution.
- Recursively scanning every project file was rejected because it would add cost, expose unnecessary content, and encourage premature ownership classification.
- Following symbolic links for convenience was rejected because evidence could escape the inspected project.

## Review trigger

Review when the adoption planner defines complete path classification or when additional supported stacks require new evidence contracts.
