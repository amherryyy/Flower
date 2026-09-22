# ADR 0029: Deterministic Framework Version Resolution

## Status

Accepted for Flower 0.1 development.

## Date

2026-09-22

## Context

Phase F6 begins with target-version selection. An update plan cannot be reproducible if release ordering, channel eligibility, or installed-module compatibility is decided implicitly by a registry client or package manager. Resolution must be a pure, reviewable kernel operation before any files, dependencies, manifests, or databases can change.

## Decision

- A release catalog contains explicit semantic versions and `stable`, `preview`, or `development` channels.
- Stable projects accept stable releases. Preview projects accept stable and preview releases. Development projects accept every channel.
- Automatic resolution evaluates eligible non-downgrade releases in descending semantic-version order and selects the highest release compatible with every installed module.
- Compatibility is evaluated against the exact installed module package identity and its declared `compatibleFlower` range. Missing exact package metadata is incompatible and fails closed.
- Every considered release retains a deterministic per-module compatibility evaluation so later update plans can explain selection or rejection.
- An explicitly requested target is evaluated alone. Flower never silently falls back to another version when that target is missing, channel-blocked, a downgrade, or module-incompatible.
- Invalid semantic versions, unsupported compatibility ranges, duplicate release versions, and duplicate module package identities are blocking catalog errors.
- The resolver is read-only. Package acquisition, update planning, plan digests, file merging, migrations, and application remain later F6 slices.

## Consequences

- Equivalent catalogs resolve identically regardless of input ordering.
- A newer incompatible release does not prevent an automatic update to the highest compatible release.
- Operators requesting a specific version receive a blocking explanation instead of an unexpected substitute.
- Release discovery and signature/provenance verification remain outside this pure kernel function and must produce validated catalog input.

## Alternatives considered

- Delegating selection to npm was rejected because package-manager tags do not encode Flower project channels or module compatibility evidence.
- Selecting the newest release before checking modules was rejected because it produces unusable plans when a lower compatible release exists.
- Silently falling back from an explicit target was rejected because it violates operator intent.
- Treating missing installed-module metadata as compatible was rejected because update safety could not be demonstrated.

## Review date

Review when signed release catalogs or module replacement/removal decisions are introduced.
