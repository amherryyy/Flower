# ADR 0016: Upload validation and service-role boundary

- Status: accepted
- Date: 2026-09-19

## Context

Browser-supplied file names, MIME types, sizes, ownership identifiers, and request fields are untrusted. Checking only an extension or `Content-Type` permits disguised uploads, while accepting an organization identifier without membership authorization permits cross-tenant storage. A broadly available service-role client can bypass RLS and turn a missing filter or over-broad projection into a tenant data breach.

## Decision

Flower defines a versioned `.flower/uploads.json` policy. The runtime validator checks all of the following before storage:

- a plain control-free base name;
- a positive bounded byte size;
- an allowlisted media type;
- an extension allowed for that media type;
- a magic-byte prefix read from the received file;
- a valid user or organization owner that belongs to the authenticated actor.

The generated template allows PNG, JPEG, and PDF files up to 10 MiB. Its security gate validates the upload policy. Applications must pass size and header bytes from the received server-side file object, generate their own storage key, and must not trust duplicate client form fields.

Flower also provides a service-role operation registry and executor. Policies are copied and frozen at registration. Each named operation fixes its action, schema-qualified table, returned columns, permitted filters, permitted write fields, and optional organization column. Update and delete operations require a narrow caller filter. The executor injects tenant scope, requires an application-provided authorization decision, records a metadata-only attempt before access, dispatches a structured request to an injected server data port, and projects results back to the fixed column set. The raw privileged client and credential are never returned.

The application adapter containing the actual service-role credential must be marked server-only. In Next.js this means `import "server-only"`; the starter does not create a service-role client by default.

## Consequences

File validation and privileged data access now have fail-closed, testable contracts. Signature prefixes identify expected formats but do not themselves provide malware scanning, image decoding, PDF sanitization, archive inspection, or content moderation. Decision 0021 adds a mandatory provider-neutral scan/sanitize pipeline; concrete engines and storage-provider adapters remain application integrations.

Audit failure prevents the privileged operation from starting. The attempt record intentionally excludes filters, values, file names, and content. Applications may add outcome auditing inside the same durable transaction as their data port when atomic outcome evidence is required.
