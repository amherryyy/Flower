# ADR 0041: Initial Certified Web Application Profile

## Status

Accepted for F8-F9 planning. It does not reorder the approved phase sequence or claim implementation.

## Context

The RoomScouter pilot confirmed that a framework may have sound general contracts and still impose excessive integration work on application teams. The pilot repeatedly assembled Windows tooling, Next.js, npm, Supabase local and hosted environments, PostgreSQL migrations and generated types, authentication, storage, deterministic seed data, browser journeys, GitHub Actions, and Vercel deployment through separate manual procedures.

Broad statements that Flower supports “web applications” would be difficult to test and would obscure provider-specific behavior. Hard-coding RoomScouter's domain into Flower would create the opposite problem: a framework coupled to one school project.

## Decision

- Define the first certified application profile as TypeScript, Next.js App Router, npm, Supabase, GitHub Actions, and Vercel.
- Treat Windows as a first-class development host alongside macOS and Linux.
- Keep the Flower kernel provider-neutral. The profile composes public package-manager, database, workflow, adapter, ownership, security, and deployment contracts.
- Make every certification claim executable through framework-owned fixtures. Unsupported combinations remain inspectable where possible but are not described as certified.
- In F8, prioritize distributable CLI invocation, cross-platform diagnostics, stable JSON output, and composed verification tiers.
- In F9, prioritize explicit environment identity, Supabase migration and type-generation evidence, executable RLS/Auth/Storage proof, safe local fixtures, Vercel readiness, post-deployment verification, and honest rollback boundaries.
- Add configurable critical-route performance evidence to the profile only where adapters can measure it reliably. Do not promise automatic optimization of arbitrary application code.
- Keep application roles, domain schema, screens, content, and business rules project-owned.
- Keep production mutation approval-gated. Profile convenience cannot bypass the existing workflow, journal, ownership, and rollback contracts.

## Consequences

- Flower gains a precise product promise that can be tested end to end.
- Teams using the certified stack receive a cohesive path instead of a collection of low-level primitives.
- Other stacks require new profiles or adapters with independent conformance evidence; they are not implicitly unsupported by the kernel.
- Provider-specific packages may move faster than generic abstractions because their behavior can be proven against real services.
- Documentation must distinguish kernel compatibility, profile recognition, and full certification.
- F7 remains the immediate priority because profiles need transactional update application to consume corrections safely.

## Rejected alternatives

- Claiming general support for all TypeScript web stacks was rejected because the pilot supplied no conformance evidence for that claim.
- Moving Next.js, Supabase, or Vercel assumptions into the kernel was rejected because it would weaken adapter boundaries and make later profiles harder to support.
- Turning pilot domain features into official modules was rejected because listings, favorites, reviews, reports, and application roles are not general delivery infrastructure.
- Adding a new phase before F7 completion was rejected because update application is the mechanism needed to deliver fixes to adopted projects.
- Treating successful unit tests as provider certification was rejected because Auth, Storage, RLS, redirects, and deployment behavior required executable integration proof.
- Promising automatic performance optimization was rejected because safe optimization depends on application semantics and measured evidence.

## Review triggers

Review after the F7 exit audit, after the F8 clean-machine prerelease proof, after the F9 RoomScouter conformance run, or when a second external pilot demonstrates demand for a different certified stack.

