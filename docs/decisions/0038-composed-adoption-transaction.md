# ADR 0038: Composed Adoption Transaction

## Status

Accepted for Phase F7.

## Context

Base adoption creates safe Flower metadata, but the specification also permits explicitly selected modules and agent adapters. Applying those selections after adoption as unrelated commands would weaken dry-run accuracy and could leave a partially adopted project when a later subsystem fails.

## Decision

- Adoption resolves requested modules and their transitive dependencies from a schema-validated, digest-verified catalog before writing.
- The adoption plan binds every resolved package version and digest plus every rendered generated-file source and output digest.
- Selected adapters are generated from the planned final project manifest, ownership rules, canonical workflows, and discovered project context. The plan binds the complete bundle digest, state digest, and artifact digests.
- Existing generated targets are blocking module conflicts. Existing CI or agent instructions remain blocking adapter conflicts and require a future reviewed-merge contract.
- Application recreates the module and adapter child plans after base metadata exists and requires exact equality with the composition bound into the adoption plan.
- Module and adapter engines retain their own validation and rollback behavior, but execute beneath the adoption transaction. A later failure removes all externally generated files, newly created directories, journals, and `.flower` state.
- Existing directories are never removed during rollback. Only parent directories proven absent before application are eligible for cleanup, and only when empty.
- The bundled official catalog remains the default; `--catalog` selects another local verified catalog.

## Consequences

- Dry-run output now commits to the module packages and adapter bytes that application will use.
- One successful command can adopt an existing project, install transitive Flower modules, and materialize selected agent adapters reproducibly.
- Failure injection after either child engine proves that the outer transaction restores the unmanaged project boundary.
- Reviewed merging of overlapping existing CI and instruction files remains intentionally unresolved and blocking.

## Rejected alternatives

- Running `flower add` and `flower adapters sync` manually after adoption was rejected because it is not one adoption transaction.
- Recording only requested module identifiers was rejected because catalog or generator drift could change the applied result after review.
- Trusting a regenerated adapter bundle without binding its artifacts was rejected because canonical workflow or project-context changes could silently alter output.
- Recursively deleting generated parent directories was rejected because an empty directory may have existed before adoption even when it contained no classified file.

## Review trigger

Review when reviewed semantic merges for existing CI or agent instructions are implemented, when remote catalogs are introduced, or when another package manager is supported.
