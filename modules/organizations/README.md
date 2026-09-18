# Organizations module

The organizations module declares explicit organization membership and depends on `auth`. In F3 it generates a typed integration descriptor and exercises transitive module composition.

Its first F4 migration creates `organizations` and `organization_memberships`, enables RLS, and leaves access fail-closed with no application policies. Membership authorization and tenant-isolation policies are not yet implemented.
