create policy audit_events_select_authorized
on public.audit_events
for select
to authenticated
using (flower_private.has_organization_permission(organization_id, 'audit.read'));

grant select on table public.audit_events to authenticated;
