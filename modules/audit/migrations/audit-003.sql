create function flower_private.assert_safe_audit_payload(p_value jsonb, p_depth integer default 0)
returns void
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  pair record;
  element jsonb;
begin
  if p_depth > 8 then
    raise exception 'audit payload exceeds maximum depth' using errcode = '22023';
  end if;
  if jsonb_typeof(p_value) = 'object' then
    for pair in select key, value from jsonb_each(p_value) loop
      if lower(pair.key) = any (array[
        'password', 'secret', 'token', 'authorization', 'cookie', 'apikey', 'privatekey',
        'body', 'requestbody', 'rawbody', 'prompt', 'messages', 'formdata'
      ]) then
        raise exception 'audit payload contains a forbidden field' using errcode = '22023';
      end if;
      perform flower_private.assert_safe_audit_payload(pair.value, p_depth + 1);
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for element in select value from jsonb_array_elements(p_value) loop
      perform flower_private.assert_safe_audit_payload(element, p_depth + 1);
    end loop;
  end if;
end;
$$;

create function flower_private.append_audit_event(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_event_type text,
  p_subject_type text,
  p_subject_id text,
  p_payload jsonb default '{}'::jsonb
)
returns table (id uuid, occurred_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_organization_id is null
    or p_event_type !~ '^[a-z][a-z0-9]*([.:_-][a-z0-9]+)*$'
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
  then
    raise exception 'invalid audit event' using errcode = '22023';
  end if;

  perform flower_private.assert_safe_audit_payload(p_payload);

  return query
  insert into public.audit_events as event (
    organization_id, actor_user_id, event_type, subject_type, subject_id, payload
  ) values (
    p_organization_id, p_actor_user_id, p_event_type, p_subject_type, p_subject_id, p_payload
  )
  returning event.id, event.occurred_at;
end;
$$;

create function flower_private.reject_audit_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'audit events are append-only' using errcode = '42501';
end;
$$;

create trigger audit_events_reject_row_mutation
before update or delete on public.audit_events
for each row execute function flower_private.reject_audit_event_mutation();

create trigger audit_events_reject_truncate
before truncate on public.audit_events
for each statement execute function flower_private.reject_audit_event_mutation();

revoke insert, update, delete, truncate on table public.audit_events from public, anon, authenticated, service_role;
revoke all on function flower_private.assert_safe_audit_payload(jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function flower_private.append_audit_event(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function flower_private.append_audit_event(uuid, uuid, text, text, text, jsonb) to service_role;
