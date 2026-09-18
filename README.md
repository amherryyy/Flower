# Flower

Flower is an independently owned framework for creating, validating, and safely upgrading structured software projects.

This repository currently contains the Phase F0 foundation and Phase F1 diagnostic kernel:

- `@flower/kernel` for manifest and ownership validation;
- version-aware project manifest loading and forward-only migrations;
- ownership coverage and mutation guards;
- a project-local operation journal with recursive secret redaction;
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
```

All diagnostic commands support `--json` for deterministic automation output. Flower does not require network access or an external service to inspect or validate a project.

## Current boundary

Phase F1 inspects state and provides kernel safeguards. It does not yet mutate project files. Transactional initialization, dry-run plans, and rollback begin in Phase F2.
