\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;

begin;
\ir ../../modules/organizations/migrations/organizations-001.sql
\ir ../../modules/organizations/migrations/organizations-002.sql
\ir ../../modules/rbac/migrations/rbac-001.sql
\ir ../../modules/rbac/migrations/rbac-002.sql
\ir ../../modules/rbac/migrations/rbac-003.sql
\ir ../../modules/audit/migrations/audit-001.sql
\ir ../../modules/audit/migrations/audit-002.sql
\ir ../../modules/audit/migrations/audit-003.sql
\ir ../../modules/audit/migrations/audit-004.sql
\ir ../../modules/limits/migrations/limits-001.sql
\ir ../../modules/limits/migrations/limits-002.sql
commit;

insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
select flower_private.create_organization(
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000010', 'certification', 'Certification'
);
select flower_private.create_organization_role(
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000011', 'member'
);
select flower_private.add_organization_member(
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000011'
);
reset role;

set role service_role;
select id from flower_private.append_audit_event(
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'organization.created', 'organization', 'certification', '{"outcome":"success"}'::jsonb
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);
do $$ begin
  if not exists(select 1 from public.organizations where id = '00000000-0000-4000-8000-000000000001') then raise exception 'member visibility failed'; end if;
  if exists(select 1 from public.audit_events) then raise exception 'member audit isolation failed'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', false);
do $$ begin
  if exists(select 1 from public.organizations) then raise exception 'outsider isolation failed'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
do $$ begin
  if (select count(*) from public.audit_events) <> 1 then raise exception 'owner audit visibility failed'; end if;
end $$;
do $$ begin
  perform flower_private.remove_organization_member('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');
  raise exception 'final owner removal unexpectedly succeeded';
exception when check_violation then null;
end $$;
reset role;

do $$ begin
  if (select count(*) from pg_class where oid in (
    'public.organizations'::regclass, 'public.organization_memberships'::regclass,
    'public.roles'::regclass, 'public.role_permissions'::regclass, 'public.audit_events'::regclass,
    'public.flower_rate_limit_buckets'::regclass, 'public.flower_usage_counters'::regclass
  ) and relrowsecurity) <> 7 then raise exception 'RLS certification failed'; end if;
end $$;
