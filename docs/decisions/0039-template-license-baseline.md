# ADR 0039: Reviewed template dependency license expressions

- Status: Accepted
- Date: 2026-09-26

## Context

The Boarding House Finder pilot reproduced a failure in a freshly initialized `next-supabase` project: installation, tests, type-checking, linting, build, and structural validation succeeded, but the generated offline security policy rejected licenses declared by transitive Next.js dependencies. Platform-specific Sharp/libvips packages declare LGPL-containing expressions, and `caniuse-lite` declares `CC-BY-4.0`.

Flower's supply-chain contract deliberately compares lockfile license metadata with exact allowlist strings. ADR 0018 excludes broader SPDX-expression interpretation and makes license selection explicit project policy.

## Decision

The bundled template allowlists the exact additional strings observed in its supported dependency graph:

- `LGPL-3.0-or-later`;
- `Apache-2.0 AND LGPL-3.0-or-later`;
- `Apache-2.0 AND LGPL-3.0-or-later AND MIT`;
- `CC-BY-4.0`.

The checker continues treating compound expressions as opaque exact values. A regression test exercises every newly reviewed string using the template baseline. The template manifest binds the changed security policy with a new digest.

## Consequences

- Fresh projects can satisfy their generated offline security gate after installing the supported Next.js dependency graph.
- Adding a license string is an explicit policy decision, not a legal-compatibility guarantee or a general approval of every package using that license.
- Existing projects retain their protected baseline until a Flower migration or update plan explicitly changes it.
- New dependency versions with different license metadata continue to fail closed and require review.
