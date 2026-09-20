# ADR 0022: PostgreSQL CI certification

- Status: accepted
- Date: 2026-09-19

## Decision

Flower runs a dedicated job on GitHub's Ubuntu 24.04 image, starts its preinstalled PostgreSQL 16 service, and applies every official migration to an empty database. A minimal Supabase-compatible fixture supplies `auth.users`, `auth.uid()`, and the `anon`, `authenticated`, and `service_role` roles.

The certification seeds an organization owner, member, outsider, and audit event through official workflows. It asserts member and outsider organization visibility, permission-gated audit visibility, final-owner protection, and RLS enablement on all seven protected tables. Any SQL or assertion error fails the job.

The fixture also exposed that the append function required a generated audit id. Migration `audit-004` adds `gen_random_uuid()` as the table default rather than rewriting an already published migration.

## Consequences

CI now executes official SQL against real PostgreSQL rather than treating mock-client tests as database proof. The fixture is intentionally narrower than hosted Supabase and does not certify provider extensions, deployment networking, backups, or production concurrency. Local environments without PostgreSQL can still run the deterministic unit suite.

The first hosted run proved the PostgreSQL job and exposed an independent clean-checkout ordering issue: `flower:security` requires the compiled CLI. CI therefore performs an explicit build after installation and before invoking the security gate, rather than relying on locally retained build output.
