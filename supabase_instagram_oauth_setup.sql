-- Instagram OAuth + Reels sync support (safe migration)
-- Run in Supabase SQL Editor

begin;

-- Reels columns used by server-side Instagram sync
alter table public.reels
  add column if not exists ig_media_id text,
  add column if not exists caption text,
  add column if not exists media_url text,
  add column if not exists thumbnail_url text,
  add column if not exists permalink text,
  add column if not exists posted_at timestamptz,
  add column if not exists plays bigint,
  add column if not exists reach bigint,
  add column if not exists saved bigint,
  add column if not exists last_synced_at timestamptz,
  add column if not exists instagram_media_id text;

create unique index if not exists reels_user_ig_media_unique_idx
  on public.reels (user_id, ig_media_id)
  where ig_media_id is not null;

create index if not exists reels_user_last_synced_idx
  on public.reels (user_id, last_synced_at desc);

-- Connected Instagram account per app user
create table if not exists public.instagram_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  instagram_user_id text,
  token_type text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.instagram_connections
  alter column instagram_user_id drop not null;

create index if not exists instagram_connections_ig_user_idx
  on public.instagram_connections (instagram_user_id);

-- Short-lived OAuth state used for CSRF protection
create table if not exists public.instagram_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists instagram_oauth_states_user_idx
  on public.instagram_oauth_states (user_id, created_at desc);

create index if not exists instagram_oauth_states_expires_idx
  on public.instagram_oauth_states (expires_at);

-- Keep updated_at current
create or replace function public.set_instagram_connections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists instagram_connections_set_updated_at on public.instagram_connections;
create trigger instagram_connections_set_updated_at
before update on public.instagram_connections
for each row
execute function public.set_instagram_connections_updated_at();

-- RLS
alter table public.instagram_connections enable row level security;
alter table public.instagram_oauth_states enable row level security;

drop policy if exists "Users can select own instagram connection" on public.instagram_connections;
drop policy if exists "Users can insert own instagram connection" on public.instagram_connections;
drop policy if exists "Users can update own instagram connection" on public.instagram_connections;
drop policy if exists "Users can delete own instagram connection" on public.instagram_connections;

create policy "Users can select own instagram connection"
on public.instagram_connections
for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own instagram connection"
on public.instagram_connections
for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own instagram connection"
on public.instagram_connections
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own instagram connection"
on public.instagram_connections
for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can select own instagram oauth state" on public.instagram_oauth_states;
drop policy if exists "Users can insert own instagram oauth state" on public.instagram_oauth_states;
drop policy if exists "Users can delete own instagram oauth state" on public.instagram_oauth_states;

create policy "Users can select own instagram oauth state"
on public.instagram_oauth_states
for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own instagram oauth state"
on public.instagram_oauth_states
for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can delete own instagram oauth state"
on public.instagram_oauth_states
for delete to authenticated
using (auth.uid() = user_id);

-- Cleanup helper to remove expired states
delete from public.instagram_oauth_states where expires_at < now();

commit;
