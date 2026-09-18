# Flower Architecture Benchmark

**Audit date:** 2026-09-18  
**Working framework name:** `Flower`  
**Benchmark repository reviewed:** `JuanProperty-main.zip` (treated only as a downstream DannFlow clone)  
**Archive SHA-256:** `90DDE502F2144F32C6444577605BAD7632DF54EE527DEB8E2578E7F1F56E5ACF`  
**Scope boundary:** This report treats the uploaded repository as a downstream DannFlow clone and evaluates only observable files and behavior. It does not attempt to reconstruct private DannFlow source code, history, or undisclosed design. Names found inside the clone are retained only when needed as factual evidence.

## Executive assessment

The uploaded clone is best understood as three systems occupying one repository:

1. A reusable Next.js/Supabase SaaS starter with authentication, dashboard, blog, leads, bookings, AI chat, scheduling, BIR utilities, and tenant-oriented database migrations.
2. A large AI-assisted development control plane made of instruction files, slash-command specifications, skills, hooks, project memory, task tracking, and upstream synchronization procedures.
3. A JuanProperty product specification whose active property-management domain is well planned but largely not implemented yet.

The strongest ideas are explicit project identity, an upstream version anchor, ownership boundaries, schema-governed configuration, migration-first database work, task acceptance criteria, documentation governance, and protected project/framework separation. The weakest aspect is that many of those guarantees are instructions rather than executable invariants. Several documented sources of truth are not wired into runtime code, some documents contradict the actual schema, and security/quality gates do not yet match the repository's claims.

The repository is a valuable benchmark for an independently owned framework, but it should be used as evidence of problems and patterns—not as a code or prompt template to copy.

## Audit basis and limitations

The archive contains 1,443 entries. Major counts from the extracted copy:

| Area | Count / size | Observation |
|---|---:|---|
| Application source | 186 files | Approximately 23k lines, dominated by UI components |
| `.claude/commands` | 52 commands | Rich workflow catalog, implemented as agent instructions |
| `.agents/skills` | 137 skill folders | Broad third-party skill inventory; large context and supply-chain surface |
| `.claude/skills` | 34 skill folders | Partly overlaps `.agents/skills` |
| Supabase migrations | 11 files | Auth/profile, tenant, starter modules, AI, scheduling, chat |
| Test files | 1 | 11 BIR tax-calculator unit tests |
| GitHub workflows | 1 | Lint and build only; lint is non-blocking |

The ZIP excludes Git metadata, so commit history, real remotes, branch protection, signed commits, and actual provenance trailers could not be verified. No live Supabase, GitHub Project, Vercel deployment, or production environment was accessed. Database findings are based on migration order and generated types, not a live database introspection. UI and authentication were not tested end-to-end because no real credentials were supplied.

## Factual architecture map

```text
JuanProperty repository
|
+-- Product identity and planning
|   +-- business.json                 vertical DNA and claimed module flags
|   +-- PROJECT_CONTEXT.md            current product and ownership decisions
|   +-- MASTERPLAN.md                 execution plan and task acceptance criteria
|   +-- metadata.json                 workspace-facing identity
|   +-- dannflow.json                 upstream commit/version anchor
|
+-- AI development control plane
|   +-- AGENTS.md / CLAUDE.md         cross-agent and Claude-specific rules
|   +-- SKILLS.md                     skill routing guidance
|   +-- .claude/commands              workflow specifications
|   +-- .codex                        adapter that loads Claude commands
|   +-- .agents/skills                installed cross-agent skills
|   +-- .claude/skills                Claude-oriented installed skills
|   +-- .claude/helpers + settings    hooks, routing, memory, status, safety checks
|   +-- .claude-flow                  Ruflo/Claude Flow configuration
|
+-- Web application
|   +-- src/app                       Next.js App Router pages and APIs
|   +-- src/components                UI, dashboard, chat, editor, landing page
|   +-- src/services                  direct Supabase-oriented service functions
|   +-- src/hooks / src/lib           shared client and server utilities
|   +-- src/utils/supabase            browser, server, and service-role clients
|
+-- Reusable/domain modules
|   +-- src/bir/core                  pure Philippine tax utilities
|   +-- src/scheduling/core           types and placeholder core surface
|   +-- src/analytics/core            types and placeholder core surface
|   +-- src/ai                        manifests, tools, task queue, chat integration
|   +-- vertical namespace folders    mostly ownership markers/placeholders
|
+-- Data and operations
|   +-- supabase/migrations            schema history and RLS policies
|   +-- supabase/functions             AI Secretary edge-function code
|   +-- supabase/backups               timestamped schema snapshots
|   +-- .github                        CI, Dependabot, PR template
|   +-- .husky                         lint/docs governance hooks
|   +-- install.sh / guide.sh          Bash-first onboarding and setup
|   +-- docs                            framework, JuanStack, project, test docs
```

### Runtime dependency shape

The application is a pragmatic layered monolith:

```text
Next.js pages / route handlers / client components
                    |
                    v
          service functions in src/services
                    |
                    v
      Supabase session client or service-role client
                    |
                    v
        PostgreSQL tables, functions, and RLS
```

This is not domain-driven architecture in implementation. There are no explicit domain entities, application use cases, repository interfaces, or enforced bounded-context imports. The BIR core is the clearest reusable module because its calculations are pure and tested. Most other modules are thin database services or UI features. This simplicity is productive for a starter, but it means architecture boundaries exist mainly in documentation and folder naming.

### Development lifecycle encoded by the repository

```text
new project / JuanStack interview
        |
        v
identity files + namespace scaffolding + environment setup
        |
        v
MASTERPLAN task <-> GitHub Project card
        |
        v
implementation + pending-doc ledger + local verification
        |
        v
implementation commit -> docs commit -> task-tracking commit
        |
        +--> sync from upstream through a feature branch and PR
        |
        `--> propose reusable changes back upstream through a separate PR
```

The lifecycle is thoughtfully specified. Its reliability depends on the agent following Markdown instructions and on local hooks being installed and operational.

## Provenance classification

These labels are evidence-based estimates, not claims about private DannFlow internals.

### Likely framework-inherited patterns (high confidence)

- Generic Next.js/Supabase authentication, dashboard, blog, services, leads, bookings, gallery, and shared UI.
- `docs/dannflow_docs/`, `install.sh`, `guide.sh`, the command library, agent rules, hooks, Codex bridge, and Ruflo configuration.
- The `dannflow.json` upstream anchor and bidirectional sync vocabulary.
- Migration-first schema management, generated Supabase types, RLS-first guidance, CI/Dependabot/Husky setup, documentation ledger, and reusable documentation templates.
- Generic BIR, scheduling, analytics, and AI core namespaces.

Evidence includes the README's explicit statement that JuanProperty is built on the DannFlow SaaS architecture, the named upstream repository in `dannflow.json`, extensive `docs/dannflow_docs`, and many generic modules that predate the active property roadmap.

### JuanProperty domain-specific logic

- The current product definition in `PROJECT_CONTEXT.md`: owner → property → unit, tenant → lease → unit, lease → obligation → payment, and property/unit → maintenance request.
- Phase 1 rules for lease overlap, payment correction, archival, rent due days, partial payments, and deferred capabilities.
- JuanProperty branding and real-estate copy in login/landing/config files.
- `vertical_id: property`, property-owned namespace placeholders, and the property AI persona manifest.
- The active `MASTERPLAN.md` Phase 1 and project-specific requirements/design/technical documentation.

Important maturity distinction: most of the current property-management domain is specification, not executable code. No Phase 1 property, unit, tenant, lease, obligation, payment, or maintenance tables/services/routes exist in the reviewed archive.

### Team/project-specific decisions

- Team-leader ownership and protected boundaries for AI Secretary, Scheduling, BIR, and generic infrastructure.
- The linked GitHub Project board and three-commit close-task convention.
- Cloud-first Supabase work due to local storage constraints.
- The unresolved `property` versus conceptual `real_estate` identity decision.
- The approved mobile-first/touch-target design rules and JuanProperty visual direction.
- Current service choices: Supabase, Upstash, OpenAI, Vercel-oriented deployment, and GitHub Projects.

Some files are blended. For example, `business.json` appears to use a framework-defined shape but contains JuanProperty and older land-registry decisions.

## Initialization and project identity

### What works well

- `/juanstack-init` explicitly interviews for identity, nomenclature, modules, tax rules, AI boundaries, audience, and design constraints.
- JSON Schemas exist for `business.json` and AI manifests. The current `business.json`, core AI manifest, and property AI manifest validate against those schemas.
- `dannflow.json` records the exact upstream SHA, synchronization time, repository, and branch names.
- `PROJECT_CONTEXT.md` preserves product constraints that should not live in a generic framework configuration.
- Namespace ownership and protected paths attempt to prevent cross-vertical contamination.

### Drift and incompleteness

- `business.json` describes a land/parcel/title/broker product, while `PROJECT_CONTEXT.md` and `MASTERPLAN.md` define an active rental property-management product. The latter explicitly calls the discrepancy unresolved.
- The property AI manifest still observes `land_documents`, coordinates, agents, and property-tax deadlines—features deferred by the current Phase 1 plan.
- Documentation says `business.json` is loaded by `src/lib/vertical-config.ts`; that file does not exist.
- Runtime feature gating does not consume `business.json`. `src/lib/dashboard-features.ts` returns `true` for every flag except a special `admin-only` case.
- The schema descriptions say scheduling and AI/BIR subobjects are required when their feature flags are enabled, but the JSON Schema has no conditional `if/then` enforcement.
- `business.json.owned_paths` covers BIR, analytics, and the AI persona, but not scheduling, migrations, tests, or product-domain modules. It is too narrow to represent a real vertical's change ownership and too broad as a security boundary because path ownership alone says nothing about allowed semantics.
- The initialization command scaffolds placeholders and writes documents but has no transactional execution, rollback, idempotency marker, or generated-state checksum.

## AI-agent workflow

### Strengths

- The command catalog covers setup, project design, schema work, RLS checks, task planning, verification, commits, documentation, reviews, deployment, and synchronization.
- `AGENTS.md` and `CLAUDE.md` state safety and precedence rules, while `.codex` avoids cloning the full command library and instead adapts it on demand.
- Commands generally require preflight checks, narrow staging, explicit confirmation before pushes, feature branches, PR review, schema verification, and human verification before task closure.
- The documentation ledger and task IDs give agents a durable coordination model beyond the current chat.

### Weaknesses and operational risks

- Commands are long natural-language programs. There is no parser, typed plan, state machine, dry-run artifact, or resumable transaction log. Agent interpretation can vary by model and session.
- `AGENTS.md` and `CLAUDE.md` overlap substantially but differ. Multiple files call themselves authoritative or canonical, increasing instruction-drift risk.
- The repository contains 137 `.agents` skill folders and 34 `.claude` skill folders. This is excessive for a project-local control plane and raises prompt-selection, maintenance, provenance, and supply-chain risk.
- `skills-lock.json` records source hashes, but setup commands install multiple GitHub skill collections and `ruflo@latest`. Installation is not pinned to immutable commits or verified against the recorded hashes before execution.
- Hooks automatically process prompts, commands, edits, sessions, and memory. The pre-command safety hook blocks only four literal destructive strings; it is not a meaningful command policy engine.
- `.claude/settings.json` declares `darwin`, `arm64`, and `zsh`, while this project was reviewed on Windows. Bash is unavailable in the active PowerShell environment, so multiple setup/checkpoint scripts are not portable as presented.
- A 1.5 MB `ruvector.db` is committed. `.gitignore` contains `@ruvector.db`, which does not ignore `ruvector.db`. Even when no readable secret is obvious, session/memory databases should be treated as potentially sensitive and local-only.

## Update and synchronization mechanisms

### Strong design ideas

- Incoming updates are anchored to an exact upstream commit instead of relying on repository names or time.
- Sync uses a fresh feature branch and PR, avoids merging unrelated rewritten histories, warns on local modifications, and prohibits whole-tree checkout.
- Project-owned application paths are protected from normal upstream replacement.
- `.claude/commands` is treated as a canonical upstream-owned bundle, reducing per-project command drift.
- Outgoing contribution flow distinguishes likely reusable changes from project identity and requires provenance trailers and verification.

### Risks and contradictions

- `/sync-upstream` scans `db/migrations/`, but this repository's actual source of truth is `supabase/migrations/`. It also lists `supabase/` among paths never auto-touched. Therefore the promised automatic schema-update detection can miss the real migrations.
- `install.sh` deletes `.git` and initializes clean history, while `guide.sh init` says it intentionally preserves DannFlow history. `/sync-upstream` broadly assumes rewritten history. Projects created through different paths may therefore have incompatible sync assumptions.
- Exact mirroring of `.claude/commands` can replace local workflow changes. The procedure warns about extras, but the model remains all-or-nothing for that directory.
- There is no machine-readable ownership map, three-way merge base per generated file, migration manifest, or generated-file checksum. Conflict policy is encoded in prose.
- A project can update `dannflow.json` without proving that every expected generated artifact corresponds to that commit.

## Application and dependency boundaries

### Positive findings

- TypeScript strict mode is enabled.
- Pages and components generally call `src/services` rather than embedding queries everywhere.
- Session clients and service-role clients are separated and documented.
- RLS is enabled on all application tables introduced by the reviewed migrations.
- Generated Supabase types are committed and type-check successfully.
- BIR calculations are pure, exported through a core index, and covered by focused tests.
- The production build succeeds, and Next.js routes are cleanly split among static, server-rendered, and API routes.

### Boundary gaps

- Services are tightly coupled to Supabase and Next.js cache/navigation primitives. They are not reusable domain packages.
- There are no automated dependency rules preventing UI imports in core modules or cross-vertical imports.
- Analytics and scheduling “core” areas mostly contain types/placeholders, not mature engines.
- Generic starter modules remain in code and migrations even though JuanProperty's active domain differs.
- Role definitions conflict across layers: `roles.json` defines `super_admin/admin/member`, while the database enum and team service use `admin/user`; normalization hides some mismatch in UI but not in authorization semantics.
- The organization model is owner-only. There is no organization-membership table, yet the UI and docs describe teams and multi-tenant staff.

## Testing, CI/CD, and developer experience

### Reproduced checks

| Check | Result |
|---|---|
| JSON Schema validation | `business.json` and both AI manifests valid |
| Unit tests | 1 file, 11 tests passed |
| TypeScript | Passed |
| ESLint | Passed with 11 warnings |
| Production build | Passed after allowing Google Fonts network access |
| Dependency audit | 38 vulnerabilities: 32 moderate, 5 high, 1 critical |

### Strengths

- Deterministic `npm ci`, Dependabot, PR template, CI concurrency cancellation, Husky, lint-staged, strict TypeScript, and a working production build are a solid starter baseline.
- Commit hooks attempt to keep documentation synchronized with code.
- `.env.example` clearly separates public, server-only, deployment, local/CI, and template-verification values.

### Missing safeguards

- CI does not run unit tests, explicit type-check, migration validation, schema validation, security scanning, or dependency audit.
- Lint is `continue-on-error`, so CI's “Lint & Build” title overstates the merge gate.
- The build downloads Google Fonts, creating a network-dependent build and a potential deployment/privacy concern. Self-hosting would make builds more reproducible.
- There is no `test` or `typecheck` package script despite those checks being central to command instructions.
- There are no integration tests for RLS, tenant isolation, auth redirects, service-role use, AI tool authorization, migrations, or the synchronization workflows.
- Shell-first setup does not provide a first-class Windows path, despite Windows being a likely development environment.
- `TEST.md` is empty, while detailed verification rules live elsewhere.
- `lint-errors.txt` is a stale generated artifact now that lint passes without errors; committed diagnostics are likely to drift.

## Security findings

### Critical

1. **Direct critical Next.js vulnerability.** `next@16.3.2` is within the audited critical range. The audit reports unauthenticated RCE advisories and offers `16.3.5` as a non-major fix.
2. **Unauthenticated AI endpoint and sensitive logging.** `/api/chat` performs no explicit authentication or rate limiting before invoking the paid model. It logs the full request body and parsed messages, which can expose user content in platform logs. Anonymous callers can consume model budget even if RLS later prevents database access.

### High

3. **AI task insertion policy is open.** `secretary_tasks` has an INSERT policy with `WITH CHECK (true)` and no role restriction. The base schema grants default table privileges to `anon` and `authenticated`. The comment says this is for service role, but service role bypasses RLS and the policy actually permits any granted role to insert arbitrary tasks.
4. **Public profile disclosure.** `profiles` has a `SELECT USING (true)` policy. The table includes email, full name, age, birthday, gender, role, and active status. RLS therefore does not protect those fields from public reads where the anon role has SELECT privileges.
5. **Global team administration instead of tenant administration.** An admin is determined by a global profile role. Team operations use the service-role client across all profiles with no organization scope. Any active global admin can enumerate and modify every account, and the “final admin” rule is global rather than per tenant.
6. **Broken scheduling authorization.** Scheduling RLS policies and the AI `createSchedule` tool read `profiles.organization_id`, but that column does not exist in the migration or generated types. Scheduling will fail at runtime and its intended authorization model is not implemented.

### Medium

7. **Public lead/booking insertion lacks abuse controls at the database boundary.** Policies allow inserts into any organization. No constraint binds a public form to a safe organization identifier, and no database-level throttling/validation exists.
8. **Service-role use expands blast radius.** Public blog reads and image cleanup use the admin client. Filters make the read paths appear intentional, but a future missing filter or callable cleanup path would bypass tenant isolation entirely.
9. **AI policy files are not runtime policy.** The chat route uses a hardcoded generic system prompt and a tool manifest. It does not load `business.json` hard limits or the property persona, and enabled tools are not gated by business feature flags.
10. **In-memory rate-limit fallback is fail-open across serverless instances.** When Redis is absent or fails, limits become instance-local and reset with process lifecycle. That is unsuitable for production abuse protection.
11. **No security headers baseline.** `next.config.ts` contains no CSP, frame, content-type, referrer, or permissions policy configuration.
12. **Dependency exposure.** Besides Next.js, the audit reports high/moderate issues in Tiptap, Sharp, Browserslist, js-yaml, brace-expansion, and transitive packages. Several are fixable without redesign.

## Documentation and schema consistency

The documentation is unusually rich, but “documented” and “implemented” are frequently conflated.

- `verify-juanstack.md` expects `secretary_tasks` columns such as `user_id` and `vertical_id`; the actual table uses `organization_id` and omits those fields.
- The JuanStack masterplan marks some architectural work complete while runtime integration remains a future Phase 6 and actual files are absent.
- `CLAUDE.md` says `src/lib/vertical-config.ts` exists and loads `business.json`; it does not.
- The active masterplan correctly acknowledges that Phase 1 is unbuilt and that organization membership and vertical identity require approval. That document is more accurate than several older framework/vertical documents.
- Three schema backups are committed, but there is no demonstrated restore test or retention rule.

## Strengths worth generalizing

The following ideas solve real engineering problems and are appropriate to independently reimplement:

1. Explicit framework/project/module modes instead of inferring intent from a folder name.
2. A versioned project manifest validated by JSON Schema.
3. A human product context separate from machine configuration.
4. Upstream version anchors and provenance metadata.
5. Clear framework-owned, project-owned, generated, and protected paths.
6. Feature work tied to acceptance criteria and dependency-aware task IDs.
7. Migration-first database changes with regenerated types and RLS verification.
8. PR-based upgrades rather than silent direct mutation.
9. Documentation debt tracked as a first-class artifact.
10. Agent-neutral workflow definitions with small tool-specific adapters.
11. Pure, tested core modules for logic that genuinely crosses projects.
12. Human approval gates for consequential actions such as pushes, production schema changes, and autonomous AI actions.

## Flower proposal

### Design principles

- **Machine-enforced over prompt-enforced.** Agents may explain and orchestrate, but schemas, dependency rules, migration checks, ownership, and security gates must be executable.
- **Small kernel, optional capabilities.** Do not ship every SaaS, marketing, and AI feature into every project.
- **Packages for reusable runtime code; generators for project code.** Avoid permanent copy-based synchronization for logic that needs security updates.
- **One canonical model, generated adapters.** Claude, Codex, and future tools should consume generated views of the same workflows and architecture contract.
- **Safe upgrades are products.** Every upgrade produces a plan, diff, migration set, verification result, and rollback guidance.

### Proposed repository architecture

```text
independent-framework/
|
+-- packages/
|   +-- kernel/                 manifest parsing, mode detection, diagnostics
|   +-- cli/                    init, add, doctor, validate, update, migrate
|   +-- config/                 typed schema and configuration API
|   +-- architecture-check/     import and ownership rules
|   +-- security-baseline/      headers, auth guards, RLS test helpers
|   `-- testing/                reusable test and fixture utilities
|
+-- modules/
|   +-- auth/
|   +-- organizations/
|   +-- rbac/
|   +-- audit/
|   +-- ai-chat/
|   +-- scheduling/
|   `-- notifications/
|
+-- templates/                 thin application shells, not the framework itself
+-- schemas/                   project, module, workflow, migration schemas
+-- workflows/                 agent-neutral typed workflow definitions
+-- adapters/                  generated Claude/Codex/CI representations
+-- migrations/                framework migration registry and checksums
+-- policies/                  ownership and dependency rules
+-- docs/                      rationale and public contracts
`-- tests/                     golden projects and upgrade fixtures
```

### Canonical project manifest

Use a domain-neutral manifest such as `framework.project.json`:

```json
{
  "$schema": "./node_modules/@owner/framework/schemas/project-v1.json",
  "schemaVersion": 1,
  "mode": "project",
  "project": {
    "id": "juanproperty",
    "name": "JuanProperty",
    "domain": "property-management"
  },
  "framework": {
    "version": "0.1.0",
    "channel": "stable"
  },
  "stack": {
    "web": "nextjs",
    "database": "supabase-postgres"
  },
  "modules": {
    "auth": "1.0.0",
    "organizations": "1.0.0",
    "rbac": "1.0.0"
  },
  "ownership": {
    "project": ["src/domain/**", "src/app/**"],
    "generated": [".framework/generated/**"],
    "protected": ["supabase/migrations/framework/**"]
  }
}
```

Keep product language, target users, and anti-decisions in a separate project context document. Generate an agent-readable summary from both, with a checksum and “generated—do not edit” marker.

### Module contract

Every capability module should declare:

- module version and compatible framework versions;
- configuration schema;
- runtime packages;
- files it generates and whether users may edit them;
- database migrations with immutable IDs/checksums;
- RLS invariants and tenant model;
- dependency permissions;
- test suite and upgrade migrations;
- documentation and removal/ejection behavior.

This converts “feature flag means enabled” from a UI convention into a validated contract: configuration, code, database, navigation, permissions, and tests must agree.

### Workflow engine

Represent workflows as typed steps rather than prose-only commands:

```text
preflight -> plan -> approval -> apply -> verify -> record
```

Each step should declare inputs, allowed writes, external side effects, rollback behavior, and verification. Tool-specific adapters may render convenient slash commands, but they must call the same CLI/state machine. A failed or interrupted workflow should resume from its journal rather than asking an agent to reconstruct state from chat.

### Upgrade model

Use a hybrid approach:

- Upgrade reusable runtime behavior through semantic package versions.
- Upgrade generated/configuration files through versioned migrations and three-way merge metadata.
- Keep project domain code project-owned and never overwrite it automatically.
- Record framework/module versions in one lock file.
- Make `framework update --plan` produce a human-readable and machine-readable diff before any write.
- Run upgrade tests against golden sample projects in CI.

### Minimum security baseline

Flower should ship and enforce:

- authenticated and rate-limited paid AI routes;
- redaction-safe structured logging;
- tenant membership tables and organization-scoped roles;
- RLS tests for authorized, cross-tenant, anonymous, and service-role cases;
- policy linting that rejects unrestricted write policies unless explicitly waived;
- service-role wrappers that require an allowlisted operation and selected columns;
- security headers and CSP defaults;
- dependency and secret scanning in CI;
- immutable/pinned installer inputs with checksum verification;
- local memory/cache files excluded by default;
- no live database mutation until migrations pass in an isolated verification database.

## Recommended action plan

### Immediate JuanProperty remediation

1. Upgrade Next.js to the audited fixed patch and refresh the lockfile; rerun tests, type-check, lint, build, and audit.
2. Remove or restrict the unrestricted `secretary_tasks` insert policy and add RLS tests.
3. Remove the public full-profile policy or expose a deliberately limited public view.
4. Require authentication and durable rate limiting on `/api/chat`; stop logging message bodies; enforce per-user/tenant quotas.
5. Decide and implement the tenant membership model before Phase 1. Do not build property tables on the current owner-only/global-admin ambiguity.
6. Fix scheduling to use the chosen membership/organization model.
7. Reconcile `business.json`, the property AI manifest, `PROJECT_CONTEXT.md`, and `MASTERPLAN.md` before domain development.

### Framework extraction preparation

8. Inventory generic runtime code and classify it as package, module, generated template, or project-owned code.
9. Reduce local skills to a curated allowlist and pin every source to an immutable commit/hash.
10. Replace duplicated agent rules with generated adapters from one workflow/architecture model.
11. Correct migration path assumptions in sync tooling and add machine tests for incoming/outgoing upgrade plans.
12. Make CI block on tests, type-check, lint, schema validation, migration checks, dependency audit thresholds, and secret scanning.

### Independent build sequence

13. Build the manifest/schema validator and `doctor` command first.
14. Build one thin Next.js/Supabase project template and three modules only: auth, organizations/membership, and RBAC/audit.
15. Add the migration registry, RLS test harness, and upgrade planner.
16. Add generated Claude/Codex adapters only after CLI workflows are deterministic.
17. Validate the framework against two deliberately different sample apps before adding AI, BIR, scheduling, billing, or marketing modules.

## Final conclusion

The inspected clone demonstrates a strong instinct for explicit context, repeatable workflow, ownership, provenance, and guarded synchronization. Its central lesson is also its central limitation: a framework cannot rely on agents reading the right Markdown and interpreting it consistently. Flower should preserve the intent of those practices while moving the guarantees into schemas, code, tests, policy checks, versioned modules, and transactional workflows.

The correct clean-room path is to write a fresh specification around the engineering problems observed here, use public platform APIs and original implementations, and avoid copying proprietary prompts, scripts, naming, or hidden behavior from private DannFlow.
