# RoomScouter Pilot Feedback Audit

## Status

Evidence review completed on 2026-10-01. This is a product-direction audit, not a phase exit audit and not a claim that the proposed controls are implemented.

## Executive verdict

RoomScouter validates Flower's architectural boundaries but exposes a product-experience gap.

Flower correctly kept application-specific listings, favorites, reviews, reports, maps, screens, and role semantics in the pilot. Its ownership, transaction, security, migration, workflow, and adapter contracts provided a sound foundation. The pilot did not justify turning Flower into a boarding-house application generator or a no-code platform.

However, the pilot repeatedly required the developer to manually connect those contracts into a dependable application-delivery loop. The largest delays did not come from writing domain features. They came from environment diagnosis, framework updates, hosted-service setup, database promotion, executable authorization proof, deterministic demo data, browser-test orchestration, upload-policy mismatches, deployment configuration, and unclear recovery instructions.

Flower should therefore become more specific in its first supported product path:

> Flower's first certified application profile should help a team build, verify, update, and deploy a TypeScript Next.js application using npm, Supabase, GitHub Actions, and Vercel, with Windows as a first-class development platform.

This is specificity through a verified profile, not hard-coding RoomScouter's business rules into the kernel. Other stacks may be added only through independently tested profiles or adapters.

The immediate priority remains completion of F7 transactional update application. RoomScouter could not consume an upstream security-baseline correction or safely rename protected project metadata because Flower can plan updates but cannot yet apply them through a complete user-facing transaction. Adding more broad capabilities before closing that loop would repeat the pilot's main failure.

## Meanings of faster and more efficient

The audit uses two separate measures:

1. **Delivery efficiency:** reduce repeated setup, diagnosis, validation, migration, test, pull-request, and deployment work while preserving review and approval boundaries.
2. **Runtime efficiency:** detect avoidable request waterfalls, repeated provider calls, inconsistent upload limits, and missing loading states before they become visible production delays.

Flower must not improve apparent speed by skipping security tests, hiding provider mutations, weakening approvals, or silently selecting defaults.

## Evidence and limitations

The review used the RoomScouter repository, its architecture and decision records, pilot findings, generated Flower state, scripts, tests, deployment handoff, and the observed development record through the public discovery UI redesign. It includes local and hosted problems that were reproduced or directly observed during the pilot.

The review does not treat every inconvenience as a framework defect. GitHub account administration, paid email delivery, product-specific visual design, legal advice, and RoomScouter's domain rules remain outside Flower's ownership. Where a reusable control is proposed, it must still receive an independent Flower architecture decision and framework-owned tests.

## What worked

- Flower's protected ownership model prevented direct edits to generated metadata and made the missing rename/update path visible instead of allowing silent drift.
- Application-wide `student`, `owner`, and `admin` roles stayed project-owned instead of being forced into Flower's organization-scoped RBAC module.
- Transactional module, migration, adoption, journal, and adapter contracts supplied reusable primitives without absorbing RoomScouter's domain.
- The generated security baseline caught a real license-policy mismatch. The upstream correction was reviewed independently in ADR 0039.
- The pilot evolved from source-pattern tests to executable authorization tests and then to real local Supabase and browser journeys without weakening the earlier fast test tiers.
- Local-only seed guards, explicit hosted migration dry runs, and separate deployment approvals protected the hosted database.

## Challenge register

| ID | Observed challenge | Effect on the pilot | Framework interpretation | Recommended Flower control | Priority |
| --- | --- | --- | --- | --- | --- |
| P-01 | A generated project's license policy rejected supported transitive Next.js dependencies. | A fresh project passed build checks but failed Flower security validation. | Template and policy compatibility is Flower-owned. ADR 0039 fixed the baseline, but existing projects still need an update path. | Finish transactional update application and certify every template dependency graph against its generated security policy. | P0 / F7 |
| P-02 | Protected project branding retained the original pilot name after the product became RoomScouter. | The product and Flower metadata disagree, while direct edits are correctly forbidden. | Protected metadata changes require an engine-owned migration. | Add a reviewed project-identity migration to update application while preserving the stable internal identifier unless an explicit identity migration is approved. | P0 / F7 |
| P-03 | The pilot could not initially invoke an installed, released Flower CLI. | Security and architecture validation depended on the framework checkout or was postponed. | Installation and distribution are Flower-owned. | Publish traceable prerelease packages and support a documented clean-machine invocation without cloning Flower. | P1 / F8 |
| P-04 | PowerShell blocked `npm.ps1`, line-ending conversion changed template bytes, repository ownership triggered Git's safety check, and generated `next-env.d.ts` repeatedly dirtied the tree. | Setup and validation failed for Windows-specific reasons unrelated to application behavior. | Flower cannot change global OS or Git policy, but it can diagnose supported-host hazards and generate stable repository policy. | Provide a Windows-aware doctor, use executable-safe command resolution, generate `.gitattributes`, classify transient generated files, and report exact operator-owned remediation without weakening Git safety. | P1 / F8 |
| P-05 | The user repeated separate install, type generation, tests, typecheck, build, security, and status commands after most changes. | Correctness was achievable but slow and easy to perform incompletely. | Verification composition is Flower-owned; individual tool implementations are not. | Define one profile verification plan with named fast, database, browser, and release tiers; retain individual commands for diagnosis and JSON automation. | P1 / F8 |
| P-06 | Early identity tests inspected SQL text rather than executing actor behavior. | Regular-expression checks could not prove anonymous, student, owner, and admin isolation. | Flower should provide reusable authorization-test contracts, not application role rules. | Supply a PostgreSQL/Supabase actor-matrix test kit that executes grants, RLS, security-definer functions, and expected denials. | P1 / F9 |
| P-07 | Docker was initially absent, while full Supabase behavior was still required later. | Fast database work and full provider verification were conflated; progress paused around local infrastructure. | A certified profile needs explicit test tiers and capability checks. | Keep a fast embedded PostgreSQL-compatible tier where valid, but require local Supabase for Auth, Storage, and final provider certification. Doctor must distinguish missing, stopped, and healthy infrastructure. | P1 / F9 |
| P-08 | Supabase migrations were repeatedly dry-run, applied, types regenerated, and retested through manual steps. SQL intended for the Supabase editor was accidentally entered in PowerShell. | Safe operations were verbose, and execution context was unclear. | Flower can orchestrate reviewed steps while preserving provider approval. | Produce an immutable environment-targeted migration plan that names the execution surface, requires approval before hosted mutation, regenerates types, runs configured verification, and records evidence. | P1 / F9 |
| P-09 | Email confirmation settings, redirect URLs, default-provider quotas, and generic registration errors blocked authentication testing. | Users were deleted and recreated while the real provider limitation remained unclear. | Flower cannot supply free SMTP or bypass quotas. It can verify configuration and expose provider failures safely. | Add an auth-readiness check for URLs, confirmation mode, redirects, provider quota assumptions, local test identities, and safe error mapping. | P1 / F9 |
| P-10 | The first administrator required a privileged, repeatable provisioning path. | Public registration could not safely create the role, and the operator needed a clear execution procedure. | Privileged bootstrap patterns are reusable; application role names are not. | Provide a tested privileged-bootstrap recipe with explicit execution surface, idempotency, audit evidence, and proof that public clients cannot invoke it. | P2 / profile kit |
| P-11 | A 203 KB image upload failed with only “The photo could not be uploaded.” The Storage insert policy depended on metadata that was not reliable at the policy decision point. | A valid small file was rejected; unit tests that inserted rows directly did not reproduce the Storage API behavior. | Cross-layer upload contracts and provider tests are reusable. | Cross-check browser, server-action, hosting, bucket, and policy limits; flag RLS dependence on unstable provider metadata; require at least one real Storage API integration fixture; emit safe diagnostic codes. | P1 / F9-F10 |
| P-12 | Demo seeding first used the wrong role and then lacked table permission. | Browser tests could not begin even though unit tests passed. | Deterministic fixtures and target safety are profile concerns. | Define role-explicit fixture manifests, a loopback-only destructive seed/reset guard, post-seed assertions, and a clear refusal for linked or hosted targets. | P1 / F9 |
| P-13 | Browser journeys failed because of ambiguous accessible labels, duplicate visible text, missing fixture assumptions, and later password-toggle accessibility changes. | Tests were brittle and later journeys were skipped after the first failure. | Flower should standardize test harness quality, not product selectors. | Provide a browser-test adapter with deterministic seed identity, isolated startup, semantic-selector guidance, artifact retention, serial-role workflow support, and exact failure-stage reporting. | P1 / F8-F9 |
| P-14 | An already-running Next.js server blocked the test server. Successful tests sometimes ended with a frightening but non-failing stream-closure message. | Developers had to find and terminate a PID manually and interpret noisy output. | Process lifecycle and diagnostic classification are developer-experience concerns. | Preflight configured ports, reuse only a verified compatible server, stop only a process started by Flower, and separate warnings from failing exit status. | P1 / F8 |
| P-15 | Vercel project naming, generated domains, production-branch behavior, environment variables, and Supabase redirect URLs were configured manually. | Deployment worked, but readiness depended on dashboard navigation and memory. | The approved F9 scope owns environment and deployment planning, not autonomous deployment. | Add a Vercel/Supabase profile that validates environment names and origins, previews changes, checks redirect consistency, identifies the production branch/domain, and performs post-deploy verification. | P1 / F9 |
| P-16 | Vercel rollback and Supabase migration rollback are independent. | A web rollback could not truthfully promise a database rollback. | Flower must document and verify recovery boundaries. | Deployment plans must state which components are reversible, require backup readiness for destructive migration classes, and never label separate provider operations atomic. | P1 / F9-F10 |
| P-17 | Production-like pages felt slow because independent provider reads and signed-photo URL work occurred sequentially. | Correct pages responded slowly until queries were parallelized or batched. | Runtime performance needs measurable profile checks, not generic promises. | Record route budgets, flag configured sequential provider-call patterns where evidence is reliable, measure browser navigation, and require loading/error/empty states for designated remote-data routes. | P2 / F9 profile |
| P-18 | UI references arrived after functional screens, and placeholder pages diverged from the team's evolving design. | Rework increased, although the business workflows were already stable. | Provenance and design handoff belong to F12; product aesthetics remain project-owned. | Preserve the F12 design-reference registry, accessibility notes, and rights status. Do not block F7-F9 delivery on automatic UI generation. | P2 / F12 |
| P-19 | Every feature branch required repetitive PR wording, squash-merge synchronization, and branch-deletion interpretation. Squash merges made local ancestry warnings confusing. | Safe Git practice became a long sequence of manual instructions. | Flower must not mutate remotes without authority, but can explain repository state and prepare artifacts. | Generate a release/PR evidence summary, identify squash-merge state, and recommend the next safe local action. Keep push, merge, and remote deletion explicitly operator-controlled. | P2 / F8 |
| P-20 | The team requested agents, skills, hooks, Husky, design references, terms, privacy, cookies, and consent while the update and deployment loops were incomplete. | Broad feature pressure risked diverting the critical delivery path. | These are valid reusable concerns already bounded by F12, but they are not the immediate bottleneck. | Keep F12 after the delivery path unless a new ADR changes dependencies. Build the verified project loop first. | P2 / F12 |

## Root-cause analysis

### 1. Verified primitives exist, but the user journey between them is incomplete

Flower has strong internal contracts for plans, digests, ownership, rollback, migrations, security, workflows, and adapters. RoomScouter's main friction occurred between those contracts: installing the CLI, selecting the correct environment, starting dependencies, applying reviewed changes, regenerating derived artifacts, choosing the right test tier, and explaining the next safe action.

The correction is not a looser “run everything” script. It is an engine-owned, inspectable workflow composed from the existing typed contracts.

### 2. General interfaces were sometimes substituted for certified integrations

The pilot needed specific Supabase Auth, Storage, PostgreSQL, local CLI, hosted project, and Vercel behavior. Generic database or upload reasoning could not prove those provider semantics. Flower should keep adapter boundaries but certify the first concrete adapter set end to end.

### 3. Static checks were useful but insufficient for runtime boundaries

SQL pattern tests, manifest validation, and direct table fixtures caught structural mistakes. They did not prove RLS actor behavior, Storage API policy evaluation, browser accessibility, provider redirects, or hosted configuration. Each critical boundary needs the cheapest meaningful executable tier and an explicit statement of what it does not prove.

### 4. Diagnostics often named the symptom instead of the failing layer

“Registration could not be completed” and “The photo could not be uploaded” protected internal details but did not give operators a safe correlation code or category. A good Flower profile should distinguish configuration, provider quota, authorization, validation, infrastructure, and unknown failure without exposing secrets to end users.

### 5. Cross-layer constraints drifted

Upload size and type limits existed in several places. Auth URLs existed in both application and provider settings. Database migrations, generated types, tests, and deployed code were related but operated independently. Flower should make these declared relationships verifiable.

## Required product direction

### Initial certified profile

The first profile is intentionally narrow:

- TypeScript and the Next.js App Router;
- npm with a committed lockfile;
- Supabase local development and one linked hosted project;
- PostgreSQL migrations, generated database types, Auth, and Storage;
- GitHub Actions for required verification;
- Vercel preview and production deployment;
- Windows, macOS, and Linux, with Windows PowerShell behavior tested explicitly.

Support outside this profile remains possible at the kernel boundary, but Flower documentation and diagnostics must not imply certification without conformance evidence.

### Concrete operator journeys

The profile should eventually expose cohesive workflows equivalent to the following outcomes. Command names are illustrative until separately approved by CLI decisions.

1. **Doctor:** identify tool versions, execution-policy hazards, line endings, package manager, Docker/Supabase health, port conflicts, linked environment, missing variables, and dirty generated artifacts without mutating the project.
2. **Verify:** run the declared verification tier in dependency order and produce one human summary plus stable JSON evidence.
3. **Database plan/promote:** bind migrations, target identity, generated types, approval, verification, and recovery limitations into one reviewed journaled operation.
4. **Auth readiness:** prove local callback and password-recovery paths, validate hosted redirect configuration evidence, and state email-provider limitations.
5. **Seed and browser proof:** refuse non-loopback destructive targets, install deterministic role fixtures, run representative user journeys, and preserve failure artifacts.
6. **Deploy readiness:** reject local URLs and browser-exposed secrets, compare Vercel and Supabase origins, show the target branch/domain, and run post-deploy checks.
7. **Update:** plan and transactionally apply Flower/template changes so a pilot can consume framework fixes without editing protected state.

### Performance contract

Runtime efficiency must be evidence-based and configurable per project:

- designate critical routes and record navigation/server-response budgets;
- declare remote-data dependencies for those routes;
- report avoidable sequential work when the adapter can prove independence;
- cross-check upload limits across the layers represented in the profile;
- require loading, error, empty, and success behavior for designated remote-data screens;
- retain measurements as comparison evidence rather than making universal speed claims.

Flower should report regressions against an approved project baseline. It should not promise that every generated application is “fast” or optimize arbitrary product queries automatically.

## Prioritized action plan

### P0 — Close the update loop before expanding scope

1. Complete `flower update --plan` and `flower update --apply` over the verified F6 contracts.
2. Add failure injection for filesystem, package-manager, manifest, module, adapter, and journal stages.
3. Add the protected project-display-name migration scenario.
4. Prove that the RoomScouter-style license-baseline correction can be planned and applied without changing project-owned bytes.
5. Publish an F7 exit audit before calling update support complete.

### P1 — Make the certified project loop usable

1. In F8, publish the CLI and introduce the cross-platform doctor and composed verification evidence.
2. In F9, implement the initial Next.js/Supabase/Vercel profile with environment identity, migration promotion, auth readiness, local-only seed, executable RLS, real Storage, browser journey, and deployment readiness checks.
3. Treat profile claims as certification claims backed by fixtures on every supported operating system.
4. Use the existing workflow engine, approvals, journals, adapters, and ownership model instead of creating a second orchestration system.

### P2 — Improve runtime and team experience after the core loop

1. Add configurable performance evidence for critical routes and provider-call composition.
2. Generate PR/release verification summaries without pushing or merging automatically.
3. Continue F10 operational hardening and F12 project experience/governance in their approved order.

## Acceptance measures

The direction is successful only when independent fixtures demonstrate all of the following:

- a clean supported Windows, macOS, and Linux machine can install and invoke Flower through documented package commands;
- a supported project can move from clone to a diagnosed, locally verified state without consulting undocumented chat instructions;
- every failure names the failing layer, affected target, safe next action, and whether any mutation occurred;
- local seed/reset cannot operate against a linked or non-loopback database;
- authorization proof executes real actor behavior rather than relying only on SQL text inspection;
- Storage proof uses the provider API, not only direct metadata-row insertion;
- hosted migration and deployment operations bind an explicit environment identity and require approval;
- an upstream Flower/template correction can update a pilot transactionally while preserving project-owned bytes;
- performance checks compare approved project budgets and retain evidence without claiming universal optimization;
- JSON and human-readable results describe the same plan and outcome.

## Non-goals

- absorbing RoomScouter's property, review, report, favorite, map, moderation, or UI business logic;
- supporting every frontend, package manager, database, host, or operating system without conformance tests;
- creating GitHub, Supabase, Vercel, SMTP, or Docker accounts for the user;
- bypassing Git safe-directory checks, PowerShell policy, provider quotas, or required approvals;
- silently applying hosted migrations, deploying production, pushing commits, merging pull requests, or deleting branches;
- replacing product design, accessibility review, legal counsel, incident response, or provider documentation;
- claiming atomic rollback across Vercel and Supabase where the providers do not offer one transaction.

## Recommended next Flower iteration

The next implementation iteration should remain F7, not receive a new phase name. Its bounded goal is:

> Transactionally apply one real pilot-derived framework update—including a protected metadata migration and a generated security-baseline change—with dry-run evidence, stale-plan rejection, rollback, recovery, and unchanged project-owned bytes.

That slice addresses the most consequential pilot blocker and creates the delivery mechanism needed by every later certified profile. After its tests and exit audit pass, F8 can package the workflow and make the clean-machine developer experience concrete.

