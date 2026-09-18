create table public.flower_rate_limit_buckets (
  scope text not null check (scope in ('ip', 'user', 'organization')),
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  operation text not null check (operation ~ '^[a-z][a-z0-9_.:-]{0,99}$'),
  window_started_at timestamptz not null,
  window_seconds integer not null check (window_seconds > 0),
  usage_count integer not null check (usage_count >= 0),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (scope, subject_hash, operation, window_started_at, window_seconds)
);

create table public.flower_usage_counters (
  scope text not null check (scope in ('user', 'organization')),
  subject_id uuid not null,
  metric text not null check (metric ~ '^[a-z][a-z0-9_.:-]{0,99}$'),
  period text not null check (period in ('day', 'month')),
  period_started_on date not null,
  usage_count bigint not null check (usage_count >= 0),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (scope, subject_id, metric, period, period_started_on)
);

alter table public.flower_rate_limit_buckets enable row level security;
alter table public.flower_usage_counters enable row level security;

revoke all on table public.flower_rate_limit_buckets from public, anon, authenticated;
revoke all on table public.flower_usage_counters from public, anon, authenticated;

grant usage on schema flower_private to service_role;

create function flower_private.consume_rate_limit(
  p_scope text,
  p_subject_hash text,
  p_operation text,
  p_window_seconds integer,
  p_limit integer,
  p_cost integer default 1
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  observed_at timestamptz := clock_timestamp();
  bucket_start timestamptz;
  current_usage integer;
begin
  if p_scope not in ('ip', 'user', 'organization')
    or p_subject_hash !~ '^[a-f0-9]{64}$'
    or p_operation !~ '^[a-z][a-z0-9_.:-]{0,99}$'
    or p_window_seconds < 1
    or p_limit < 1
    or p_cost < 1
  then
    raise exception 'invalid rate-limit request' using errcode = '22023';
  end if;

  bucket_start := to_timestamp(
    floor(extract(epoch from observed_at) / p_window_seconds) * p_window_seconds
  );

  insert into public.flower_rate_limit_buckets (
    scope, subject_hash, operation, window_started_at, window_seconds, usage_count
  ) values (
    p_scope, p_subject_hash, p_operation, bucket_start, p_window_seconds, 0
  ) on conflict do nothing;

  select bucket.usage_count into current_usage
  from public.flower_rate_limit_buckets bucket
  where bucket.scope = p_scope
    and bucket.subject_hash = p_subject_hash
    and bucket.operation = p_operation
    and bucket.window_started_at = bucket_start
    and bucket.window_seconds = p_window_seconds
  for update;

  if p_cost > p_limit or current_usage > p_limit - p_cost then
    return query select false, greatest(p_limit - current_usage, 0), bucket_start + make_interval(secs => p_window_seconds);
    return;
  end if;

  update public.flower_rate_limit_buckets bucket
    set usage_count = bucket.usage_count + p_cost,
        updated_at = observed_at
    where bucket.scope = p_scope
      and bucket.subject_hash = p_subject_hash
      and bucket.operation = p_operation
      and bucket.window_started_at = bucket_start
      and bucket.window_seconds = p_window_seconds
    returning bucket.usage_count into current_usage;

  return query select true, p_limit - current_usage, bucket_start + make_interval(secs => p_window_seconds);
end;
$$;

create function flower_private.consume_usage_quota(
  p_scope text,
  p_subject_id uuid,
  p_metric text,
  p_period text,
  p_limit bigint,
  p_cost bigint default 1
)
returns table (allowed boolean, remaining bigint, reset_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  observed_at timestamptz := clock_timestamp();
  period_start date;
  period_reset timestamptz;
  current_usage bigint;
begin
  if p_scope not in ('user', 'organization')
    or p_subject_id is null
    or p_metric !~ '^[a-z][a-z0-9_.:-]{0,99}$'
    or p_period not in ('day', 'month')
    or p_limit < 1
    or p_cost < 1
  then
    raise exception 'invalid usage-quota request' using errcode = '22023';
  end if;

  if p_period = 'day' then
    period_start := (observed_at at time zone 'UTC')::date;
    period_reset := ((period_start + 1)::timestamp at time zone 'UTC');
  else
    period_start := date_trunc('month', observed_at at time zone 'UTC')::date;
    period_reset := ((period_start + interval '1 month')::timestamp at time zone 'UTC');
  end if;

  insert into public.flower_usage_counters (
    scope, subject_id, metric, period, period_started_on, usage_count
  ) values (
    p_scope, p_subject_id, p_metric, p_period, period_start, 0
  ) on conflict do nothing;

  select counter.usage_count into current_usage
  from public.flower_usage_counters counter
  where counter.scope = p_scope
    and counter.subject_id = p_subject_id
    and counter.metric = p_metric
    and counter.period = p_period
    and counter.period_started_on = period_start
  for update;

  if p_cost > p_limit or current_usage > p_limit - p_cost then
    return query select false, greatest(p_limit - current_usage, 0::bigint), period_reset;
    return;
  end if;

  update public.flower_usage_counters counter
    set usage_count = counter.usage_count + p_cost,
        updated_at = observed_at
    where counter.scope = p_scope
      and counter.subject_id = p_subject_id
      and counter.metric = p_metric
      and counter.period = p_period
      and counter.period_started_on = period_start
    returning counter.usage_count into current_usage;

  return query select true, p_limit - current_usage, period_reset;
end;
$$;

revoke all on function flower_private.consume_rate_limit(text, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function flower_private.consume_usage_quota(text, uuid, text, text, bigint, bigint) from public, anon, authenticated;

grant execute on function flower_private.consume_rate_limit(text, text, text, integer, integer, integer) to service_role;
grant execute on function flower_private.consume_usage_quota(text, uuid, text, text, bigint, bigint) to service_role;
