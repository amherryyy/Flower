create table public.roles (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default statement_timestamp(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.role_permissions (
  organization_id uuid not null,
  role_id uuid not null,
  permission text not null check (permission ~ '^[a-z][a-z0-9]*([.:_-][a-z0-9]+)*$'),
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, role_id, permission),
  foreign key (organization_id, role_id)
    references public.roles(organization_id, id)
    on delete cascade
);

alter table public.organization_memberships
  add column role_id uuid;

alter table public.organization_memberships
  add constraint organization_memberships_role_fk
  foreign key (organization_id, role_id)
  references public.roles(organization_id, id);

alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;

revoke all on table public.roles from public;
revoke all on table public.role_permissions from public;
