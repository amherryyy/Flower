create table public.audit_events (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9]*([.:_-][a-z0-9]+)*$'),
  subject_type text,
  subject_id text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default statement_timestamp()
);

create index audit_events_organization_occurred_at_idx
  on public.audit_events(organization_id, occurred_at desc);

alter table public.audit_events enable row level security;

revoke all on table public.audit_events from public;
