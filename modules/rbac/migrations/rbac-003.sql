create function flower_private.assert_organization_has_owner(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1 from public.organizations organization where organization.id = target_organization_id
  ) and not exists (
    select 1
    from public.organization_memberships membership
    join public.role_permissions permission
      on permission.organization_id = membership.organization_id
     and permission.role_id = membership.role_id
    where membership.organization_id = target_organization_id
      and permission.permission = 'organization.owner'
  ) then
    raise exception 'organization % must retain at least one owner', target_organization_id
      using errcode = '23514';
  end if;
end;
$$;

create function flower_private.check_new_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform flower_private.assert_organization_has_owner(new.id);
  return new;
end;
$$;

create function flower_private.check_membership_owner_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform flower_private.assert_organization_has_owner(old.organization_id);
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    perform flower_private.assert_organization_has_owner(new.organization_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function flower_private.check_owner_permission_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if old.permission = 'organization.owner' then
    perform flower_private.assert_organization_has_owner(old.organization_id);
  end if;
  if tg_op = 'UPDATE'
    and new.organization_id is distinct from old.organization_id
    and new.permission = 'organization.owner'
  then
    perform flower_private.assert_organization_has_owner(new.organization_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create constraint trigger organizations_require_owner
after insert on public.organizations
deferrable initially deferred
for each row execute function flower_private.check_new_organization_owner();

create constraint trigger memberships_retain_owner
after delete or update of organization_id, role_id on public.organization_memberships
deferrable initially deferred
for each row execute function flower_private.check_membership_owner_change();

create constraint trigger permissions_retain_owner
after delete or update of organization_id, role_id, permission on public.role_permissions
deferrable initially deferred
for each row execute function flower_private.check_owner_permission_change();

create function flower_private.create_organization(
  new_organization_id uuid,
  new_owner_role_id uuid,
  new_slug text,
  new_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare caller_id uuid := auth.uid();
begin
  if caller_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  insert into public.organizations (id, slug, name) values (new_organization_id, new_slug, new_name);
  insert into public.roles (id, organization_id, name) values (new_owner_role_id, new_organization_id, 'owner');
  insert into public.role_permissions (organization_id, role_id, permission) values
    (new_organization_id, new_owner_role_id, 'organization.owner'),
    (new_organization_id, new_owner_role_id, 'organization.membership.manage'),
    (new_organization_id, new_owner_role_id, 'organization.role.manage'),
    (new_organization_id, new_owner_role_id, 'audit.read');
  insert into public.organization_memberships (organization_id, user_id, role_id)
    values (new_organization_id, caller_id, new_owner_role_id);
  perform flower_private.assert_organization_has_owner(new_organization_id);
  return new_organization_id;
end;
$$;

create function flower_private.create_organization_role(
  target_organization_id uuid,
  new_role_id uuid,
  new_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not flower_private.has_organization_permission(target_organization_id, 'organization.role.manage') then
    raise exception 'role management permission required' using errcode = '42501';
  end if;
  insert into public.roles (id, organization_id, name) values (new_role_id, target_organization_id, new_name);
  return new_role_id;
end;
$$;

create function flower_private.set_role_permission(
  target_organization_id uuid,
  target_role_id uuid,
  target_permission text,
  enabled boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not flower_private.has_organization_permission(target_organization_id, 'organization.role.manage') then
    raise exception 'role management permission required' using errcode = '42501';
  end if;
  if target_permission = 'organization.owner'
    and not flower_private.has_organization_permission(target_organization_id, 'organization.owner')
  then
    raise exception 'owner permission required' using errcode = '42501';
  end if;
  if enabled then
    insert into public.role_permissions (organization_id, role_id, permission)
      values (target_organization_id, target_role_id, target_permission)
      on conflict do nothing;
  else
    delete from public.role_permissions
      where organization_id = target_organization_id
        and role_id = target_role_id
        and permission = target_permission;
    perform flower_private.assert_organization_has_owner(target_organization_id);
  end if;
end;
$$;

create function flower_private.add_organization_member(
  target_organization_id uuid,
  target_user_id uuid,
  target_role_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not flower_private.has_organization_permission(target_organization_id, 'organization.membership.manage') then
    raise exception 'membership management permission required' using errcode = '42501';
  end if;
  insert into public.organization_memberships (organization_id, user_id, role_id)
    values (target_organization_id, target_user_id, target_role_id);
end;
$$;

create function flower_private.assign_organization_role(
  target_organization_id uuid,
  target_user_id uuid,
  target_role_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not flower_private.has_organization_permission(target_organization_id, 'organization.membership.manage') then
    raise exception 'membership management permission required' using errcode = '42501';
  end if;
  update public.organization_memberships
    set role_id = target_role_id
    where organization_id = target_organization_id and user_id = target_user_id;
  if not found then raise exception 'membership not found' using errcode = 'P0002'; end if;
  perform flower_private.assert_organization_has_owner(target_organization_id);
end;
$$;

create function flower_private.remove_organization_member(
  target_organization_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not flower_private.has_organization_permission(target_organization_id, 'organization.membership.manage') then
    raise exception 'membership management permission required' using errcode = '42501';
  end if;
  delete from public.organization_memberships
    where organization_id = target_organization_id and user_id = target_user_id;
  if not found then raise exception 'membership not found' using errcode = 'P0002'; end if;
  perform flower_private.assert_organization_has_owner(target_organization_id);
end;
$$;

revoke all on function flower_private.assert_organization_has_owner(uuid) from public;
revoke all on function flower_private.check_new_organization_owner() from public;
revoke all on function flower_private.check_membership_owner_change() from public;
revoke all on function flower_private.check_owner_permission_change() from public;
revoke all on function flower_private.create_organization(uuid, uuid, text, text) from public;
revoke all on function flower_private.create_organization_role(uuid, uuid, text) from public;
revoke all on function flower_private.set_role_permission(uuid, uuid, text, boolean) from public;
revoke all on function flower_private.add_organization_member(uuid, uuid, uuid) from public;
revoke all on function flower_private.assign_organization_role(uuid, uuid, uuid) from public;
revoke all on function flower_private.remove_organization_member(uuid, uuid) from public;

grant execute on function flower_private.create_organization(uuid, uuid, text, text) to authenticated;
grant execute on function flower_private.create_organization_role(uuid, uuid, text) to authenticated;
grant execute on function flower_private.set_role_permission(uuid, uuid, text, boolean) to authenticated;
grant execute on function flower_private.add_organization_member(uuid, uuid, uuid) to authenticated;
grant execute on function flower_private.assign_organization_role(uuid, uuid, uuid) to authenticated;
grant execute on function flower_private.remove_organization_member(uuid, uuid) to authenticated;
