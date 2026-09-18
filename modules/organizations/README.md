# Organizations module

The organizations module declares explicit organization membership and depends on `auth`. In F3 it generates a typed integration descriptor and exercises transitive module composition.

It does not yet create organization or membership tables, policies, or tenant isolation. Those guarantees are intentionally deferred to F4.
