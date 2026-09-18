# Limits module

The limits module provides durable PostgreSQL rate-limit buckets and daily or monthly usage quotas. It depends on `organizations` so callers can apply the same quota contract to authenticated users or organizations.

Only `service_role` may execute the security-definer consume functions. Application roles have no table privileges or RLS policies. Callers must HMAC sensitive rate-limit subjects before storage; the kernel helper rejects raw values and short hashing secrets. Database errors fail closed and never fall back to process-local counters.

The `prune_limit_counters` operation applies separate rate-limit and usage retention windows in bounded batches. It locks candidate rows with `SKIP LOCKED`, is executable only by `service_role`, and returns deletion counts so a scheduler can repeat until both counts reach zero. Applications own the schedule and must choose retention periods appropriate to their traffic and evidence requirements. Live concurrency proof still belongs in the isolated PostgreSQL certification suite.
