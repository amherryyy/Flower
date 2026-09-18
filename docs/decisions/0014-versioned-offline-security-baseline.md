# ADR 0014: Versioned offline security baseline

- Status: accepted
- Date: 2026-09-19

## Context

Flower projects need a repeatable security gate before live services or hosted scanners are available. The gate must be useful in an offline checkout, produce deterministic diagnostics, avoid disclosing detected credentials, and distinguish local policy checks from vulnerability intelligence that requires a maintained external database.

## Decision

Flower defines `.flower/security.json` with a versioned JSON Schema. `flower security check` validates that policy and performs four local checks:

1. scan bounded text files for high-confidence credential formats and unignored environment files;
2. require and parse the root npm lockfile when configured;
3. reject `latest`, wildcard, URL, Git, GitHub, and local-file dependency specifiers when configured;
4. statically verify declared security headers and forbidden CSP tokens in the configured application file.

The command returns exit code `6` for policy failure. Diagnostics identify the file and rule but never include the detected credential value. File discovery is deterministic, does not follow symbolic links, and is bounded by configured exclusions and file size. Header paths must remain inside the project.

The bundled Next.js template enables the header policy and supplies CSP, framing, MIME-sniffing, referrer, permissions, and transport-security headers. The framework repository uses the same baseline with application-header checks disabled because it is not a web application.

## Consequences

The gate works without network access and can run in development and CI. At this checkpoint it did not identify vulnerabilities, licenses, malware, or compromised package releases from a live advisory database; its machine-readable summary reports that limitation as `vulnerabilityDatabase: "not-configured"`. Decision 0018 extends the offline gate with lockfile-declared license and integrity policy and adds a separate live advisory threshold in CI without changing that offline result contract.
