# Flower

Flower is an independently owned framework for creating, validating, and safely upgrading structured software projects.

This repository contains the Phase F0 foundation, Phase F1 diagnostic kernel, Phase F2 initialization slice, and Phase F3 module engine:

- `@flower/kernel` for manifest and ownership validation;
- version-aware project manifest loading and forward-only migrations;
- ownership coverage and mutation guards;
- a project-local operation journal with recursive secret redaction;
- deterministic, digest-protected initialization plans;
- transactional template materialization and rollback;
- an npm package-manager adapter;
- a checksum-verified thin Next.js/Supabase template;
- versioned module-manifest validation and deterministic read-only dependency resolution;
- transactional module add, remove, and eject operations;
- official `auth`, `organizations`, `rbac`, `audit`, and `limits` capability contracts;
- checksummed SQL migration packages and deterministic migration planning;
- transactionally applied PostgreSQL migrations behind a driver-neutral client port;
- a node-postgres-compatible pooled-session adapter;
- fail-closed official organization, RBAC, and audit schema migrations;
- versioned migration descriptors with transactional verification queries;
- a PostgreSQL RLS catalog inspection harness;
- explicit membership, RBAC, and audit-read policies plus an actor/tenant scenario runner;
- narrow authorization-management workflows with database-enforced final-owner protection;
- a versioned offline security baseline with redacted secret, dependency, lockfile, and application-header checks;
- durable PostgreSQL rate limits and per-user or per-organization usage quotas with no in-memory fallback;
- versioned upload policies plus server-side name, size, type, signature, and owner validation;
- a fail-closed scan, sanitize, revalidate, and rescan upload pipeline behind injected provider ports;
- immutable service-role operation allowlists with authorization, scoped fields, fixed projections, and metadata-only audit attempts;
- structured, size-bounded logging with allowlisted fields, recursive personal-data redaction, and forbidden request-body or AI-prompt fields;
- lockfile integrity and license-allowlist enforcement plus immutable CI action references;
- a high-severity dependency vulnerability threshold enforced against the live npm advisory service in CI;
- bounded, service-role-only retention for durable rate-limit and usage counters;
- append-only audit events with a validated service-role insertion function and recursive sensitive-field rejection;
- the `flower` command-line interface;
- versioned JSON Schemas;
- valid and invalid fixture projects;
- cross-platform tests and CI.

Flower uses its own `.flower/project.json` and `.flower/ownership.json` files. This keeps the framework subject to the same validation rules as projects built with it.

## Development

```text
npm install
npm run build
npm test
npm run typecheck
```

## CLI

```text
npm run flower -- --version
npm run flower -- doctor .
npm run flower -- status .
npm run flower -- security check
npm run flower -- validate tests/fixtures/valid-project
npm run flower -- validate tests/fixtures/invalid-project --json
npm run flower -- init ../sample-app --name "Sample App" --dry-run
npm run flower -- init ../sample-app --name "Sample App"
npm run flower -- add rbac --project ../sample-app --dry-run
npm run flower -- add rbac --project ../sample-app
npm run flower -- remove rbac --project ../sample-app --dry-run
npm run flower -- eject audit --project ../sample-app --dry-run
```

All commands support `--json` for deterministic automation output. Flower does not require network access or an external service to inspect, validate, or dry-run a project. Initialization installs dependencies and runs the template's tests, type-check, lint, and build by default. Use `--skip-install` only when materializing an offline project for later installation.

`flower security check` validates `.flower/security.json`, scans bounded project text without following symbolic links, redacts detected credential values, checks dependency specifiers, verifies integrity and declared license metadata for installed lockfile packages, and verifies the headers declared by web-application baselines. It also rejects mutable third-party GitHub Action references, missing read-only workflow permissions, absent dependency-audit commands, direct console calls in configured application paths, and object-based log calls that visibly contain forbidden request-body, prompt, message, or form fields. Policy failures use exit code `6`. This is intentionally an offline gate: its JSON summary reports `vulnerabilityDatabase: "not-configured"`, so passing it is not a claim that dependencies are free of published vulnerabilities. CI separately runs `npm audit --audit-level=high` against npm's live advisory service.

Web-project baselines also validate `.flower/uploads.json`. The starter accepts only PNG, JPEG, and PDF signatures up to 10 MiB; runtime validation additionally checks the file name, extension, authenticated user or organization ownership, and actual header bytes before storage. For applications accepting uploads, the inspection workflow then requires an injected scanner to approve the original, an injected sanitizer to produce a new artifact, policy revalidation, and a second clean scan. Flower supplies this fail-closed orchestration contract, not the malware or format-specific engines.

### Initialization options

```text
flower init <target>
  [--name <display-name>]
  [--id <kebab-case-id>]
  [--template next-supabase]
  [--package-manager npm]
  [--dry-run]
  [--skip-install]
  [--git]
  [--json]
```

The target must be missing or empty. Repeating the same initialization against a successfully initialized target is a verified no-op. Flower never merges initialization output into another existing project; that is the responsibility of the future `flower adopt` workflow. A failed initialization rolls back everything it created. A successful run records the verified template digest in `.flower/lock.json` and writes a local operation journal.

Module packages use a strict manifest, a module-local configuration schema, and generator sources under `generators/<generated-path>`. `flower add` resolves the full dependency graph before writes, verifies package and source digests, enforces generated-path ownership, updates the project manifest and lock together, and rolls back generated files and control metadata on failure. The bundled catalog is used by default; `--catalog` can select a fixture or alternate local catalog.

The official catalog contains `auth`, `organizations`, `rbac`, `audit`, and `limits`. The integration contracts declare capabilities, dependencies, configuration shapes, generated boundaries, and checks. F4 migrations create organizations, memberships, organization-scoped roles and permissions, audit events, durable fixed-window rate-limit buckets, and daily or monthly usage counters. Read policies expose organization and RBAC data only to explicit members; audit reads additionally require `audit.read`. Ordinary application roles receive no policy for security-state writes, audit insertion, or limit-counter access.

The F4 migration layer maps each manifest migration id to one non-empty `migrations/<id>.sql` file and one schema-validated `migrations/<id>.json` descriptor. SQL and descriptor digests participate in module package identity. Descriptors declare provider, transaction support, destructive classification, migration dependencies, rollback guidance, verification queries, and RLS expectations. Plans order migrations by the module graph and declared dependencies; destructive actions require explicit per-migration approval.

PostgreSQL execution uses an injected client, a transaction-scoped advisory lock, and the internal `flower_internal.schema_migrations` history table. The executor rechecks the plan, package sources, descriptors, and locked database history before applying SQL. Every declared verification query must return one scalar equal to its expected value before the history row is inserted; any mismatch rolls back the whole plan. Migration and verification SQL cannot contain their own transaction-control statements. The node-postgres-compatible adapter checks out one pool client for the entire operation and discards it after failure. Connection configuration remains application-owned.

The RLS inspection harness reads PostgreSQL catalogs and checks every descriptor-owned table for existence, RLS enablement, public `SELECT`/`INSERT`/`UPDATE`/`DELETE` privileges, and the expected policy mode. The official descriptors now require policies. A separate behavior runner executes each actor/tenant case in its own rolled-back transaction, sets a validated database role and Supabase user claim, and supports both scalar visibility assertions and expected SQLSTATE authorization failures.

Authorization-state tables still have no direct application-role write policies. Instead, private security-definer workflows atomically create an organization with its owner, create roles, manage permissions and memberships, and assign roles after checking explicit organization permissions. Deferred constraint triggers protect direct privileged mutations too: an organization cannot commit without at least one membership whose role carries `organization.owner`.

Audit records use one service-role-only append function; direct mutation privileges are revoked and triggers reject updates, deletes, and truncation. Both the kernel and database recursively reject credential, request-body, prompt, and message fields before persistence. This is defense in depth against application mistakes, not cryptographic tamper evidence against a database owner.

The `limits` module exposes service-role-only security-definer functions for rate limits and usage quotas. Counter updates lock one deterministic bucket row, so concurrent application instances share the same decision. Rate-limit subjects are HMAC-SHA-256 digests produced with a server-only secret; raw IP addresses or tokens are not stored. The kernel fails closed on storage errors and deliberately has no in-memory fallback. A separate batch-limited pruning function removes expired counters under validated retention windows without adding maintenance to the request path. Applications choose policy values, map denials to their HTTP or job protocol, and schedule retention calls.

Privileged application data access goes through an immutable service-role operation registry. Every operation fixes the table, action, returned columns, allowed filters and writes, tenant column, authorization callback, and metadata-only audit attempt. The executor never exposes the raw privileged client and projects adapter results back to the registered columns. Next.js adapters holding the credential must use `import "server-only"`; the starter creates no service-role client by default.

Structured logging uses stable event names and explicit attribute allowlists. Request bodies, raw bodies, AI prompts, message collections, and form data are rejected at any depth rather than merely masked. Configured secret and personal-data keys are recursively redacted, recognizable credentials and contact values are scrubbed from strings, and sanitized events are immutable and size-bounded before reaching an injected sink. Static source checks complement this runtime contract but do not replace data-flow-aware linting or review of third-party loggers.

The official SQL targets Supabase PostgreSQL and expects `auth.users`, `auth.uid()`, `authenticated`, and the service-role boundary to exist. This checkout does not contain Docker, PostgreSQL, or the `pg` package, so policy and workflow SQL plus the behavior state machine are tested here without claiming a live tenant-isolation result. Isolated live execution and seeded member/outsider/anonymous/service-role cases remain required F4 work.

`flower remove` refuses modules required by another installed module and deletes only generated files that still match their recorded checksums. `flower eject` has the same dependency guard but deliberately preserves current file contents—including project modifications—and transfers each path to exact project ownership. Both commands support dry-run/JSON plans, project-state preconditions, rollback, and local journals.

## Current boundary

Phase F2 initializes a thin application shell. Phase F3 validates module manifests and transactionally adds, removes, or ejects generated integrations. Phase F4 now has a verified migration registry, versioned descriptors, deterministic planning, transactional PostgreSQL execution and verification, a node-postgres pool adapter, an RLS inspector, explicit read policies, actor/tenant scenarios, narrow authorization workflows, final-owner enforcement, append-only sensitive-field-safe audit insertion, a deterministic offline security gate, durable rate limits and quotas with bounded retention, fail-closed upload inspection orchestration, a narrow service-role boundary, redaction-safe structured logging, lockfile integrity and license policy checks, immutable CI actions, and a live CI dependency-audit threshold. Live database proof, audit retention and cryptographic tamper evidence, concrete malware/sanitizer providers, data-flow-aware logging lint rules, richer online advisory enrichment, workflow adapters, adoption, and framework updates remain later slices.
