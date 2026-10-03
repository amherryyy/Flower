# Flower Agentic Engineering Specification

## Status

This is the canonical north star for Flower's agent-assisted engineering architecture. Implementation remains incremental: the current layer provides bounded repository-local skills and generated adapters without claiming the complete F12 hooks, Husky, catalog, MCP, governance, or deployment surface.

## 1. North star

Flower is a vendor-neutral agentic software engineering framework for disciplined AI-assisted development. It is not merely a project generator, prompt collection, vendor configuration, collection of agents, or autonomous coding swarm.

```text
project context + engineering instructions + reusable skills
+ deterministic routing + relevant-context selection + project state
+ tools + deterministic verification + optional independent review
+ CI/CD + future model/MCP adapters + future bounded deployment autonomy
```

The human developer defines the objective, authority, risk tolerance, and consequential approvals.

## 2. Optimization goal

Flower optimizes for maximum reliable engineering output per peso, token, and unit of developer effort. Efficiency means return on resources, not minimum model usage.

- Spend additional reasoning when it materially improves correctness or reduces risk.
- Avoid duplicate context loading, redundant reasoning, and unnecessary handoffs.
- Prefer deterministic software when ordinary tools can decide reliably.
- Use stronger models where capability has meaningful engineering value.
- Count complexity and maintenance cost when evaluating a feature.

```text
        Reliability × Engineering output × Developer leverage
Value = ------------------------------------------------------
             Tokens × Cost × Complexity × Maintenance
```

This is a reasoning aid, not a literal score.

## 3. Lean architecture

One capable primary coding agent is the default.

```text
USER
  -> deterministic task router
  -> context resolver + selected skill
  -> primary coding agent
  -> authorized tools and Flower plans
  -> code change
  -> deterministic verification
  -> optional independent review
  -> HUMAN
```

Prefer skills over subagents. Use another agent only when independent reasoning has clear value, such as a high-impact security review or an uncertain architecture decision that deterministic verification cannot settle.

Flower does not automatically create separate architect, frontend, backend, database, test, security, documentation, or deployment agents. Specialization initially comes from small reusable procedures.

## 4. Authority model

The following order is authoritative:

1. human instruction and environment authorization;
2. Flower schemas, manifests, ownership, security policy, and accepted decisions;
3. verified Flower plans, workflows, approvals, and journals;
4. project-owned requirements and notes;
5. generated adapter views and verified skill instructions;
6. model suggestions.

Lower levels cannot override higher levels. An agent or skill cannot approve its own consequential action, expand permissions, change ownership, simulate confirmation, weaken a required check, or turn an undeclared effect into an allowed operation.

## 5. Canonical surfaces

### 5.1 Generated adapters

`AGENTS.md`, `CLAUDE.md`, and future vendor-specific files are deterministic, disposable views. Canonical intent remains in Flower manifests, workflows, specifications, decisions, and project-owned notes.

```text
                 Flower canonical definitions
                     /       |       \
                Codex     Claude    future model
                adapter   adapter   adapter
```

Flower must not internally become a Codex, Claude, Cursor, Gemini, or other vendor framework.

### 5.2 Verified skills

A skill is a reusable engineering procedure packaged according to `agentic/SKILL_CONTRACT.md`. It contains bounded instructions and declared resources, not hidden authority or a huge prompt.

The initial set is limited to:

1. `understand-project`;
2. `plan-feature`;
3. `implement-feature`;
4. `fix-bug`;
5. `review-change`.

No additional skill should be added until real usage demonstrates a missing reusable procedure.

### 5.3 Workflows and tools

Agents use registered Flower actions and environment tools only within active authorization. Flower-managed mutation still requires deterministic planning, ownership enforcement, approval, stale-state rejection, journaling, rollback where supported, and verification.

```text
AI reasons. Tools execute. Tests verify.
```

## 6. Context discipline

The context resolver selects the smallest sufficient evidence set:

```text
task + relevant Flower state + selected skill
     + relevant source/types/tests + applicable decisions
```

It does not load the entire repository, every skill, all documentation, or complete Git history by default. Context selection begins with filenames, ownership, imports, test relationships, and accepted decisions. Broader reading requires evidence that local context is insufficient.

Resolution is initially deterministic. Semantic indexes, embeddings, and vector databases require future evidence that simpler discovery is inadequate.

## 7. Repository-held project knowledge

Flower does not depend on conversation memory. Existing canonical structures remain the default memory:

```text
.flower/project.json          project identity and stack
.flower/ownership.json        path authority
.flower/generated/            generated adapter state
.flower/cache/update-plans/   local saved plans
.flower/journal/              transaction/workflow evidence
docs/decisions/               durable decisions
docs/agent-notes.md           optional project-owned context
```

Flower will not add parallel project manifests, duplicated decision logs, short-term memory, long-term memory, episodic memory, semantic memory, agent memory, or vector memory unless real evidence shows the established structures are insufficient.

## 8. Adaptive engineering effort

Task risk matters more than task size. Deterministic rules initially select three levels.

### QUICK

Localized, reversible, low-risk work:

```text
context -> primary agent -> focused verification
```

### STANDARD

Ordinary feature work:

```text
context -> plan -> primary agent -> standard verification
```

### CRITICAL

Consequential work:

```text
context -> explicit plan -> primary agent -> expanded verification
        -> independent review when valuable -> human decision
```

Authentication, authorization, persistent-data migration, security policy, architecture, destructive operations, and production deployment default to CRITICAL.

Routing begins with declared paths, effects, and rules. Prefer rules, scripts, and static analysis before a classifier or another model call.

## 9. Deterministic verification

Flower should eventually expose one consistent `flower verify` interface backed by project-declared commands rather than model judgment.

Initial verification covers lint/formatting, type checking, tests, production build, schema/manifest validation, security/ownership, Git/generated-state checks, and CI evidence. It should support bounded quick, standard, and critical profiles without becoming a second general workflow engine. Individual project commands remain available for diagnosis.

## 10. Independent review

Independent AI review is optional. It is appropriate when security, authentication, authorization, architecture, persistent data, destructive behavior, or hard-to-verify consequences are affected. Small changes normally finish after deterministic verification.

A reviewer receives no mutation or approval authority merely by being invoked.

## 11. Existing-project integration

`flower adopt` must understand an existing repository and add only the compatible Flower engineering layer while preserving project-owned architecture and bytes by default.

RoomScouter is the first real adoption and evaluation project. It should demonstrate context discovery, skill and risk selection, verification, and a genuine task without importing RoomScouter business logic into Flower.

## 12. MCP and external tools

MCP is a long-term Flower capability—not a current foundation priority and not excluded from the north star.

Future MCP adapters may provide bounded access to GitHub, Supabase, Vercel, browsers, documentation, issue trackers, and other engineering systems. They remain adapters around Flower's permissions, workflow effects, approvals, redaction, and audit evidence. They cannot become a parallel authority or expand access beyond the active environment.

Flower introduces MCP after context, skills, verification, project state, and routing work without it. It will not build a custom MCP platform merely because the protocol exists.

## 13. Policy-bounded autonomous deployment

Autonomous deployment is a long-term capability, not prohibited. Flower should progress through:

```text
inspection -> deterministic plan -> human-reviewed approval
          -> supervised execution -> automatic verification
          -> policy-bounded autonomy
```

Later autonomy retains environment boundaries, protected credentials, immutable inputs, policy and approval gates, migration and backup readiness, post-deployment verification, stop conditions, recovery guidance, audit evidence, human override, and emergency shutdown.

Human control does not require every future operation to remain manual. Humans define the authority and limits within which automation may operate.

## 14. Safety and anti-overengineering

- Skills are data; loading or installation never runs lifecycle scripts.
- Every skill declares reads, writes, network access, effects, and approvals.
- Unsafe paths, symbolic links, undeclared files, digest drift, incompatible versions, unsupported adapters, and oversized packages fail closed.
- Prompts, responses, secrets, browsing history, and private conversation memory do not enter manifests, locks, adapters, or journals.
- Agent output is evidence or a proposal until an authoritative Flower operation validates it.
- Do not currently introduce swarms, multi-agent organizations, vector databases, complex memory, dozens of agents or skills, always-on AI review, AI routing for every task, custom dashboards, visual workflow builders, unrestricted deployment, or self-modifying agents.
- Study external systems for lessons without copying their architecture wholesale.
- Before a major capability, ask what engineering value it adds and whether the same result is achievable more simply.

## 15. Evaluation

Flower measures agentic engineering rather than assuming it works. Evidence includes task completion, verification success, incorrect edits, retries, model/tool calls, context consumed, human intervention, developer time, resource consumption, and failures prevented by ownership, approval, or verification.

Metrics are engineering evidence, not incentives to minimize reasoning at the expense of correctness.

## 16. Incremental AF track

- **AF-0 — Architecture:** this specification and its lean boundaries.
- **AF-1 — Skills:** only the five initial procedures, one at a time.
- **AF-2 — Verification:** a small project-declared verification abstraction.
- **AF-3 — Project context:** improve retrieval from existing canonical state without duplication.
- **AF-4 — Routing:** deterministic QUICK, STANDARD, and CRITICAL selection.
- **AF-5 — RoomScouter adoption:** exercise context, skill selection, verification, and a real task.
- **AF-6 — Model and tool integration:** deepen vendor adapters and add justified MCP capabilities after the manual architecture works.
- **AF-7 — Evaluation:** compare value with tokens, cost, effort, time, reliability, and maintenance.

The AF track is cross-cutting. It does not replace F7–F12 or permit an unfinished framework phase to be silently declared complete.

## 17. Current boundary

Implemented now:

- deterministic Codex, Claude, and GitHub Actions projections from F5;
- a versioned skill schema and bounded local verification;
- `flower/understand-project`;
- `flower/plan-feature`;
- generated Codex instructions for Flower itself.

Deferred:

- `implement-feature`, `fix-bug`, and `review-change`;
- a dedicated context resolver beyond current deterministic discovery;
- `flower verify` and adaptive routing;
- remote catalogs, third-party installation, lifecycle hooks, and Husky;
- MCP tool adapters;
- deployment automation and policy-bounded autonomy;
- external skill-author distribution commitments.

## 18. Near-term success

A developer gives Flower a real task. Flower selects relevant project evidence and the appropriate procedure. One capable agent performs the valuable reasoning. Deterministic tools verify the result. Additional agents or expensive reasoning are used only when they add meaningful value. Project knowledge survives outside the conversation, and the developer remains in control.
