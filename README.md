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

The official catalog contains `auth`, `organizations`, `rbac`, and `audit`. These F3 modules are intentionally thin integration contracts: they declare capabilities, dependencies, configuration shapes, generated boundaries, and checks. They do not yet create database objects or claim runtime authentication, tenant isolation, authorization, or durable auditing. Those migrations and executable security guarantees are F4 work.

The first F4 slice defines the migration registry and pure planner. A manifest migration id maps to one non-empty `migrations/<id>.sql` file; declared SQL participates in the module package digest, and undeclared SQL is rejected. Plans order migrations by the resolved module dependency graph and each manifest's declared order. Applied history must be an exact prefix with matching module version and source digest. Database connections, transaction execution, repair, rollback policy, and RLS verification are not implemented yet.

`flower remove` refuses modules required by another installed module and deletes only generated files that still match their recorded checksums. `flower eject` has the same dependency guard but deliberately preserves current file contents—including project modifications—and transfers each path to exact project ownership. Both commands support dry-run/JSON plans, project-state preconditions, rollback, and local journals.

## Current boundary

Phase F2 initializes a thin application shell. Phase F3 validates module manifests, composes the four official capability contracts, and transactionally adds, removes, or ejects generated integrations. Phase F4 now has a verified migration-file registry and deterministic planner; database execution, official schema migrations, security baselines, workflow adapters, adoption, and framework updates remain later slices.
