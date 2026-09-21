# ADR 0027: Agent Adapter CLI Synchronization

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-21

## Context

The kernel can generate, validate, plan, and transactionally materialize Codex and Claude adapter views, but projects need one supported command that assembles canonical inputs consistently. The command must preserve dry-run guarantees, avoid treating prose as executable workflow data, discover optional project context safely, and make ordinary project validation report adapter drift.

## Decision

- `flower adapters sync [--project <path>] [--dry-run] [--json]` is the supported adapter synchronization surface.
- The CLI validates `.flower/project.json` and `.flower/ownership.json`, loads every bundled canonical workflow in stable filename order, validates each workflow against the versioned workflow schema, and passes the resulting typed definitions to the kernel generator.
- Project policy discovery is convention-based and read-only: root `FLOWER_SPEC.md`, root `FLOWER_ARCHITECTURE_AUDIT.md`, `docs/PROJECT_CONTEXT.md`, Markdown under `docs/architecture`, and Markdown under `docs/decisions`. Missing conventional paths are allowed.
- Discovery rejects symbolic links, non-regular files, escapes from the real project root, and more than 256 Markdown files per discovered tree. Discovered prose is referenced by path; it is not parsed as workflow instructions.
- Project-owned adapter notes use the stable optional path `docs/agent-notes.md`. Generation verifies that ownership classifies it as project-owned.
- `--dry-run` returns the digest-protected materialization plan without writes. Normal execution applies the same plan through the kernel transaction and returns exit code 8 only when rollback is incomplete.
- `flower validate <project>` adds adapter validation when Codex, Claude, or GitHub Actions is enabled, or when prior generated adapter state exists. This reports missing, stale, modified, unsafe, invalid-state, and unsupported-capability diagnostics through the existing validation result.
- The bundled workflow directory is part of the Flower CLI distribution contract. Tool-specific files remain generated views; the workflows remain the canonical executable data.

## Consequences

- Users and automation share one stable command and JSON plan format for Codex and Claude synchronization.
- A project with enabled adapters is not considered valid until its generated files and state match canonical inputs.
- Disabling all adapters still validates prior state until synchronization safely removes pristine orphaned outputs.
- Optional project prose can grow independently without becoming an unvalidated execution channel.
- Package assembly must include the canonical workflow assets alongside the CLI.

## Alternatives considered

- Requiring callers to construct kernel inputs manually was rejected because discovery and validation would diverge across integrations.
- Storing free-form workflows in agent instruction files was rejected because it would bypass the typed workflow schema and engine.
- Recursively scanning all Markdown in a repository was rejected because it creates an unbounded and surprising input surface.
- Skipping adapter checks in `flower validate` was rejected because drift would remain invisible in the primary project health command.

## Review date

Review when projects can select workflow sets or install third-party workflows.
