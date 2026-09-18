# ADR 0015: Durable rate limits and usage quotas

- Status: accepted
- Date: 2026-09-19

## Context

Authentication routes and paid APIs need abuse controls that remain correct across processes and serverless instances. An in-memory fallback resets during deployment, partitions limits by instance, and fails open when shared storage is unavailable. Sensitive subjects such as IP addresses must not be stored in raw form. Paid usage also needs daily or monthly limits attached to a user or organization.

## Decision

Flower provides the official `limits` module, depending on `organizations`. Its PostgreSQL migration creates two RLS-enabled, deny-by-default counter tables and two `flower_private` security-definer functions:

- `consume_rate_limit` uses fixed windows and a locked counter row for IP, user, or organization subjects;
- `consume_usage_quota` uses UTC daily or monthly periods for user or organization metrics.

Both functions validate their inputs, update counters atomically, expose the remaining amount and reset time, and are executable only by `service_role`. Application roles have no direct table access or RLS policy. Functions use a trusted search path and are created, revoked from `PUBLIC`, and selectively granted within the migration transaction.

The kernel hashes rate-limit subjects with HMAC-SHA-256 and requires a server-only secret of at least 32 bytes. Its application contract consumes the durable rate limit before an optional quota. A rate-limit denial skips quota consumption; a quota denial retains the rate-limit charge. Invalid database responses and storage failures throw typed errors, with no process-local fallback.

## Consequences

Limits are consistent across application instances and concurrent consumers serialize on the relevant counter row. Applications remain responsible for authenticating protected routes, selecting limit values, choosing a stable operation or metric identifier, mapping denials to protocol responses, and keeping the HMAC secret server-only.

Decision 0019 adds a bounded service-role retention operation. Deployments still own its schedule and retention values. This checkout verifies package integrity, SQL structure, privileges, planning, and the adapter contract without claiming live PostgreSQL concurrency certification.
