# ADR 0034: Post-F6 Roadmap and Pilot Boundary

## Status

Accepted for post-MVP planning.

## Context

The original implementation roadmap ended at F6, while normative sections of the specification still describe adoption and user-facing update application that are not complete product workflows. Flower also needs to be exercised by a real external web application. Continuing without an approved sequence would encourage arbitrary phase names, blur framework work with application features, and make completion claims difficult to audit.

## Decision

- Extend the specification with F7 through F11: adoption and update application; packaging and releases; deployment and hosted Supabase integration; production security and operations; and the module/adapter ecosystem.
- Treat these as post-MVP extensions. Completing F0 through F6 remains historically accurate and does not imply that the newly approved phases are implemented.
- Use F7 to close the existing specification gaps for `flower adopt`, `flower update --plan`, and `flower update --apply` before adding distribution or deployment convenience.
- Develop the pilot application in a separate directory and Git repository. It consumes released or explicitly pinned Flower revisions and never becomes a subtree of the framework repository.
- A pilot requirement enters Flower only when it represents a reusable framework contract. Application-specific listings, searches, maps, screens, and business rules stay project-owned.
- Permit parallel pilot work, but keep framework and application changes on separate branches, repositories, tests, journals, and pull requests.
- Require explicit non-goals and measurable exit criteria for every new phase, followed by an exit audit before completion is claimed.

## Consequences

- The next framework task is no longer ambiguous: F7 begins with read-only adoption inspection, followed by planning and transactional application.
- The pilot can validate Flower without controlling Flower's architecture or weakening its ownership boundaries.
- Packaging, hosted deployment, hardening, and ecosystem work have visible dependencies and cannot be presented as already shipped.
- Discoveries may change later-phase scope through a reviewed specification amendment, but they do not silently redefine the active phase.

## Rejected alternatives

- Stopping the roadmap at F6 was rejected because required adoption and update commands would remain unowned.
- Calling every pilot feature a Flower module was rejected because it would couple the framework to one application's domain.
- Building all post-F6 work concurrently in one repository branch was rejected because acceptance evidence and rollback boundaries would become unclear.
- Treating the proposed phase list as informal guidance was rejected because previous informal naming created understandable confusion about what Flower had actually completed.

## Review trigger

Review after the F7 exit audit, after the pilot's first deployed environment, or when evidence shows that a later phase must be split or reordered.
