# ADR 0001: Phase F0 Toolchain

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-18

## Context

Flower needs a cross-platform kernel and CLI with schema validation, stable diagnostics, and no runtime dependency on an external service. The first supported implementation environment must work on Windows, macOS, Linux, and CI.

## Decision

- Implement the kernel and CLI in strict TypeScript using Node.js APIs.
- Use npm workspaces for the initial repository because npm ships with Node and minimizes bootstrap requirements.
- Use JSON Schema Draft 2020-12 with Ajv for manifest validation.
- Use Vitest for unit and CLI integration tests.
- Build ESM packages using TypeScript's NodeNext module resolution.
- Keep project validation offline at runtime.

## Consequences

- Contributors need a supported Node.js version and npm.
- Schema behavior is deterministic and can be shared with editors and other tools.
- Runtime validation adds Ajv as a kernel dependency.
- The workspace manager can be revisited before public package publication if scale or release tooling requires it.

## Alternatives considered

- A Bash-based CLI was rejected because it would make Windows a second-class platform.
- A framework-specific configuration file written in TypeScript was rejected because it would execute project code during validation.
- Handwritten validation was rejected because it would duplicate published schema behavior.

## Review date

Review before the first public Flower release.
