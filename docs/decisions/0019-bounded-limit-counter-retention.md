# ADR 0019: Bounded limit-counter retention

- Status: accepted
- Date: 2026-09-19

## Context

Durable rate-limit buckets and usage counters accumulate as time windows, subjects, and metrics change. Unbounded growth is an operational and privacy risk, but automatic deletion inside the request path would increase latency and couple authorization decisions to maintenance work.

## Decision

The `limits` module adds `flower_private.prune_limit_counters`. It accepts separate retention days for rate-limit and usage data plus a bounded batch size. Values are restricted to 1–3650 days and 1–10,000 rows per table per call.

The function selects expired rows in deterministic age order, locks candidates with `FOR UPDATE SKIP LOCKED`, deletes at most one configured batch from each counter table, and returns both deletion counts. It is a security-definer function with a trusted search path, revoked from public and application roles, and granted only to `service_role`.

The kernel exposes a typed adapter that validates the same bounds before querying PostgreSQL, validates returned counts, and fails closed on malformed responses or storage errors. Deployments schedule repeated calls and stop when both counts are zero.

## Consequences

Retention does not run in the latency-sensitive consume path and multiple workers can safely avoid waiting on the same selected rows. Rate-limit expiration includes the bucket's window duration before applying retention. Usage retention starts after the UTC day or month has completed, so an active monthly counter cannot be pruned mid-period. The operation deliberately does not prescribe a scheduler, and structural tests do not substitute for live PostgreSQL concurrency certification.
