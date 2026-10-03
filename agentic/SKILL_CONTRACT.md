# Flower Agent Skill Contract

## Package shape

Every skill is a regular directory containing `skill.json` and only the files declared by that manifest. Symbolic links and undeclared filesystem entries are invalid.

```text
skill.json
SKILL.md
optional declared resources
```

`skill.json` declares:

- stable `id` and semantic `version`;
- concise `purpose` and one declared `entrypoint`;
- compatible Flower version range and supported agent adapters;
- required reads, writes, network access, external effects, and approvals;
- source, revision, author, license, and first-party/third-party provenance;
- every package file with its exact byte size and SHA-256 digest.

The JSON schema is `schemas/skill/v1.json`.

## Behavioral rules

- A skill supplies instructions and resources; it does not grant authority.
- Loading or installing a skill never executes package scripts or commands.
- The active human authorization, Flower ownership rules, workflow declarations, approvals, and environment restrictions always take precedence.
- Instructions must state triggers, non-triggers, expected evidence, and stopping conditions.
- An inspect-only skill declares empty writes, external effects, and approvals and sets network access to `false`.
- Tool-specific projections may reference verified skills, but canonical intent remains outside generated adapter prose.
- Third-party skills require a future explicit trust and installation boundary; this repository-local foundation accepts only packages supplied directly to the verifier.

## Resource limits

The initial verifier accepts at most 32 declared files, 256 KiB per file, and 1 MiB in total. The entrypoint must be valid UTF-8 text. Recursive skill references are not supported.

## Versioning

Changing instructions, resources, capabilities, or provenance requires a new file digest. Behaviorally meaningful changes require a skill-version increment. Compatibility is evaluated against the running Flower version before the skill is exposed to an adapter.
