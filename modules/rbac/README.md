# RBAC module

The RBAC module declares organization-scoped roles, permissions, and authorization and depends on `organizations`. F3 provides the installable integration contract only.

Its first F4 migration creates organization-scoped roles and permissions, links memberships to roles with a cross-tenant-safe composite foreign key, enables RLS, and leaves access fail-closed. The role link remains nullable so adding RBAC never invents or silently backfills authorization for existing memberships. No generated descriptor is an authorization check; role-assignment workflows, authorization policies, and cross-tenant security tests remain required.
