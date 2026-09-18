create function flower_private.has_organization_permission(
  target_organization_id uuid,
  requested_permission text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    join public.role_permissions permission
      on permission.organization_id = membership.organization_id
     and permission.role_id = membership.role_id
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and permission.permission = requested_permission
  );
$$;

revoke all on function flower_private.has_organization_permission(uuid, text) from public;
grant execute on function flower_private.has_organization_permission(uuid, text) to authenticated;

create policy roles_select_members
on public.roles
for select
to authenticated
using (flower_private.is_organization_member(organization_id));

create policy role_permissions_select_members
on public.role_permissions
for select
to authenticated
using (flower_private.is_organization_member(organization_id));

grant select on table public.roles to authenticated;
grant select on table public.role_permissions to authenticated;
