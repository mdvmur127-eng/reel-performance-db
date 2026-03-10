create extension if not exists pgcrypto;

drop table if exists public.reel_metrics;

create table public.reel_metrics (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  url text,
  views bigint,
  likes bigint,
  comments bigint,
  saves bigint,
  shares bigint,
  follows bigint,
  watch_time numeric(14,2),
  duration numeric(10,2),
  views_followers bigint,
  views_non_followers bigint,
  top_source_of_views text,
  accounts_reached bigint,
  this_reels_skip_rate numeric(10,4),
  typical_skip_rate numeric(10,4),
  average_watch_time numeric(10,4),
  audience_men numeric(10,4),
  audience_women numeric(10,4),
  audience_country text,
  audience_age text,
  sec_0 numeric(10,4),
  sec_1 numeric(10,4),
  sec_2 numeric(10,4),
  sec_3 numeric(10,4),
  sec_4 numeric(10,4),
  sec_5 numeric(10,4),
  sec_6 numeric(10,4),
  sec_7 numeric(10,4),
  sec_8 numeric(10,4),
  sec_9 numeric(10,4),
  sec_10 numeric(10,4),
  sec_11 numeric(10,4),
  sec_12 numeric(10,4),
  sec_13 numeric(10,4),
  sec_14 numeric(10,4),
  sec_15 numeric(10,4),
  sec_16 numeric(10,4),
  sec_17 numeric(10,4),
  sec_18 numeric(10,4),
  sec_19 numeric(10,4),
  sec_20 numeric(10,4),
  sec_21 numeric(10,4),
  sec_22 numeric(10,4),
  sec_23 numeric(10,4),
  sec_24 numeric(10,4),
  sec_25 numeric(10,4),
  sec_26 numeric(10,4),
  sec_27 numeric(10,4),
  sec_28 numeric(10,4),
  sec_29 numeric(10,4),
  sec_30 numeric(10,4),
  sec_31 numeric(10,4),
  sec_32 numeric(10,4),
  sec_33 numeric(10,4),
  sec_34 numeric(10,4),
  sec_35 numeric(10,4),
  sec_36 numeric(10,4),
  sec_37 numeric(10,4),
  sec_38 numeric(10,4),
  sec_39 numeric(10,4),
  sec_40 numeric(10,4),
  sec_41 numeric(10,4),
  sec_42 numeric(10,4),
  sec_43 numeric(10,4),
  sec_44 numeric(10,4),
  sec_45 numeric(10,4),
  sec_46 numeric(10,4),
  sec_47 numeric(10,4),
  sec_48 numeric(10,4),
  sec_49 numeric(10,4),
  sec_50 numeric(10,4),
  sec_51 numeric(10,4),
  sec_52 numeric(10,4),
  sec_53 numeric(10,4),
  sec_54 numeric(10,4),
  sec_55 numeric(10,4),
  sec_56 numeric(10,4),
  sec_57 numeric(10,4),
  sec_58 numeric(10,4),
  sec_59 numeric(10,4),
  sec_60 numeric(10,4),
  sec_61 numeric(10,4),
  sec_62 numeric(10,4),
  sec_63 numeric(10,4),
  sec_64 numeric(10,4),
  sec_65 numeric(10,4),
  sec_66 numeric(10,4),
  sec_67 numeric(10,4),
  sec_68 numeric(10,4),
  sec_69 numeric(10,4),
  sec_70 numeric(10,4),
  sec_71 numeric(10,4),
  sec_72 numeric(10,4),
  sec_73 numeric(10,4),
  sec_74 numeric(10,4),
  sec_75 numeric(10,4),
  sec_76 numeric(10,4),
  sec_77 numeric(10,4),
  sec_78 numeric(10,4),
  sec_79 numeric(10,4),
  sec_80 numeric(10,4),
  sec_81 numeric(10,4),
  sec_82 numeric(10,4),
  sec_83 numeric(10,4),
  sec_84 numeric(10,4),
  sec_85 numeric(10,4),
  sec_86 numeric(10,4),
  sec_87 numeric(10,4),
  sec_88 numeric(10,4),
  sec_89 numeric(10,4),
  sec_90 numeric(10,4)
  , created_at timestamptz not null default now()
  , updated_at timestamptz not null default now()
  , constraint reel_metrics_unique_snapshot unique (date, title, url)
);

create index if not exists reel_metrics_date_idx
  on public.reel_metrics (date desc, created_at desc);

create index if not exists reel_metrics_url_idx
  on public.reel_metrics (url);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reel_metrics_set_updated_at on public.reel_metrics;

create trigger reel_metrics_set_updated_at
before update on public.reel_metrics
for each row
execute function public.set_updated_at();

alter table public.reel_metrics enable row level security;
