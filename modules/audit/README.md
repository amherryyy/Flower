# Audit module

The audit module declares an organization-scoped audit event and trail boundary and depends on `organizations`. F3 provides deterministic composition and lifecycle handling for that contract.

Its first F4 migration provides organization-scoped durable event storage with RLS enabled and no application access policies. Retention jobs, redaction enforcement, append-only privileges, and tamper resistance remain follow-up security work.
