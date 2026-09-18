# ADR 0002: Versioned Manifests, Ownership Guards, and Local Journals

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-18

## Context

Flower must understand a project's identity and compatibility before any workflow can safely change files. It also needs explicit ownership boundaries and an audit trail that does not leak credentials. These controls must work offline and remain useful to people, CI, and AI agents.

## Decision

- Every project manifest carries an integer `schemaVersion` independent of the Flower package version.
- Manifest upgrades are forward-only, ordered, pure transformations. A newer unknown schema is rejected rather than guessed.
- File authority is declared through ordered ownership rules. Coverage checks reject unclassified paths, and mutation checks reject owners outside an operation's explicit allowance.
- Diagnostic commands are read-only and expose the same facts in concise text and stable JSON.
- Operation journals live under `.flower/journal/local`, are written atomically, and recursively redact sensitive keys and recognizable credential strings before persistence.
- Flower validates its own repository using the same project and ownership manifests expected from downstream projects.

## Consequences

- Future schema changes require an explicit migration step and migration tests.
- A mutation engine can consume ownership checks without embedding path policy in individual commands.
- Local journal files are excluded from source control and are not a canonical shared history.
- Redaction reduces accidental disclosure but does not make journals appropriate for storing raw secrets; callers must still minimize sensitive input.
- Project manifests created by a newer Flower release fail safely when opened by an older release.

## Alternatives considered

- Inferring project mode from directory contents was rejected because it is ambiguous and difficult to audit.
- Treating every file as project-owned was rejected because upgrades could overwrite protected or generated content.
- A single shared cloud journal was deferred because it would add authentication, privacy, and availability dependencies to local development.
- In-place journal writes were rejected because interruption could leave corrupt records.

## Review date

Review before implementing Phase F2 mutation and rollback behavior.
