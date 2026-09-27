# ADR 0040: Project Experience and Governance Roadmap

## Status

Accepted for post-F11 planning.

## Context

The external pilot exposed a reusable need for project-scoped agent skills, dependable local checks, durable design references, and policy documents grounded in actual product behavior. Flower already generates bounded agent adapters and implements typed workflows, but it does not define skill packages, lifecycle-hook packages, Git-hook adapters, design-reference provenance, or legal-policy and consent contracts.

Adding these features independently would recreate the architecture-audit problems Flower was designed to avoid: excessive unpinned skills, prose-controlled automation, weak shell hooks, copied design material with unclear rights, and generic legal text that can drift from the application.

## Decision

- Add the proposed F12 Project Experience and Governance phase after F11.
- Keep the active F7 sequence and the approved F8 through F11 roadmap unchanged.
- Treat existing F5 workflows and agent adapters as the authority; F12 skills and hooks are bounded packages and projections over those contracts.
- Make Husky an optional thin Git-hook adapter. CI repeats all required checks because local hooks are bypassable.
- Store design inspiration as project-owned provenance and reasoning, not as permission to copy third-party interfaces or assets.
- Generate legal and policy documents only from explicit project-owned facts and jurisdiction profiles backed by primary sources.
- Treat generated policy text as a draft requiring identified human review. Flower validation never represents legal compliance or legal advice.
- Keep edited policy documents project-owned. Updates produce reviewable differences and never silently publish or overwrite them.
- Permit the RoomScouter pilot to develop project-owned policy and design artifacts before F12, but require independent framework schemas and tests before generalizing them into Flower.

## Consequences

- The requested capability has a bounded future phase without diverting F7 adoption work.
- Flower can provide a cohesive experience while preserving agent neutrality and machine-enforced authority.
- Skill and hook provenance become supply-chain concerns subject to the existing planning and ownership model.
- Legal-policy usefulness depends on accurate product facts, maintained jurisdiction profiles, and qualified human review.
- The first implementation slice cannot begin until F11 provides verified package authoring and catalog contracts, unless a later architecture decision explicitly reorders that dependency.

## Rejected alternatives

- Expanding hand-written `AGENTS.md` files was rejected because generated prose is not an enforcement boundary.
- Installing large skill collections by default was rejected because it increases ambiguity, context size, and supply-chain risk.
- Allowing arbitrary hook commands was rejected because manifests would become an unreviewed shell-execution channel.
- Treating Husky as a security control was rejected because local hooks can be bypassed.
- Saving screenshots or copied assets without rights metadata was rejected because a reference library is not a license.
- Shipping universal terms and privacy text was rejected because applicable duties depend on product facts and jurisdiction.

## Review triggers

Review after the F7 exit audit, after RoomScouter's first policy and consent implementation, when F11 package contracts stabilize, or when counsel identifies a required boundary not represented in the specification.
