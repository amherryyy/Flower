# RBAC module

The RBAC module declares organization-scoped roles, permissions, and authorization and depends on `organizations`. F3 provides the installable integration contract only.

Its F4 migrations create organization-scoped roles and permissions, link memberships to roles with a cross-tenant-safe composite foreign key, and expose role metadata only to organization members. Private workflows atomically bootstrap an organization and owner, create roles, manage permissions and memberships, and assign roles. They authorize through Supabase's request identity and explicit organization permissions. Deferred database triggers and immediate workflow checks prevent every organization from losing its final owner. The role link remains nullable so adding RBAC never invents or silently backfills authorization for existing memberships.
