-- The API routes write with the caller's own session (role `authenticated`),
-- the same role the browser uses, so column privileges can't tell the server
-- apart from a user calling PostgREST directly. Instead, enforce how values
-- may change, for every writer:
--
--   * raw_text, client_id, captured_at, created_at never change (kept, not
--     rejected, so a repeated outbox upsert of the same row still succeeds);
--   * processing 'done' is terminal;
--   * processing_attempts never decreases;
--   * claim_capture stops at 5 attempts.
--
-- Together these cap the AI calls one capture can cost: a user can no longer
-- reset a capture to 'pending' or zero its attempts and call /api/process again.

create or replace function public.captures_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.raw_text    := old.raw_text;
  new.client_id   := old.client_id;
  new.captured_at := old.captured_at;
  new.created_at  := old.created_at;

  if old.processing = 'done' and new.processing <> 'done' then
    raise exception 'capture % is already processed', old.id using errcode = 'check_violation';
  end if;
  if new.processing_attempts < old.processing_attempts then
    raise exception 'processing_attempts cannot decrease' using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end $$;

-- Same as 0004, plus the attempt cap. Keep 5 in sync with MAX_PROCESS_ATTEMPTS
-- in lib/server/processCapture.ts.
create or replace function public.claim_capture(p_id uuid) returns setof public.captures
language sql set search_path = '' as $$
  update public.captures
     set processing_attempts   = processing_attempts + 1,
         processing_claimed_at = now()
   where id = p_id
     and processing <> 'done'
     and not user_edited
     and processing_attempts < 5
     and (processing_claimed_at is null or processing_claimed_at < now() - interval '2 minutes')
  returning *;
$$;
