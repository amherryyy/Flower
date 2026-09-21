# ADR 0028: GitHub Actions Verification Projection

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-21

## Context

Flower's canonical feature workflow contains interactive approval, planning, delegation, verification, and journal steps. GitHub Actions is appropriate for repeatable verification but cannot safely or faithfully execute the interactive and write-capable portions of that workflow. Treating the complete workflow as CI instructions would weaken approval and ownership guarantees.

## Decision

- The `githubActions` project adapter generates `.github/workflows/flower-generated.yml` as a verification-only projection.
- The generator reads only check identifiers declared by canonical `checks.run` steps. A framework-owned registry maps known identifiers to fixed commands; workflow data can never provide a shell command.
- An unknown check is a blocking missing capability. It is recorded in the artifact and causes adapter validation and materialization to fail closed.
- Approval, planning, delegation, writes, and all other workflow actions and effects are excluded from the projection.
- The generated workflow uses read-only repository permissions, immutable action commit pins, a bounded timeout, dependency installation, and the security baseline's high-severity dependency audit.
- Generated CI and its checksummed state use the existing transactional adapter materializer, ownership policy, drift detection, rollback, and CLI synchronization path.
- The generated workflow is separate from project-owned CI. Flower does not overwrite `.github/workflows/ci.yml`.

## Consequences

- CI behavior is reproducible from typed workflow data without making YAML or prose a second workflow authority.
- A project can retain broader handwritten CI while enabling a visibly separate Flower verification workflow.
- Adding a canonical check requires an explicit safe mapping before the CI adapter can synchronize.
- Enabling the adapter may duplicate verification already performed by project-owned CI; that cost is explicit and removable by disabling the adapter and synchronizing.

## Alternatives considered

- Translating every canonical workflow action to CI was rejected because approvals and delegated writes cannot preserve their engine semantics there.
- Embedding commands directly in workflow definitions was rejected because it expands untrusted data into a shell execution channel.
- Replacing the existing project-owned CI workflow was rejected because its platform matrix and certification jobs are outside the adapter's narrow contract.
- Silently skipping unknown checks was rejected because CI would appear healthy while enforcing an incomplete contract.

## Review date

Review when a second CI provider is introduced or canonical checks require platform-specific command mappings.
