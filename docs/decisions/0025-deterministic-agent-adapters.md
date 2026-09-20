# ADR 0025: Deterministic Agent Adapter Views

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-20

## Context

Flower's workflows, ownership rules, and approval boundaries are canonical structured data. Codex and Claude need tool-specific project guidance, but independently maintained instruction files would drift, could silently omit unsupported capabilities, and could turn generated prose into a second source of authority.

## Decision

- Flower generates `AGENTS.md` and `CLAUDE.md` as deterministic views of validated project, ownership, workflow, policy, and architecture-decision inputs.
- Adapter files are generated only when their project-manifest flag is enabled and their path has generated ownership. Project-specific notes remain in a separately declared project-owned file that generation may reference but never overwrite.
- Every artifact embeds its adapter id, generator version, and canonical input digest. `.flower/generated/agent-adapters.json` records input and output SHA-256 digests for drift validation.
- Validation distinguishes a missing artifact, a manually modified artifact, an artifact stale for current canonical inputs, stale or malformed state, duplicate state entries, and no-longer-enabled orphan entries.
- Each adapter has an explicit action and external-effect capability profile. Missing capabilities are blocking diagnostics and are rendered in the generated view; adapters must not simulate or weaken them.
- Generated text repeats the engine-owned approval, declared-effect, ownership, and durable-resume boundaries. Unsafe path and rendered control characters are rejected.
- This slice returns an in-memory bundle and validates materialized output. The caller owns transactional writing and must not silently replace a modified generated file.

## Consequences

- Equivalent canonical inputs produce byte-identical adapter files and state, independent of policy and decision input ordering.
- Reviewers can trace generated guidance back to canonical files and detect both manual edits and legitimate regeneration needs.
- Flower remains usable without either adapter, and adding a new adapter requires an explicit capability profile and output ownership rule.
- Checksums detect drift and accidental changes; they do not authenticate files against a malicious project owner.

## Alternatives considered

- Hand-maintained `AGENTS.md` and `CLAUDE.md` files were rejected because their behavioral boundaries can diverge from the workflow engine.
- Treating generated prose as the canonical workflow was rejected because execution and approval enforcement belong to typed engine contracts.
- Automatically overwriting every mismatch was rejected because it would destroy manual changes before they can be diagnosed.
- Claiming unsupported actions through generic prose was rejected because it creates unsafe false capability.

## Review date

Review when transactional adapter materialization, CI adapter generation, or additional agent runtimes are introduced.
