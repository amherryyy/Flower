# Audit module

The audit module declares an organization-scoped audit event and trail boundary. It depends on `rbac` because audit visibility requires the explicit `audit.read` permission. F3 provides deterministic composition and lifecycle handling for that contract.

Its F4 migrations provide organization-scoped durable event storage and permit authenticated reads only through the `audit.read` permission. Inserts remain server-only through the service-role boundary. Retention jobs, redaction enforcement, append-only database privileges, and tamper resistance remain follow-up security work.
