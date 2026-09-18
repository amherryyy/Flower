# ADR 0005: Transactional Module Addition

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-18

## Context

After dependency resolution, Flower needs to install module integration files and update project metadata without overwriting project-owned code or leaving a partially installed graph.

## Decision

- A module package is a validated manifest, a module-local configuration schema, and generator sources stored at `generators/<generated-path>`.
- Flower computes a package digest from the manifest bytes and every generator source digest. Plans record the package, source, rendered output, project manifest, lock, and ownership digests.
- `flower add` is valid only in project mode. It resolves the complete requested graph and installs dependencies in topological order.
- Generated targets must be classified as `generated`, must not already exist, and must not already be recorded in the lock file. Parent symbolic links are rejected.
- Project and lock metadata are replaced through temporary and backup files. Any failure removes files created by the operation and restores the original control files. Incomplete recovery writes a partial journal and returns exit code 8.
- Successful operations record module versions and package digests in `.flower/lock.json`, record rendered generated-file checksums, update `.flower/project.json`, and write a local journal.
- Repeating an already satisfied add request is a verified no-op.

## Consequences

- Module installation cannot merge with or overwrite an existing path.
- Generated-file drift can be detected before future removal, regeneration, or update operations.
- Database migrations and package-manager dependencies remain deferred until their dedicated engines can participate in the same transaction safely.
- The initial catalog has one package per module ID; remote catalogs remain out of scope.

## Alternatives considered

- Letting generators write arbitrary paths was rejected because ownership could not be planned or audited.
- Updating the project manifest before generating files was rejected because a failure would advertise an incomplete module.
- Deleting the whole project on failure was rejected because module installation operates on an existing application.

## Review date

Review before implementing module removal and ejection.
