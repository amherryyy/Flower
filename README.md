# Flower

Flower is an independently owned framework for creating, validating, and safely upgrading structured software projects.

This repository currently contains the Phase F0 foundation, Phase F1 diagnostic kernel, and Phase F2 initialization slice:

- `@flower/kernel` for manifest and ownership validation;
- version-aware project manifest loading and forward-only migrations;
- ownership coverage and mutation guards;
- a project-local operation journal with recursive secret redaction;
- deterministic, digest-protected initialization plans;
- transactional template materialization and rollback;
- an npm package-manager adapter;
- a checksum-verified thin Next.js/Supabase template;
- versioned module-manifest validation and deterministic read-only dependency resolution;
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
npm run flower -- add organizations --project ../sample-app --catalog ./modules --dry-run
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

Module packages use a strict manifest, a module-local configuration schema, and generator sources under `generators/<generated-path>`. `flower add` resolves the full dependency graph before writes, verifies package and source digests, enforces generated-path ownership, updates the project manifest and lock together, and rolls back generated files and control metadata on failure. The current repository uses fixture catalogs for contract tests; official capability modules are added in a later F3 slice.

## Current boundary

Phase F2 initializes a thin application shell. Phase F3 now validates module manifests, resolves dependency graphs, and transactionally adds generated module integrations. Remove/eject transactions, official capability modules, database migrations, security baselines, workflow adapters, adoption, and framework updates remain later slices.
