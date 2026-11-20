-- Per-user rate limits shared by every server instance. The old in-memory
-- limiter counted per Vercel instance, so it barely limited anything.
--
-- Fixed windows: one row per (user, bucket, window start), incremented
-- atomically. A burst straddling a window boundary can reach up to 2x the
-- limit, which is fine for cost protection.

create table rate_limits (
  user_id      uuid not null references auth.users on delete cascade,
  bucket       text not null,
  window_start timestamptz not null,
  hits         int not null,
  primary key (user_id, bucket, window_start)
);

-- Only check_rate_limit (security definer) reads or writes it: no policies,
-- and no privileges for the API roles (Supabase grants them on new tables).
alter table rate_limits enable row level security;
revoke all on table rate_limits from anon, authenticated;

-- Counts one hit for the caller in `p_bucket` and returns whether it is
-- within `p_limit` per `p_window_seconds`. The user comes from auth.uid(),
-- never from an argument, so a caller can only spend their own quota.
create function public.check_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := auth.uid();
  started timestamptz;
  n_hits  int;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  -- A fixed set keeps a caller from filling the table with made-up buckets.
  if p_bucket not in ('process', 'spec', 'digest') then
    raise exception 'unknown rate limit bucket %', p_bucket using errcode = 'invalid_parameter_value';
  end if;
  if p_window_seconds not between 1 and 86400 or p_limit < 1 then
    raise exception 'invalid rate limit' using errcode = 'invalid_parameter_value';
  end if;

  started := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (user_id, bucket, window_start, hits)
  values (uid, p_bucket, started, 1)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into n_hits;

  -- Earlier windows are never read again; drop this user's so the table stays small.
  delete from public.rate_limits
   where user_id = uid and bucket = p_bucket and window_start < started;

  return n_hits <= p_limit;
end $$;

revoke execute on function public.check_rate_limit(text, int, int) from public, anon;
grant execute on function public.check_rate_limit(text, int, int) to authenticated;
