# Flower Agentic Engineering Specification

## Status

Initial bounded foundation. This specification describes repository-local agentic engineering behavior that can be implemented before F12 without claiming the complete F12 skills, hooks, Husky, catalog, or governance surface.

## Purpose

Flower uses AI agents to reduce the time needed to understand, plan, implement, and verify application work. Agents are collaborators operating through Flower's existing contracts; they are not an autonomous control plane.

The desired loop is:

```text
understand project -> identify bounded change -> produce/review plan
        -> apply through Flower authority -> verify -> record evidence
```

## Authority model

The following order is authoritative:

1. human instruction and environment authorization;
2. Flower schemas, project manifests, ownership rules, security policy, and approved architecture decisions;
3. verified Flower plans, workflow definitions, approvals, and journals;
4. project-owned requirements and notes;
5. generated agent adapters and verified skill instructions;
6. model suggestions.

Lower levels cannot override higher levels. An agent or skill cannot approve its own consequential action, change ownership, expand permissions, simulate user confirmation, weaken a required check, or turn an undeclared side effect into an allowed operation.

## Agentic engineering surfaces

### Generated agent adapters

`AGENTS.md`, `CLAUDE.md`, and other supported runtime views are generated from canonical Flower inputs. They are disposable and drift-checked. Project intent must never exist only in an adapter file.

### Verified skills

A skill is a small instruction and resource package described by `agentic/SKILL_CONTRACT.md`. Loading a skill verifies its schema, compatibility, closed file set, sizes, and SHA-256 digests. Loading does not execute code or grant a capability.

The first bundled skill, `flower/understand-project`, is inspect-only. It establishes evidence about project identity, architecture, ownership, Git state, verification commands, and unresolved risks before an agent proposes changes.

### Workflows and tools

Agents use registered Flower workflow actions and ordinary environment tools only within the authorization already available to the active session. Mutations that Flower manages must still pass through deterministic plans, ownership enforcement, required approvals, journaling, stale-state checks, and verification.

## Mandatory safety rules

- Skills are data; installation or loading never runs lifecycle scripts.
- Every skill declares reads, writes, network use, external effects, and approvals.
- Undeclared files, symbolic links, unsafe paths, digest drift, oversized content, incompatible versions, and unsupported adapters fail closed.
- Secrets, prompts, responses, conversation history, and private agent memory are not stored in skill packages, manifests, locks, generated adapters, or journals.
- Inspect-only skills declare no writes, network access, external effects, or approvals.
- Agent output is evidence or a proposal until an authoritative Flower operation validates it.
- Remote skill catalogs and third-party trust are not part of this foundation.

## Initial engineering workflow

1. Load and verify the selected skill package.
2. Read canonical project and ownership metadata before broad source inspection.
3. Identify generated, protected, framework, project, and local paths.
4. Inspect applicable specifications, decisions, tests, and current repository state.
5. Report contradictions, missing facts, and unsupported effects explicitly.
6. Propose the smallest independently verifiable change.
7. Use the existing Flower plan/application boundary for managed mutations.
8. Run risk-proportionate checks and summarize evidence without hiding warnings.

## Current boundary

Implemented in this foundation:

- deterministic Codex/Claude/GitHub Actions adapter generation from F5;
- a versioned skill manifest schema;
- bounded local skill verification;
- a first-party project-understanding skill;
- generated Codex instructions for the Flower repository.

Deferred to F12:

- remote discovery and catalogs;
- third-party trust and installation;
- transactional skill add, sync, update, and removal commands;
- lifecycle and agent hooks;
- Husky integration;
- project experience manifests and locks;
- distribution and compatibility commitments for external skill authors.
