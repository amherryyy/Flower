# ADR 0004: Module Manifest and Resolution Contract

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-18

## Context

Phase F3 needs to compose independently versioned capabilities without making file changes until dependencies, conflicts, framework compatibility, and cycles have been resolved. The resolver must be deterministic, offline, and usable by future add, remove, and eject plans.

## Decision

- Every module uses a strict `flower.module.json` document conforming to the versioned module schema.
- Module versions and dependency constraints use a deliberately small semantic-version subset: exact versions, comparison ranges, caret ranges, tilde ranges, and `||` alternatives.
- The initial catalog exposes one version of each module ID. Duplicate IDs fail resolution rather than selecting an arbitrary entry.
- Resolution expands transitive dependencies in deterministic topological order and reports missing modules, version mismatches, Flower incompatibility, cycles, conflicts, and incompatible installed versions.
- Failed resolution returns no actions. Successful resolution distinguishes modules to install from compatible modules already retained.
- The resolver is read-only. File generation, package installation, manifest updates, removal, and ejection remain later F3 slices and must consume a successful plan.

## Consequences

- Planning behavior can be tested without filesystem or network access.
- A future multi-version catalog will require an explicit version-selection policy instead of changing this resolver implicitly.
- Module authors receive schema diagnostics separately from catalog-resolution diagnostics.
- Mutating commands cannot silently proceed with a partial dependency graph.

## Alternatives considered

- Reusing package-manager dependency resolution was rejected because Flower modules include migrations, generated paths, ownership, and checks that are not npm packages.
- Resolving modules during file application was rejected because conflicts and cycles must be visible before writes.
- Choosing the first duplicate catalog entry was rejected as nondeterministic and unsafe.

## Review date

Review before supporting multiple catalog versions or remote module registries.
