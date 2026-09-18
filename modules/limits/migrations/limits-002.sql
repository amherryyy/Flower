create function flower_private.prune_limit_counters(
  p_rate_limit_retention_days integer,
  p_usage_retention_days integer,
  p_batch_size integer default 1000
)
returns table (rate_limit_deleted integer, usage_deleted integer)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  observed_at timestamptz := clock_timestamp();
begin
  if p_rate_limit_retention_days not between 1 and 3650
    or p_usage_retention_days not between 1 and 3650
    or p_batch_size not between 1 and 10000
  then
    raise exception 'invalid limit-counter retention request' using errcode = '22023';
  end if;

  with candidates as (
    select bucket.ctid
    from public.flower_rate_limit_buckets bucket
    where bucket.window_started_at + make_interval(secs => bucket.window_seconds)
      < observed_at - make_interval(days => p_rate_limit_retention_days)
    order by bucket.window_started_at, bucket.ctid
    limit p_batch_size
    for update skip locked
  ), deleted as (
    delete from public.flower_rate_limit_buckets bucket
    using candidates
    where bucket.ctid = candidates.ctid
    returning 1
  )
  select count(*)::integer into rate_limit_deleted from deleted;

  with candidates as (
    select counter.ctid
    from public.flower_usage_counters counter
    where case counter.period
      when 'day' then counter.period_started_on + 1
      when 'month' then (counter.period_started_on + interval '1 month')::date
    end < (observed_at at time zone 'UTC')::date - p_usage_retention_days
    order by counter.period_started_on, counter.ctid
    limit p_batch_size
    for update skip locked
  ), deleted as (
    delete from public.flower_usage_counters counter
    using candidates
    where counter.ctid = candidates.ctid
    returning 1
  )
  select count(*)::integer into usage_deleted from deleted;

  return next;
end;
$$;

revoke all on function flower_private.prune_limit_counters(integer, integer, integer) from public, anon, authenticated;
grant execute on function flower_private.prune_limit_counters(integer, integer, integer) to service_role;
