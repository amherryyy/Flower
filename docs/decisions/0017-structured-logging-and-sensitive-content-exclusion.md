# ADR 0017: Structured logging and sensitive-content exclusion

- Status: accepted
- Date: 2026-09-19

## Context

Free-form logging can expose authentication requests, AI prompts, form submissions, credentials, and personal data. Redaction after serialization is insufficient when arbitrary attribute names and objects are accepted, and direct console calls bypass centralized controls entirely. Logs still need stable event names and operational metadata for diagnosis and security auditing.

## Decision

Flower provides a structured logging contract with these controls:

- stable event names and levels rather than free-form messages;
- an explicit allowlist of attribute keys;
- rejected request-body, raw-body, prompt, message-collection, and form-data keys at any nesting depth;
- recursive configured redaction for secret and personal-data keys;
- string redaction for bearer credentials, common provider tokens, PostgreSQL passwords, email addresses, and IPv4 addresses;
- JSON-compatible plain records only, with finite numbers, bounded depth, bounded serialized size, and no cycles or shared object references;
- immutable sanitized events passed to an injected sink;
- typed failure when the sink is unavailable.

The versioned security baseline also defines application source paths. `flower security check` rejects direct `console.debug`, `console.info`, `console.log`, `console.trace`, `console.warn`, and `console.error` calls in those paths. It additionally detects object-based logging calls that visibly include a forbidden field. The generated template scans `app/**` and `src/**`; the framework scans its packages, modules, and templates.

## Consequences

Applications must consciously add new operational fields to the policy before logging them. Authentication bodies, AI prompts, chat messages, and sensitive forms cannot be passed through the Flower logger even if their nested values would otherwise be redacted.

The static source check is intentionally conservative but is not a JavaScript data-flow proof: aliases, computed properties, generated code, third-party logging, and dynamic execution require code review or future lint/compiler integrations. Applications must keep request objects and sensitive content out of all non-Flower sinks. The logger protects event construction; sink retention, access controls, encryption, export, and deletion policies remain deployment responsibilities.
