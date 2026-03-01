-- Safe patch: adds missing reels columns without dropping data
-- Run this in Supabase SQL Editor

begin;

alter table public.reels
  add column if not exists published_at timestamptz,
  add column if not exists title text,
  add column if not exists url text,
  add column if not exists views bigint,
  add column if not exists likes bigint,
  add column if not exists comments bigint,
  add column if not exists saves bigint,
  add column if not exists shares bigint,
  add column if not exists follows bigint,
  add column if not exists watch_time numeric,
  add column if not exists duration numeric,
  add column if not exists views_followers bigint,
  add column if not exists views_non_followers bigint,
  add column if not exists views_over_time_all text,
  add column if not exists views_over_time_followers text,
  add column if not exists views_over_time_non_followers text,
  add column if not exists top_source_of_views text,
  add column if not exists accounts_reached bigint,
  add column if not exists reel_skip_rate numeric,
  add column if not exists typical_skip_rate numeric,
  add column if not exists average_watch_time numeric,
  add column if not exists audience_men numeric,
  add column if not exists audience_women numeric,
  add column if not exists audience_country text,
  add column if not exists audience_age text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.reels
  alter column views_followers type numeric using views_followers::numeric,
  alter column views_non_followers type numeric using views_non_followers::numeric;

do $$
declare
  idx integer;
begin
  for idx in 0..90 loop
    execute format('alter table public.reels add column if not exists sec_%s numeric', idx);
  end loop;
end $$;

-- Backfill common aliases if they exist from old schema
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reels' and column_name = 'name'
  ) then
    execute 'update public.reels set title = coalesce(title, name) where title is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reels' and column_name = 'video_url'
  ) then
    execute 'update public.reels set url = coalesce(url, video_url, permalink) where url is null';
  else
    execute 'update public.reels set url = coalesce(url, permalink) where url is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reels' and column_name = 'posted_at'
  ) then
    execute 'update public.reels set published_at = coalesce(published_at, posted_at, created_at) where published_at is null';
  else
    execute 'update public.reels set published_at = coalesce(published_at, created_at) where published_at is null';
  end if;
end $$;

-- Ensure required fields are populated before NOT NULL constraints
update public.reels
set url = concat('https://placeholder.local/reel/', id::text)
where url is null or btrim(url) = '';

update public.reels
set title = coalesce(nullif(btrim(title), ''), 'Untitled Reel')
where title is null or btrim(title) = '';

update public.reels
set published_at = coalesce(published_at, created_at, now())
where published_at is null;

alter table public.reels alter column title set not null;
alter table public.reels alter column url set not null;
alter table public.reels alter column published_at set not null;

create index if not exists reels_user_date_idx on public.reels (user_id, published_at desc);

-- Keep duplicates out by URL per user
create unique index if not exists reels_user_url_unique_idx on public.reels (user_id, url);

create or replace function public.set_reels_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reels_set_updated_at on public.reels;
create trigger reels_set_updated_at
before update on public.reels
for each row
execute function public.set_reels_updated_at();

alter table public.reels enable row level security;

drop policy if exists "Users can select their own reels" on public.reels;
drop policy if exists "Users can insert their own reels" on public.reels;
drop policy if exists "Users can update their own reels" on public.reels;
drop policy if exists "Users can delete their own reels" on public.reels;

create policy "Users can select their own reels"
on public.reels
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own reels"
on public.reels
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own reels"
on public.reels
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own reels"
on public.reels
for delete
to authenticated
using (auth.uid() = user_id);

commit;
