# Flower Project Experience and Governance Specification

## Status

The complete capability remains proposed for Phase F12. ADR 0047 implements only a bounded, repository-local agentic foundation: a verified skill-package loader, one inspect-only first-party skill, and generated agent instructions. Remote catalogs, third-party installation, hooks, Husky, design governance, and policy/consent scaffolding remain unimplemented.

## 1. Purpose

Flower should help a project establish a dependable development experience and a reviewable product-governance baseline without turning agent prose, Git hooks, design references, or generated legal text into hidden sources of authority.

The capability has five related surfaces:

1. agent adapters and curated skills;
2. typed lifecycle hooks and an optional Husky adapter;
3. a provenance-aware UI/UX inspiration library;
4. structured product, data, cookie, and legal-policy inputs;
5. reviewable policy pages and consent behavior.

These surfaces share planning, ownership, provenance, approval, validation, and update requirements. They remain optional: a Flower project must continue to work without AI tooling, Git hooks, design references, analytics, or generated policy documents.

## 2. Architectural placement

The existing Flower workflow engine and project manifests remain canonical. Tool-specific agent files, installed skill views, Husky scripts, design briefs, and rendered policy pages are projections or project-owned outputs.

```text
validated project facts + policies + workflows
                    |
          deterministic plan and lock
                    |
       +------------+-------------+
       |            |             |
 agent/skill     hook/Husky    reports and drafts
 adapters        adapters       for human review
```

An adapter may improve usability, but it cannot grant permissions, introduce an undeclared external effect, bypass approval, weaken a required check, or become the only place where a rule exists.

## 3. Required invariants

- Every mutation supports deterministic planning, dry-run output, stale-plan rejection, journaling, rollback, and idempotent reapplication.
- Every generated path is declared in `.flower/ownership.json`; existing project-owned paths are never silently replaced.
- Remote sources are pinned to immutable revisions and verified by digest before their contents are used.
- Symbolic links, path escapes, control characters, oversized packages, and undeclared executables are rejected.
- Secrets, access tokens, private prompts, browsing history, and agent conversation memory never enter manifests, locks, generated files, or journals.
- Local Git hooks are convenience and feedback mechanisms, not security boundaries. Required checks are repeated in CI.
- Design references do not authorize copying third-party assets or imitating a protected product.
- Generated policy text is a reviewable draft based on declared facts, not legal advice or a compliance certification.
- A policy cannot be marked publishable while required facts, placeholders, jurisdiction choices, or human approvals are unresolved.

## 4. Canonical data

Phase F12 introduces a versioned `.flower/experience.json` manifest and a generated `.flower/experience.lock.json` file. A future schema decision may split the manifest if independent evolution proves necessary.

The manifest records identifiers and configuration, not copied remote content:

```json
{
  "schemaVersion": 1,
  "skills": {
    "enabledSets": ["flower/core-development"],
    "allowProjectSkills": true
  },
  "hooks": {
    "workflow": ["validate.before", "apply.after"],
    "git": {
      "adapter": "husky",
      "preCommit": ["checks.staged"],
      "prePush": ["checks.required"]
    }
  },
  "design": {
    "inspirationManifest": "docs/design/inspiration/manifest.json"
  },
  "policies": {
    "facts": "docs/policies/product-facts.json",
    "documents": ["privacy", "terms", "cookies"]
  }
}
```

The lock records resolved package versions, immutable source revisions, licenses, input digests, output digests, compatibility ranges, and generator versions. It never stores credentials or personal data collected by the application.

## 5. Agent and skill capability

### 5.1 Agent model

Flower does not ship an autonomous authority. It generates bounded views for supported agents from the existing workflow, ownership, architecture, project-context, and decision inputs.

An enabled agent adapter declares:

- supported workflow actions and external effects;
- readable and writable path capabilities;
- approval and user-presence capabilities;
- supported skill format and hook events;
- output paths and generator version;
- missing capabilities that must block generation or execution.

Agent adapters remain deterministic and disposable. Project intent belongs in canonical files and project-owned notes, never solely in `AGENTS.md`, `CLAUDE.md`, or another tool-specific file.

### 5.2 Skill packages

A Flower skill is a bounded instruction and resource package with a manifest. It declares:

- a stable skill id and semantic version;
- purpose, triggers, non-triggers, and required capabilities;
- compatible Flower and adapter versions;
- files, sizes, and SHA-256 digests;
- immutable source revision, author, license, and provenance;
- optional scripts, which are inert until mapped to a registered Flower action;
- required reads, writes, network access, external effects, and approvals.

Official and third-party skills use the same contract. Third-party skills are disabled until explicitly trusted and installed from a verified catalog. Installation never runs package lifecycle scripts or skill-provided commands implicitly.

Flower enforces configurable limits on skill count, total bytes, individual file size, and recursive references. This prevents the unbounded skill inventories and ambiguous routing criticized in the architecture audit.

Proposed commands:

```text
flower skills search
flower skills inspect <skill>
flower skills add <skill> --dry-run
flower skills sync --dry-run
flower skills remove <skill> --dry-run
flower skills validate
```

Adapters may materialize tool-specific skill views only beneath generated ownership. Project-authored skills use project-owned paths and are referenced rather than overwritten.

## 6. Hook system

The term `hook` has three explicit meanings; implementations must not conflate them.

### 6.1 Workflow lifecycle hooks

Lifecycle hooks attach registered Flower actions to typed events such as validation, planning, application, recovery, and completion. Each hook declares inputs, reads, writes, external effects, timeout, failure behavior, and rollback support.

Hooks cannot contain arbitrary shell text. A hook that mutates state becomes part of the enclosing plan and transaction. External effects require the same approval boundary as an ordinary workflow step.

### 6.2 Agent hooks

Agent runtimes may expose tool-specific events. Flower adapters can project a lifecycle hook only when the runtime capability profile supports the event faithfully. Unsupported events are blocking diagnostics; an adapter must not simulate them with prose.

Agent hooks cannot capture prompts, responses, or memory unless a separate project-owned policy explicitly enables a bounded, redacted artifact. The default is no capture.

### 6.3 Git hooks and Husky

Husky is an optional package-manager adapter that installs thin repository-local Git-hook wrappers. The wrappers invoke only registered Flower checks using locally pinned dependencies.

Initial events are:

- `pre-commit`: deterministic staged-file checks with no network access and no automatic rewrite;
- `commit-msg`: optional project-owned message policy;
- `pre-push`: bounded required checks that are also enforced by CI.

The adapter must:

- detect existing Git hooks and block on unresolved overlap;
- never modify global Git configuration;
- pin Husky and every invoked tool;
- work on supported Windows, macOS, and Linux shells;
- avoid secrets and network access by default;
- clearly report that `--no-verify` can bypass local hooks;
- keep CI as the authoritative enforcement surface;
- remove only pristine generated wrappers when disabled.

## 7. UI/UX inspiration library

Projects may maintain `docs/design/inspiration/manifest.json` as a project-owned record. Each entry includes:

- stable id, title, source URL or approved local path, creator, and capture date;
- source type, license or usage status, attribution requirements, and reviewer;
- observed interaction or visual pattern;
- why the pattern is relevant and what must not be copied;
- target screens or user journeys;
- accessibility, responsive, localization, motion, and performance notes;
- optional content digest for an approved local artifact;
- status: `candidate`, `accepted`, `rejected`, or `retired`.

Flower stores references and design reasoning by default, not downloaded website copies. Screenshots, fonts, icons, photos, illustrations, and other third-party assets may be committed only when the project records a permitted basis and attribution requirements. Unknown rights fail closed for reuse.

Flower may derive a reviewable design brief, vocabulary, and token proposal. It does not generate a pixel-for-pixel clone, treat popularity as evidence of usability, or replace accessibility and user testing.

Proposed commands:

```text
flower design inspiration add --dry-run
flower design inspiration validate
flower design brief --dry-run
```

## 8. Product policy and legal-document system

### 8.1 Policy facts

Policy generation begins with project-owned facts, including:

- legal operator identity, contact details, product name, audience, and supported regions;
- application roles, eligibility and age rules;
- data categories, sources, purposes, legal bases where applicable, recipients, and disclosures;
- subprocessors, hosting regions, international transfers, and safeguards;
- retention periods and deletion behavior;
- account, user-content, moderation, payment, marketplace, and termination behavior;
- every cookie or similar storage technology, provider, purpose, duration, category, and first- or third-party status;
- analytics, advertising, profiling, automated decisions, and location processing;
- data-subject request and complaint procedures;
- effective date, policy version, governing jurisdiction, and designated human reviewer.

Flower must not infer these facts from dependencies alone. Scans may propose evidence or flag inconsistencies, but a responsible project owner confirms the facts.

### 8.2 Document set

The initial document types are:

- privacy notice;
- terms and conditions or terms of service;
- cookie notice and preference explanation;
- acceptable-use and community rules when user content exists;
- data-retention summary;
- accessibility statement;
- third-party notices and open-source attribution;
- contact, complaints, and data-request instructions.

Only applicable documents are enabled. Templates are jurisdiction profiles with source citations and review dates, not universal legal language.

For a Philippine profile, the starting references include the Data Privacy Act of 2012, its implementing rules, and current National Privacy Commission guidance. Other jurisdictions require their own reviewed profiles. For example, a UK/EU-facing cookie profile must distinguish strictly necessary storage from non-essential storage and must not activate the latter before valid consent where the applicable rule requires it.

### 8.3 Ownership and review

The first scaffold creates project-owned policy drafts. Flower never silently overwrites edited legal text. Later framework updates produce a three-way comparison or proposed patch for explicit review.

Every document records:

- source facts digest;
- template and jurisdiction-profile versions;
- status: `draft`, `legal-review`, `approved`, `published`, or `retired`;
- reviewer identity or project role;
- approval and effective dates;
- superseded version, when applicable.

`flower policies validate` checks completeness, unresolved placeholders, stale facts, required document links, review state, and declared cookie behavior. Passing validation means the project satisfies Flower's contract; it does not certify legal compliance.

### 8.4 Consent runtime contract

An optional consent module may provide:

- versioned acceptance records for terms and privacy acknowledgements when required;
- separate cookie categories with necessary storage enabled independently;
- no non-essential cookie or tracker activation before the applicable consent decision;
- equally accessible accept, reject, and preference controls where required;
- withdrawal and later preference changes;
- accessible keyboard operation and plain-language labels;
- server-side enforcement where a client-only control would be bypassable;
- auditable policy version, choice, timestamp, and minimal evidence without storing raw browsing history.

Consent records must not be treated as proof that consent was the correct legal basis. Dark patterns, bundled unrelated consent, preselected non-essential categories, and consent walls are not generated defaults.

Proposed commands:

```text
flower policies init --dry-run
flower policies validate
flower policies render --dry-run
flower policies diff
flower consent audit
```

## 9. Security and abuse cases

The conformance suite includes:

- malicious skill text attempting to expand permissions or override policy;
- changed remote skill bytes under an unchanged version;
- executable or lifecycle-script smuggling;
- hook command injection and shell portability failures;
- existing Git-hook and adapter conflicts;
- rollback after partial skill or hook materialization;
- unlicensed or unattributed design assets;
- stale, missing, contradictory, or unresolved policy facts;
- a non-essential tracker firing before consent;
- inaccessible or asymmetrical consent choices;
- unsafe redirect and policy-version downgrade attempts;
- secrets or personal data appearing in plans, locks, logs, or journals.

## 10. Testing and acceptance evidence

Required levels are:

- schema tests for every new manifest and package type;
- deterministic plan and digest tests;
- ownership, conflict, rollback, recovery, and idempotency tests;
- adapter golden tests on Windows, macOS, and Linux;
- malicious fixture tests for skill and hook packages;
- accessibility tests for generated consent components;
- browser tests proving non-essential storage is blocked before consent and withdrawn afterward;
- policy fixtures for at least one Philippine application and one materially different jurisdiction profile;
- external pilot evidence without coupling Flower to the pilot's domain.

## 11. Delivery sequence

F12 begins only after the F11 ecosystem contracts can distribute and verify these package types.

1. **F12.1 — Experience manifests and provenance:** schemas, locks, ownership, planning, validation, and updates.
2. **F12.2 — Skills and hooks:** official minimal skill set, typed lifecycle events, adapter capability profiles, and Husky integration.
3. **F12.3 — Design provenance:** inspiration manifest, rights checks, validation, and design-brief projection.
4. **F12.4 — Policies and consent:** factual inventory, jurisdiction profiles, project-owned drafts, consent runtime contract, and audits.
5. **F12.5 — Certification:** cross-platform fixtures, hostile-package tests, two jurisdiction profiles, external pilot, and exit audit.

Pilot applications may develop project-owned versions earlier. Reuse enters Flower only through this specification, an architecture decision, versioned schemas, and independent conformance tests.

## 12. Non-goals

- autonomous agents with authority beyond the existing workflow engine;
- bulk installation of unreviewed community skills;
- arbitrary shell hooks from manifests or remote packages;
- replacing CI with local Git hooks;
- copying third-party interfaces or assets;
- making aesthetic quality claims without user evidence;
- selecting a jurisdiction, legal basis, retention period, or contractual term on the owner's behalf;
- providing legal advice or guaranteeing compliance;
- silently publishing or accepting changed policies;
- loading advertising or analytics merely because a cookie banner exists;
- storing consent evidence, user data, or secrets in Flower framework state.

## 13. Initial authoritative references

Jurisdiction profiles must cite and periodically review primary authorities. Initial research references are:

- [Republic Act No. 10173, Data Privacy Act of 2012](https://officialgazette.gov.ph/2012/08/15/republic-act-no-10173/)
- [National Privacy Commission implementing rules](https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/)
- [National Privacy Commission guidelines on consent](https://privacy.gov.ph/wp-content/uploads/2023/11/NPC-Circular-No.-2023-04_Guidelines-on-Consent_07Nov2023.pdf)
- [UK Information Commissioner's Office cookie guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/)

References are evidence inputs, not embedded legal conclusions. A profile records its retrieval date, reviewed revision, reviewer, and next review trigger.
