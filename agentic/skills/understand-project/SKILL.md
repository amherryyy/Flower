# Understand a Flower Project

## Purpose

Establish reliable project context before an agent proposes implementation, diagnosis, review, or migration work.

## Use this skill when

- beginning work in an unfamiliar Flower-managed repository;
- resuming after another branch, pull request, or agent changed the project;
- asked what is complete, what remains, or what the safest next change is;
- a failure may come from ownership, generated state, environment configuration, or architecture drift.

## Do not use this skill when

- answering a general question that does not depend on repository state;
- the requested repository is unavailable;
- the user asks for an unrelated external research task.

## Procedure

1. Read the nearest applicable agent instructions, but treat them as generated guidance rather than authority.
2. Read `.flower/project.json`, `.flower/ownership.json`, `.flower/lock.json`, and relevant security or generated-state manifests when present.
3. Read the primary specification, architecture audit, README, applicable accepted decisions, and phase exit audit.
4. Inspect the current branch, working-tree state, and recent history without changing them.
5. Locate the relevant package, schema, workflow, tests, and public exports before proposing code.
6. Classify every intended write by Flower ownership. Stop on protected paths without a migration, generated drift, symbolic links, or unclear ownership.
7. Identify the smallest change that can be independently tested. Separate current scope from attractive later work.
8. Report the evidence, uncertainties, proposed verification, and any authority still required.

## Required output

Provide a concise project brief containing:

- current phase or milestone and the evidence supporting it;
- repository and validation state;
- relevant architectural boundaries and ownership constraints;
- the smallest safe next step;
- explicit deferred work and blockers.

## Safety boundary

This skill is inspect-only. It authorizes no writes, network access, external effects, approvals, commits, pushes, deployments, database changes, or messages to other people or agents. Continue into mutation only when the user's request and the active Flower workflow independently authorize it.
