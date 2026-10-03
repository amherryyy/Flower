# ADR 0046: Bounded F7 Closeout

## Status

Accepted. This decision narrows the remaining F7 exit scope and supersedes ADR 0042 only where it assigned automatic dependency and database effect adapters to later F7 slices.

## Context

F7 now inspects and adopts existing projects, persists exact update plans, verifies declarative release packages, derives project-specific migrations and generated-file changes, and applies supported filesystem mutations transactionally. The remaining roadmap also required package-manager and database effect execution with recovery across every effect.

That requirement combines three different failure domains: local files, dependency installers, and external databases. Implementing a general distributed transaction before Flower has a published CLI or a certified hosted environment would add substantial machinery without resolving the pilot's immediate need: safely delivering framework-owned metadata and generated-file corrections.

## Decision

- Close F7 around one verified release package and one real 0.1-to-0.2 filesystem update in the initial certified development profile.
- Connect package selection to the CLI and bind planning and application to the same verified package digest.
- Require deterministic dry-run evidence, ownership enforcement, stale-plan rejection, approval enforcement, local journaling, rollback for filesystem mutations, and injected-failure tests.
- Preserve dependency and database effects in the reviewed plan, but fail closed before mutation when either is present.
- Defer automatic dependency execution until a released package-manager integration demonstrates a concrete need.
- Keep hosted database execution, promotion, verification, and recovery within F9's explicit environment and approval boundary.
- Complete F7 with one end-to-end fixture and an exit audit that names these boundaries rather than implying distributed atomicity.

## Consequences

- F7 remains safe and useful without pretending that files, npm, and PostgreSQL share one rollback transaction.
- Release packages can describe future effects without granting authority to execute them.
- The next F7 implementation is smaller: CLI package selection, exact package recovery, one real update fixture, and the exit audit.
- F8 can focus on installation, publishing, diagnostics, and clean-machine experience.
- F9 owns hosted database execution and recovery evidence.

## Rejected alternatives

- Removing dependency and database effects from release packages was rejected because reviewers still need complete visibility.
- Running commands and SQL with best-effort rollback was rejected because it would weaken Flower's transactional claim.
- Keeping all external-effect adapters in F7 was rejected because it optimized for theoretical breadth before distribution and hosted-environment proof.

## Review triggers

Review after the F7 exit audit, when an update cannot be delivered without a dependency transition, or when F9 defines its hosted migration approval and recovery contract.
