-- RipSense Supabase schema (MVP)
-- Run in Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  username text not null unique,
  email text not null unique,
  avatar_url text,
  packs_opened integer not null default 0,
  luck_score numeric not null default 50,
  created_at timestamptz not null default now()
);

create table if not exists public.packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  set_name text not null,
  product_type text not null,
  pack_number integer not null,
  box_id text,
  opened_at timestamptz not null default now(),
  image_url text
);

create table if not exists public.pulls (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.packs(id) on delete cascade,
  card_id text not null,
  card_name text not null,
  rarity text not null,
  market_value numeric not null default 0,
  image_url text,
  confidence_score numeric
);

create table if not exists public.boxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  set_name text not null,
  product_type text not null,
  total_packs integer not null,
  opened_packs integer not null default 0,
  estimated_remaining_hits numeric not null default 0,
  status text not null default 'active'
);

create table if not exists public.global_stats (
  id uuid primary key default gen_random_uuid(),
  set_name text not null,
  product_type text not null,
  packs_logged bigint not null default 0,
  avg_hit_rate numeric not null default 0,
  chase_odds numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (set_name, product_type)
);

alter table public.users enable row level security;
alter table public.packs enable row level security;
alter table public.pulls enable row level security;
alter table public.boxes enable row level security;

create policy "Users can view their own profile" on public.users
for select using (auth.uid() = auth_user_id);

create policy "Users can update their own profile" on public.users
for update using (auth.uid() = auth_user_id);

create policy "Users can insert their own profile" on public.users
for insert with check (auth.uid() = auth_user_id);

create policy "Users manage own packs" on public.packs
for all using (
  exists (
    select 1 from public.users u
    where u.id = packs.user_id and u.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = packs.user_id and u.auth_user_id = auth.uid()
  )
);

create policy "Users manage own pulls" on public.pulls
for all using (
  exists (
    select 1
    from public.packs p
    join public.users u on u.id = p.user_id
    where p.id = pulls.pack_id and u.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.packs p
    join public.users u on u.id = p.user_id
    where p.id = pulls.pack_id and u.auth_user_id = auth.uid()
  )
);

create policy "Users manage own boxes" on public.boxes
for all using (
  exists (
    select 1 from public.users u
    where u.id = boxes.user_id and u.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = boxes.user_id and u.auth_user_id = auth.uid()
  )
);

-- global_stats is public read-only analytics data.
alter table public.global_stats enable row level security;
create policy "Anyone can read global stats" on public.global_stats
for select using (true);
