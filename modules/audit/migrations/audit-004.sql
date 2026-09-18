alter table public.audit_events
  alter column id set default gen_random_uuid();
