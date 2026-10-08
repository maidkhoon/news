-- News App database schema
-- Run this file in Supabase SQL Editor.

create extension if not exists pgcrypto;

create type public.user_role as enum ('USER', 'ADMIN');
create type public.article_access as enum ('FREE', 'PREMIUM');
create type public.article_status as enum ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');
create type public.subscription_status as enum ('ACTIVE', 'EXPIRED', 'CANCELLED');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  phone text,
  email text,
  role public.user_role not null default 'USER',
  status boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  image_url text,
  content text not null,
  access_type public.article_access not null default 'FREE',
  status public.article_status not null default 'DRAFT',
  category_id uuid not null references public.categories(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_type text not null,
  product_id text,
  base_plan_id text,
  purchase_token text unique,
  provider text not null default 'google_play',
  status public.subscription_status not null default 'ACTIVE',
  start_date timestamptz not null,
  expiry_date timestamptz not null,
  auto_renewing boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  fcm_token text not null unique,
  platform text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  article_id uuid references public.articles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index articles_category_status_published_idx
  on public.articles(category_id, status, published_at desc);

create index articles_access_type_idx
  on public.articles(access_type);

create index subscriptions_user_status_idx
  on public.subscriptions(user_id, status);

create index subscriptions_expiry_idx
  on public.subscriptions(expiry_date);

create index devices_user_idx
  on public.devices(user_id);

insert into public.categories (name, slug)
values
  ('INDIA', 'india'),
  ('CRYPTO', 'crypto')
on conflict (slug) do nothing;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.articles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.devices enable row level security;
alter table public.notifications enable row level security;

-- Public users can read published free article metadata/content.
create policy "published articles are readable"
on public.articles
for select
to authenticated
using (
  status = 'PUBLISHED'
  and (
    access_type = 'FREE'
    or exists (
      select 1
      from public.subscriptions s
      where s.user_id = auth.uid()
        and s.status = 'ACTIVE'
        and s.expiry_date > now()
    )
  )
);

create policy "categories are readable"
on public.categories
for select
to authenticated
using (true);

create policy "users can read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "users can update own profile"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "users can read own subscriptions"
on public.subscriptions
for select
to authenticated
using (user_id = auth.uid());

create policy "users can manage own devices"
on public.devices
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can read notifications"
on public.notifications
for select
to authenticated
using (true);

-- Admin writes should be performed through the protected backend using
-- the Supabase service-role key. Never expose that key in the Android app.
