# Plan a Flower Feature

## Metadata

- Skill: `flower/plan-feature`
- Version: `1.0.1`
- Mode: inspect-only planning
- Typical routing: STANDARD or CRITICAL

## Purpose

Produce the smallest implementation plan that satisfies a feature request while preserving Flower architecture, ownership, security, and verification boundaries.

## Use this skill when

- a feature affects multiple files or components;
- the correct implementation boundary is unclear;
- architecture, persistent data, authentication, authorization, security, or external effects may be involved;
- acceptance criteria are needed before implementation.

## Do not use this skill when

- the change is a clearly localized QUICK correction with an obvious check;
- the request is only explanation, status, or unrelated research;
- required project context is unavailable.

## Required context

Load only what is needed from:

- verified `flower/understand-project` output or equivalent current evidence;
- the user request and applicable product requirements;
- `.flower/project.json` and `.flower/ownership.json`;
- relevant source, types, schemas, and tests;
- directly applicable specifications and accepted decisions;
- current Git state and existing verification commands.

Do not load unrelated packages, every decision, all skills, or complete Git history by default.

## Procedure

1. Restate the outcome and separate it from possible implementation ideas.
2. Trace the smallest relevant execution and data paths through existing code and tests.
3. Identify canonical sources and classify every likely write by Flower ownership.
4. Record constraints, invariants, compatibility requirements, and non-goals.
5. Classify risk: QUICK for localized reversible work, STANDARD for ordinary features, and CRITICAL for authentication, authorization, persistent data, security, architecture, destructive effects, or deployment.
6. Choose the smallest design that reuses existing contracts and avoids a parallel abstraction.
7. Define ordered steps, each with an independently checkable result.
8. Define deterministic verification and acceptance criteria.
9. Identify approvals, effects, rollback limits, unresolved choices, and stop conditions. For every required approval, name its evidence path and keep artifact selection distinct from approval of consequential effects.
10. Separate current work from deferred improvements.

## Guardrails

- Planning grants no mutation, network, execution, approval, commit, push, deployment, or database authority.
- Do not invent requirements merely to make the design more general.
- Do not add agents, skills, services, schemas, or layers without demonstrated need.
- Do not rewrite project-owned architecture when incremental integration satisfies the outcome.
- Do not call a plan complete when a material product decision or consequential approval is missing.
- MCP and autonomous deployment may be future integrations, but current plans respect implemented authority and safety boundaries.

## Verification

Prefer deterministic evidence in this order:

1. schema and static validation;
2. focused unit or contract tests;
3. type checking and linting;
4. integration or database behavior tests;
5. production build;
6. browser or hosted-environment proof when required;
7. independent review when CRITICAL risk or residual uncertainty justifies it.

## Expected output

Produce a concise plan containing:

- outcome and acceptance criteria;
- QUICK, STANDARD, or CRITICAL classification with evidence;
- relevant context and files;
- architectural and ownership constraints;
- ordered implementation steps;
- deterministic verification;
- risks, approvals, rollback limits, and blockers;
- explicitly deferred work.

Stop after the plan. Implementation requires separate active authority.
