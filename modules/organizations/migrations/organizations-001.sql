create table public.organizations (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default statement_timestamp()
);

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, user_id)
);

create index organization_memberships_user_id_idx
  on public.organization_memberships(user_id);

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;

revoke all on table public.organizations from public;
revoke all on table public.organization_memberships from public;
