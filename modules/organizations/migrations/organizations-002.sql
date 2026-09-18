create schema if not exists flower_private;
revoke all on schema flower_private from public;
grant usage on schema flower_private to authenticated;

create function flower_private.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
  );
$$;

revoke all on function flower_private.is_organization_member(uuid) from public;
grant execute on function flower_private.is_organization_member(uuid) to authenticated;

create policy organizations_select_members
on public.organizations
for select
to authenticated
using (flower_private.is_organization_member(id));

create policy organization_memberships_select_members
on public.organization_memberships
for select
to authenticated
using (flower_private.is_organization_member(organization_id));

grant select on table public.organizations to authenticated;
grant select on table public.organization_memberships to authenticated;
