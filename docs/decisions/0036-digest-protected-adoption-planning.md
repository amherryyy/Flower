# ADR 0036: Digest-Protected Adoption Planning

## Status

Accepted for Phase F7.

## Context

Read-only inspection identifies whether an existing project is suitable for adoption, but it does not define the exact ownership boundary or bind later writes to the inspected bytes. Adoption needs a reproducible review artifact before Flower creates control metadata, installs modules, or materializes adapters.

## Decision

- `flower adopt <existing-project> --dry-run` creates a deterministic, digest-protected plan and never writes to the project.
- Planning requires a ready, unmanaged inspection and initially supports npm projects. Other detected package managers fail explicitly rather than receiving npm behavior.
- Every inspected pre-existing regular file is classified as project-owned with `never-overwrite` policy and its byte digest is recorded.
- `.git`, `.next`, `coverage`, `dist`, and `node_modules` are excluded local roots. The plan records this list explicitly.
- Scanning is bounded to 10,000 files, 5 MiB per file, and 64 MiB in aggregate. Symbolic links are not followed and are blocking conflicts.
- The plan binds a canonical inspection digest and a complete classified-project-state digest. Its stable plan ID derives from the full plan payload.
- Planned Flower metadata uses detected stack evidence rather than invented framework choices. Selected modules and adapters are recorded as requested follow-on work; verified module resolution and all writes remain part of the transactional application slice.
- Existing Codex or Claude instructions and existing GitHub Actions workflows block their corresponding requested adapter. Flower will not silently replace them.

## Consequences

- A reviewer can see which existing bytes Flower will protect before authorizing adoption.
- Equivalent inputs and selections produce the same plan, while changed project bytes produce different preconditions and plan identity.
- The planner can be tested independently from filesystem mutation and rollback.
- A plan with state `apply` is eligible for the later application workflow; it is not itself permission to write.

## Rejected alternatives

- Hashing only package manifests was rejected because adoption promises never-overwrite protection for every pre-existing project file.
- Treating dependency and build output as project-owned source was rejected because it would create large, unstable plans for reproducible local artifacts.
- Automatically merging existing CI or agent files was rejected because semantic intent cannot be inferred safely from filenames alone.
- Writing metadata during dry-run was rejected because planning must remain repeatable and observational.

## Review trigger

Review when transactional adoption application defines persisted plan storage, module resolution, reviewed adapter merges, or support for another package manager.
