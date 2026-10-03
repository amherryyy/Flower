# ADR 0048: Lean Agentic Engineering North Star

## Status

Accepted for AF-0 and the second AF-1 skill slice.

## Context

ADR 0047 established a safe local skill package and one project-understanding procedure. Flower still needs a clear optimization goal, lean primary-agent model, context discipline, adaptive effort, deterministic routing, optional review, evaluation criteria, and an explicit long-term place for MCP and deployment autonomy.

Without that synthesis, safety could be mistaken for a permanently narrow product, while ambition could encourage premature swarms, memory systems, or orchestration infrastructure.

## Decision

- Make `FLOWER_AGENTIC_SPEC.md` the canonical agentic north star.
- Optimize reliable engineering output relative to money, tokens, effort, complexity, and maintenance—not minimum token use alone.
- Use one primary coding agent by default and prefer verified skills over subagents.
- Begin with only understand-project, plan-feature, implement-feature, fix-bug, and review-change.
- Select relevant context deterministically before semantic indexes or model-based retrieval.
- Reuse existing manifests, journals, saved plans, decisions, and notes as repository memory.
- Route tasks deterministically into QUICK, STANDARD, and CRITICAL levels; use independent review only when justified.
- Keep MCP adapters and policy-bounded autonomous deployment in the long-term direction, gated by canonical permissions, plans, approvals, verification, recovery, and human override.
- Measure success, verification, retries, context, intervention, time, resources, and prevented failures.
- Add `flower/plan-feature` as an inspect-only planning procedure. Do not add the other three skills in this slice.

## Consequences

- Flower remains ambitious without treating every future capability as immediate infrastructure.
- Agent behavior becomes reusable and vendor-neutral while the kernel remains authoritative.
- MCP and deployment autonomy have a future path instead of being prematurely built or permanently excluded.
- The next agentic capability is a small verification abstraction, but the primary framework sequence still closes F7 first.

## Rejected alternatives

- Minimizing tokens above correctness was rejected because cheap incorrect work has low value.
- A role-based swarm was rejected because most specialization can be skills for one capable agent.
- Building vector memory or an MCP platform first was rejected because deterministic context and ordinary tools have not proved insufficient.
- Permanently forbidding autonomous deployment was rejected because bounded automation may improve safety and leverage when policy, verification, and recovery mature.

## Review triggers

Review after the five initial skills are exercised, after RoomScouter adoption evidence, before the first MCP adapter, and before any policy-bounded autonomous deployment mode.
