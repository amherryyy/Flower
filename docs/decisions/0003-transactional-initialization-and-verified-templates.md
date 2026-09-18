# ADR 0003: Transactional Initialization and Verified Templates

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-18

## Context

Phase F2 introduces Flower's first mutating workflow. Project initialization must remain predictable across platforms, refuse ambiguous targets, verify its inputs, expose a plan before writes, and recover without damaging pre-existing content.

## Decision

- `flower init` accepts only a missing or empty target. Adoption of existing projects remains a separate future workflow.
- Initialization creates a deterministic plan whose ID and SHA-256 digest cover every option and planned action. Application rejects a changed plan, target, or template.
- Official templates carry a versioned manifest and a SHA-256 digest for every source file. Flower verifies source bytes before planning and again immediately before writing.
- Text rendering supports only explicit `{{variable}}` placeholders. Template paths are normalized and confined to the template and project roots.
- The initial package-manager interface has one npm adapter. Additional managers must implement the same install and script-invocation contract rather than branching throughout initialization.
- All files and package-manager side effects are contained in a target known to have been empty. Failure removes the created target, or empties a pre-existing target directory. If complete rollback fails, Flower keeps a partial recovery journal and exits with code 8.
- Successful initialization writes a redacted local journal entry after template verification and optional project verification complete.
- The first official template is a thin Next.js App Router shell with a Supabase client boundary. It owns no product domain model and installs no Flower capability modules.

## Consequences

- `--dry-run --json` is stable and performs no writes.
- Dependency installation and the template's test, type-check, lint, and build scripts run by default; `--skip-install` exists for offline inspection and automated transaction tests.
- Initialization never merges with existing files, deletes an existing Git repository, creates a remote, or writes secrets.
- Template edits require intentional digest updates and fail closed when source bytes drift.
- npm is the only supported F2 package manager, but the transaction engine does not depend on npm-specific command construction.

## Alternatives considered

- Copying a directory without a manifest was rejected because source drift would be invisible.
- Writing directly into non-empty targets was rejected because rollback could not distinguish pre-existing files from generated files.
- Making the CLI itself track individual filesystem mutations was rejected in favor of a testable kernel transaction.
- Supporting several package managers immediately was rejected because one complete, verified adapter is safer than multiple untested variants.

## Review date

Review when adoption, remote templates, or a second package manager is implemented.
