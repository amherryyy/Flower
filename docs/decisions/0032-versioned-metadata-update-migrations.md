# ADR 0032: Versioned Metadata Update Migrations

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-23

## Context

Framework updates can change the schemas of Flower control documents and the configuration owned by installed modules. Replacing these documents wholesale would discard project state, while ad hoc conversion code would be difficult to order, review, reproduce, or bind into an update plan.

## Decision

- Flower has separate migration registries for schema-versioned manifests and semantic-versioned module configuration.
- Manifest migrations cover project, lock, ownership, and module manifests. Every step advances exactly one integer schema version; skipped versions and downgrades are rejected.
- Module migrations are scoped by module ID and an exact source semantic version. Each step advances strictly forward, and the selected chain must end exactly at the requested version without gaps or overshoot.
- Registry entries have stable IDs and SHA-256 definition digests. Duplicate IDs, duplicate source versions, invalid versions, invalid digests, and ambiguous transitions fail closed.
- Plans are deterministic and digest-protected. They bind the ordered migration identities, source and target versions, and a canonical digest of the source JSON document.
- Canonical document identity sorts object keys recursively while preserving array order. Equivalent parsed JSON objects therefore have the same migration precondition regardless of property order.
- Application verifies the plan structure, source document, complete registry, migration IDs, transitions, and definition digests before executing any migration function.
- Migration functions receive clones and must return JSON objects. Manifest steps must set the exact declared target schema version after every step.
- Module migration steps are included in the encompassing Flower update plan alongside framework manifest migrations.
- The registry and application functions are pure. Transactional filesystem writes and rollback remain the responsibility of the later update application boundary.

## Consequences

- Flower can explain every metadata transformation before any write.
- Missing intermediate releases cannot be silently skipped.
- A changed migration implementation invalidates a previously generated plan through its definition digest.
- Project edits made after planning invalidate the source-document precondition.
- Module configuration can evolve independently from the Flower framework and from database migration history.
- Migration definition digests provide identity and drift detection, not publisher authentication; signed release provenance remains separate work.

## Alternatives considered

- Replacing complete manifests was rejected because it can discard project identity, configuration, and ownership choices.
- Allowing arbitrary version jumps for schema migrations was rejected because an omitted intermediate transformation could silently corrupt metadata.
- Selecting migrations only by target version was rejected because it permits ambiguous paths from different installed versions.
- Hashing raw JSON serialization was rejected because irrelevant object-key ordering would change plans.
- Applying migrations during discovery was rejected because reviewable plans and source preconditions must exist before mutation.

## Review date

Review when signed migration packages or transactional update application is implemented.
