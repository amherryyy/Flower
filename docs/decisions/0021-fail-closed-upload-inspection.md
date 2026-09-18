# ADR 0021: Fail-closed upload inspection

- Status: accepted
- Date: 2026-09-19

## Context

Magic-byte validation detects basic type mismatches but cannot determine whether a valid image or PDF contains malicious or unsafe content. A content sanitizer may also transform the file into output that no longer satisfies size, media-type, or signature policy. Provider failures and inconclusive scans must not release uninspected content.

## Decision

Flower defines injected malware-scanner and content-sanitizer ports. The inspection workflow validates the original metadata and signature, requires a clean scan, sanitizes the content, revalidates the transformed size/type/signature while preserving the trusted file name and owner, and requires a second clean scan of the exact transformed artifact.

Scanner exceptions, unknown verdicts, infected verdicts, sanitizer exceptions, and invalid transformed output all fail closed with typed errors. Content is represented by a reopenable async byte source so integrations need not buffer the complete upload and both scan passes can independently consume it.

## Consequences

Only the transformed, twice-scanned artifact is returned for storage. Flower does not bundle or certify a malware engine, image decoder, PDF sanitizer, archive inspector, or moderation service; applications must inject suitable implementations and enforce their own timeouts and isolation. This contract makes missing or failed inspection explicit without overstating signature checks as security scanning.
