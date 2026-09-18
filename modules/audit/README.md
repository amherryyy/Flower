# Audit module

The audit module declares an organization-scoped audit event and trail boundary. It depends on `rbac` because audit visibility requires the explicit `audit.read` permission. F3 provides deterministic composition and lifecycle handling for that contract.

Its F4 migrations provide organization-scoped durable event storage and permit authenticated reads only through the `audit.read` permission. The only supported insert path is the service-role-only `append_audit_event` function. It recursively rejects configured secret, credential, request-body, and AI-content keys. Row updates, deletes, and table truncation are blocked by triggers as defense in depth. Retention and cryptographic tamper evidence remain follow-up security work; database owners can still alter or disable triggers.
