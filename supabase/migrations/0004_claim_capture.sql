-- Atomic claim for /api/process, so two concurrent requests for the same
-- capture can't both call the AI or lose an attempt count.
--
-- processing_claimed_at is a lease: set when a request claims the capture,
-- cleared when it saves a result or marks it failed. A lease older than
-- 2 minutes (> the route's maxDuration of 75s) belonged to a request that
-- was killed, so it may be claimed again.
alter table captures add column processing_claimed_at timestamptz;

-- security invoker (the default): RLS still limits it to the caller's rows.
create function public.claim_capture(p_id uuid) returns setof public.captures
language sql set search_path = '' as $$
  update public.captures
     set processing_attempts   = processing_attempts + 1,
         processing_claimed_at = now()
   where id = p_id
     and processing <> 'done'
     and not user_edited
     and (processing_claimed_at is null or processing_claimed_at < now() - interval '2 minutes')
  returning *;
$$;
