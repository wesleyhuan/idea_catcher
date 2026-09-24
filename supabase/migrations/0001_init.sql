create type capture_status   as enum ('inbox', 'done', 'archived');
create type processing_state as enum ('pending', 'done', 'failed');
create type capture_type     as enum ('idea', 'todo', 'reminder', 'reference', 'question');
create type capture_context  as enum ('laptop', 'phone', 'anywhere');
create type capture_effort   as enum ('quick', 'medium', 'long');
create type digest_period    as enum ('day', 'week');

create table captures (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users on delete cascade,
  client_id           uuid not null,
  raw_text            text not null check (length(trim(raw_text)) > 0),
  captured_at         timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  status              capture_status not null default 'inbox',
  processing          processing_state not null default 'pending',
  processing_error    text,
  processing_attempts int not null default 0,
  type                capture_type,
  title               text,
  summary             text,
  next_steps          jsonb not null default '[]'::jsonb,
  context             capture_context,
  effort              capture_effort,
  user_edited         boolean not null default false,
  spec_md             text,
  unique (user_id, client_id)
);

create index captures_inbox_idx on captures (user_id, status, captured_at desc);
create index captures_processing_idx on captures (user_id, processing);

-- raw_text is immutable after insert
create function captures_before_update() returns trigger language plpgsql as $$
begin
  new.raw_text := old.raw_text;
  new.updated_at := now();
  return new;
end $$;
create trigger captures_before_update before update on captures
  for each row execute function captures_before_update();

create table digests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  period        digest_period not null,
  period_start  date not null,
  content_md    text not null,
  capture_count int not null,
  created_at    timestamptz not null default now(),
  unique (user_id, period, period_start)
);

alter table captures enable row level security;
alter table digests  enable row level security;

create policy "own captures" on captures for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own digests" on digests for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter publication supabase_realtime add table captures;
