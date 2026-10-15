-- Disposable PostgreSQL fixture for migration integration CI only.
-- This is intentionally minimal, not a replacement for a full Supabase stack.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create type public.user_role as enum ('USER', 'ADMIN', 'MASTER_ADMIN');

create table public.profiles (
  id uuid primary key,
  role public.user_role not null default 'USER',
  status boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  updated_at timestamptz not null default now(),
  status text not null default 'DRAFT',
  published_at timestamptz
);

create schema if not exists storage;
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
