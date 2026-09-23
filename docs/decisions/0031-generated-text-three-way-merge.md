# ADR 0031: Generated-Text Three-Way Merge

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-23

## Context

Flower must update generated integration files without silently overwriting project edits. Comparing only the current project copy with the new framework output cannot distinguish a local customization from an obsolete generated base. Phase F6 therefore needs the previous generated base, current project copy, and new framework target to participate in one deterministic decision.

## Decision

- Generated text is merged from three explicit inputs: the previous framework base, current project copy, and new framework target.
- Exact byte equality handles the common cases first: unchanged, framework-only replacement, project-only preservation, and converged edits.
- When both sides changed, Flower computes line-based differences from the same base and combines non-overlapping edits deterministically.
- Exact line tokens retain their original LF, CRLF, or CR terminators. Flower does not silently normalize line endings during a merge.
- Overlapping replacements and different insertions at the same base position are conflicts. Equivalent overlapping output is accepted once.
- Conflicts return zero-based, half-open base ranges and the base, current, and target text for review. A conflicted result has no output content or output digest.
- Flower never creates conflict-marker text. This prevents unresolved markers from being mistaken for valid generated output and written by a later transaction.
- Every input and successful output has a SHA-256 digest so update planning and application can bind the exact merge evidence.
- NUL-containing input is treated as binary and rejected. Inputs are limited to one MiB each, and the LCS matrix is limited to one million cells to bound memory and CPU use.
- This operation is pure and performs no filesystem writes. Transactional application remains a later F6 boundary.

## Consequences

- Pristine generated files update without manual intervention.
- Project-only edits survive when the new framework base is unchanged.
- Independent project and framework edits compose without losing either side.
- Ambiguous edits stop as structured conflicts instead of being guessed or embedded into source files.
- Large generated artifacts that exceed the bounded algorithm require explicit regeneration, ownership transfer, ejection, or a future streaming merge strategy.

## Alternatives considered

- Always replacing generated files was rejected because it destroys project edits.
- Preserving every modified file unchanged was rejected because it strands projects on obsolete integration code.
- Shelling out to Git was rejected because the kernel must remain deterministic and usable without repository state or a Git executable.
- Emitting traditional conflict markers was rejected because later automation could accidentally treat them as a successful merge.
- Character-level merging was rejected because it is harder to review and more likely to combine semantically conflicting source edits.

## Review date

Review when binary generated assets, streaming merge, or syntax-aware merge strategies are introduced.
