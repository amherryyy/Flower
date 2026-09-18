# Organizations module

The organizations module declares explicit organization membership and depends on `auth`. In F3 it generates a typed integration descriptor and exercises transitive module composition.

Its F4 migrations create `organizations` and `organization_memberships`, enable RLS, and allow authenticated users to read only organizations in which they have an explicit membership. Writes remain denied to ordinary application roles and must use a future approved workflow or the narrow server-only boundary.
