# 0018: Supply-chain policy and immutable CI

## Status

Accepted

## Context

Flower requires committed lockfiles, dependency-audit thresholds, license checks, and immutable action references. The existing security command was deliberately offline and only checked dependency declarations and lockfile format, while CI referenced moving action tags and did not query an advisory service.

## Decision

The versioned security baseline now declares an integrity requirement, an exact allowlist for lockfile-declared licenses, an unknown-license disposition, and a vulnerability audit level. The offline gate evaluates every non-link `node_modules` entry in the npm lockfile. It requires supported Subresource Integrity digests when enabled and rejects missing or non-allowlisted license metadata.

The same baseline declares CI workflow patterns and requires remote actions to use full 40-character commit digests. Local actions remain valid relative references; Docker actions must use a SHA-256 image digest. Workflows must explicitly default `contents` permission to `read` and contain the dependency-audit command corresponding to the declared threshold.

Repository and starter workflows pin the existing checkout and Node setup action versions to their immutable commits. CI runs `npm audit --audit-level=high` against npm's live advisory service. The offline Flower result continues to report `vulnerabilityDatabase: "not-configured"`; only the CI audit makes a live vulnerability determination.

## Consequences

Projects fail the offline security gate when installed packages lack accepted integrity or license metadata, when workflow actions float, or when required CI controls are absent. License decisions are explicit project policy rather than a legal compatibility claim. Registry compromise, malware, stale advisory data, SPDX-expression interpretation beyond exact configured strings, and live audit availability remain outside the offline gate.
