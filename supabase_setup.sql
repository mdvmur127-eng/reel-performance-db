-- Reels-only schema reset (destructive for public.reels)
-- Run in Supabase SQL Editor

begin;

create extension if not exists pgcrypto;

drop table if exists public.reels cascade;

create table public.reels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  published_at timestamptz not null,
  title text not null,
  url text not null,

  views bigint,
  likes bigint,
  comments bigint,
  saves bigint,
  shares bigint,
  follows bigint,

  watch_time numeric,
  duration numeric,
  views_followers numeric,
  views_non_followers numeric,

  views_over_time_all text,
  views_over_time_followers text,
  views_over_time_non_followers text,

  top_source_of_views text,
  accounts_reached bigint,
  reel_skip_rate numeric,
  typical_skip_rate numeric,
  average_watch_time numeric,

  audience_men numeric,
  audience_women numeric,
  audience_country text,
  audience_age text,

  sec_0 numeric,
  sec_1 numeric,
  sec_2 numeric,
  sec_3 numeric,
  sec_4 numeric,
  sec_5 numeric,
  sec_6 numeric,
  sec_7 numeric,
  sec_8 numeric,
  sec_9 numeric,
  sec_10 numeric,
  sec_11 numeric,
  sec_12 numeric,
  sec_13 numeric,
  sec_14 numeric,
  sec_15 numeric,
  sec_16 numeric,
  sec_17 numeric,
  sec_18 numeric,
  sec_19 numeric,
  sec_20 numeric,
  sec_21 numeric,
  sec_22 numeric,
  sec_23 numeric,
  sec_24 numeric,
  sec_25 numeric,
  sec_26 numeric,
  sec_27 numeric,
  sec_28 numeric,
  sec_29 numeric,
  sec_30 numeric,
  sec_31 numeric,
  sec_32 numeric,
  sec_33 numeric,
  sec_34 numeric,
  sec_35 numeric,
  sec_36 numeric,
  sec_37 numeric,
  sec_38 numeric,
  sec_39 numeric,
  sec_40 numeric,
  sec_41 numeric,
  sec_42 numeric,
  sec_43 numeric,
  sec_44 numeric,
  sec_45 numeric,
  sec_46 numeric,
  sec_47 numeric,
  sec_48 numeric,
  sec_49 numeric,
  sec_50 numeric,
  sec_51 numeric,
  sec_52 numeric,
  sec_53 numeric,
  sec_54 numeric,
  sec_55 numeric,
  sec_56 numeric,
  sec_57 numeric,
  sec_58 numeric,
  sec_59 numeric,
  sec_60 numeric,
  sec_61 numeric,
  sec_62 numeric,
  sec_63 numeric,
  sec_64 numeric,
  sec_65 numeric,
  sec_66 numeric,
  sec_67 numeric,
  sec_68 numeric,
  sec_69 numeric,
  sec_70 numeric,
  sec_71 numeric,
  sec_72 numeric,
  sec_73 numeric,
  sec_74 numeric,
  sec_75 numeric,
  sec_76 numeric,
  sec_77 numeric,
  sec_78 numeric,
  sec_79 numeric,
  sec_80 numeric,
  sec_81 numeric,
  sec_82 numeric,
  sec_83 numeric,
  sec_84 numeric,
  sec_85 numeric,
  sec_86 numeric,
  sec_87 numeric,
  sec_88 numeric,
  sec_89 numeric,
  sec_90 numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reels_user_date_idx on public.reels (user_id, published_at desc);
create unique index reels_user_url_unique_idx on public.reels (user_id, url);

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
