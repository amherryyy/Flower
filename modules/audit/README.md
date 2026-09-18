# Audit module

The audit module declares an organization-scoped audit event and trail boundary and depends on `organizations`. F3 provides deterministic composition and lifecycle handling for that contract.

It does not yet provide durable event storage, retention jobs, redaction enforcement, or tamper resistance. Those database and security behaviors belong to F4.
