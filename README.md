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
- official `auth`, `organizations`, `rbac`, and `audit` capability contracts;
- checksummed SQL migration packages and deterministic migration planning;
- transactionally applied PostgreSQL migrations behind a driver-neutral client port;
- a node-postgres-compatible pooled-session adapter;
- fail-closed official organization, RBAC, and audit schema migrations;
- versioned migration descriptors with transactional verification queries;
- a PostgreSQL RLS catalog inspection harness;
- explicit membership, RBAC, and audit-read policies plus an actor/tenant scenario runner;
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

The official catalog contains `auth`, `organizations`, `rbac`, and `audit`. The F3 integration contracts declare capabilities, dependencies, configuration shapes, generated boundaries, and checks. F4 migrations create organizations, memberships, organization-scoped roles and permissions, and audit events. Read policies expose organization and RBAC data only to explicit members; audit reads additionally require `audit.read`. Ordinary application roles receive no policy for security-state writes or audit insertion.

The F4 migration layer maps each manifest migration id to one non-empty `migrations/<id>.sql` file and one schema-validated `migrations/<id>.json` descriptor. SQL and descriptor digests participate in module package identity. Descriptors declare provider, transaction support, destructive classification, migration dependencies, rollback guidance, verification queries, and RLS expectations. Plans order migrations by the module graph and declared dependencies; destructive actions require explicit per-migration approval.

PostgreSQL execution uses an injected client, a transaction-scoped advisory lock, and the internal `flower_internal.schema_migrations` history table. The executor rechecks the plan, package sources, descriptors, and locked database history before applying SQL. Every declared verification query must return one scalar equal to its expected value before the history row is inserted; any mismatch rolls back the whole plan. Migration and verification SQL cannot contain their own transaction-control statements. The node-postgres-compatible adapter checks out one pool client for the entire operation and discards it after failure. Connection configuration remains application-owned.

The RLS inspection harness reads PostgreSQL catalogs and checks every descriptor-owned table for existence, RLS enablement, public `SELECT`/`INSERT`/`UPDATE`/`DELETE` privileges, and the expected policy mode. The official descriptors now require policies. A separate behavior runner executes each actor/tenant case in its own rolled-back transaction, sets a validated database role and Supabase user claim, and supports both scalar visibility assertions and expected SQLSTATE authorization failures.

The official SQL targets Supabase PostgreSQL and expects `auth.users`, `auth.uid()`, `authenticated`, and the service-role boundary to exist. This checkout does not contain Docker, PostgreSQL, or the `pg` package, so policy SQL and the behavior state machine are tested here without claiming a live tenant-isolation result. Isolated live execution, seeded member/outsider/anonymous/service-role cases, final-owner enforcement, and repair workflows remain required F4 work.

`flower remove` refuses modules required by another installed module and deletes only generated files that still match their recorded checksums. `flower eject` has the same dependency guard but deliberately preserves current file contents—including project modifications—and transfers each path to exact project ownership. Both commands support dry-run/JSON plans, project-state preconditions, rollback, and local journals.

## Current boundary

Phase F2 initializes a thin application shell. Phase F3 validates module manifests, composes the four official capability contracts, and transactionally adds, removes, or ejects generated integrations. Phase F4 now has a verified migration registry, versioned descriptors, deterministic planning, transactional PostgreSQL execution and verification, a node-postgres pool adapter, an RLS inspector, explicit read policies, and an actor/tenant scenario runner. Live database proof, write workflows and final-owner enforcement, broader security baselines, workflow adapters, adoption, and framework updates remain later slices.
