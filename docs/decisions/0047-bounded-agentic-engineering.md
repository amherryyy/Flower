# ADR 0047: Bounded Agentic Engineering Foundation

## Status

Accepted as a cross-cutting foundation. This does not declare Phase F12 implemented.

## Context

Flower already generates deterministic Codex and Claude adapter views from canonical workflows, ownership, architecture, and decisions. It does not yet have a concrete first-party skill contract or a repository-level description of how an engineering agent should understand a Flower project.

Adding an autonomous agent runtime would create a second authority beside the kernel. Conversely, leaving agent behavior entirely informal makes project investigation inconsistent and encourages prompts to carry permissions that the workflow engine never granted.

## Decision

- Define `FLOWER_AGENTIC_SPEC.md` as the repository-level agentic engineering model.
- Define `agentic/SKILL_CONTRACT.md` and a machine-verifiable skill manifest schema.
- Ship one first-party, inspect-only `flower/understand-project` skill.
- Verify every declared skill file by size and SHA-256 digest and reject undeclared files, symbolic links, path escapes, unsupported adapters, and incompatible Flower versions.
- Treat skills as instructions and resources only. A skill cannot approve work, expand filesystem or network permission, introduce undeclared effects, or bypass Flower plans.
- Generate `AGENTS.md` through the existing adapter pipeline; it remains a disposable view, not canonical policy.
- Keep remote catalogs, third-party trust, installation, lifecycle hooks, Husky, and transactional skill updates in F12.

## Consequences

- Flower gains a concrete agentic engineering foundation without adding autonomous mutation authority.
- Agents get a repeatable project-understanding workflow before proposing changes.
- Skill packages become reviewable data with explicit provenance and capabilities.
- The full F12 product surface remains deliberately unclaimed.

## Rejected alternatives

- Hand-maintained `AGENTS.md` policy was rejected because generated prose can drift from canonical workflows.
- Executable skill scripts were rejected because instruction packages must not become an unreviewed command channel.
- Waiting until F12 to document any agent workflow was rejected because deterministic agent adapters already exist and benefit from a concrete bounded skill now.

## Review triggers

Review before third-party skills, remote retrieval, script mapping, skill installation commands, lifecycle hooks, or the F12 exit audit.
