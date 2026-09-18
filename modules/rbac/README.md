# RBAC module

The RBAC module declares organization-scoped roles, permissions, and authorization and depends on `organizations`. F3 provides the installable integration contract only.

Its F4 migrations create organization-scoped roles and permissions, link memberships to roles with a cross-tenant-safe composite foreign key, and expose role metadata only to organization members. The private permission helper evaluates the caller from Supabase's request identity and is used by dependent policies. The role link remains nullable so adding RBAC never invents or silently backfills authorization for existing memberships. Role-assignment writes and final-owner enforcement remain server-side follow-up work.
