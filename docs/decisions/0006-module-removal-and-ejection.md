# ADR 0006: Module Removal and Ejection

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-18

## Context

Flower needs two distinct ways to stop managing a module. Removal should cleanly delete unchanged generated integration files. Ejection should preserve the current source and transfer it to the project without leaving misleading module or lock metadata.

## Decision

- Removal and ejection share a deterministic, digest-protected plan and dependency guard.
- An operation is refused when another installed module directly depends on the target. Every installed module package must remain available and match its lock entry while this decision is planned and applied.
- Removal requires each managed file to match its package-rendered and locked checksum. It deletes those files and removes the module and generated-file records.
- Ejection records the current checksum but does not require the file to remain unmodified. It preserves each file, removes Flower's module and generated-file records, and appends an exact project-owned ownership rule that overrides the broader generated-path rule.
- Project, lock, ownership, package, and file preconditions are checked again before application.
- Failures restore removed files and all three control documents. Incomplete recovery produces a partial local journal and exit code 8.
- Repeating removal or ejection for an absent module is a verified no-op.

## Consequences

- Flower never silently deletes customized generated files.
- Ejection is an explicit escape hatch and preserves project modifications.
- An ejected path cannot be silently re-adopted by a later module add because it exists and is project-owned.
- Empty directories left after removal are harmless; Flower does not recursively delete project directories.
- Cascading removal is not implicit. Developers must remove dependents explicitly and in dependency-safe order.

## Alternatives considered

- Cascading removal was rejected because one command could remove capabilities the developer did not name.
- Treating removal and ejection as aliases was rejected because their ownership and data-preservation promises differ.
- Allowing forced removal of drifted files was rejected; ejection is the safe explicit workflow for customized generated output.

## Review date

Review when module migrations and runtime package dependencies participate in removal.
