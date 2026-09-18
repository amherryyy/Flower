# ADR 0020: Append-only audit events

- Status: accepted
- Date: 2026-09-19

## Context

Audit records are useful only when ordinary privileged application paths cannot silently rewrite them and when the audit payload itself does not become a second store for credentials, request bodies, or AI conversations. Direct service-role table access would bypass RLS and make both guarantees dependent on every caller.

## Decision

The audit module exposes one service-role-only security-definer function, `flower_private.append_audit_event`. Direct insert, update, delete, and truncate privileges remain revoked from application roles and `service_role`. The function validates the organization, event identifier, and object payload before insertion.

Payloads are recursively inspected in PostgreSQL and in the kernel adapter. Password, secret, token, authorization, cookie, key, request-body, prompt, message, and form-data fields are rejected rather than redacted after persistence. The kernel also accepts only finite JSON values, plain objects, acyclic structures, and a bounded nesting depth.

Two database triggers reject row update/delete and table truncation. These triggers provide defense in depth against accidental mutation through privileged application code. They are not cryptographic tamper evidence and cannot constrain a database owner capable of altering triggers.

## Consequences

Callers receive only the new event id and occurrence time. Sensitive payload failures happen before a database call when visible to the kernel and are rechecked by PostgreSQL for other clients. Audit retention requires a separately designed privileged path because ordinary deletion is deliberately blocked. Live PostgreSQL execution remains required before claiming runtime trigger certification.
