-- Generic idempotency-key store for non-repeatable admin/MCP write operations
-- (currently: admin article creation). Scoped per actor + operation so one
-- user's key can never collide with or read another user's cached result.
--
-- Rollback:
--   drop table if exists public.idempotency_keys;

create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_id, scope, idempotency_key)
);

-- Backs the lazy-expiry delete in backend/src/lib/idempotency.js.
create index if not exists idempotency_keys_created_at_idx
  on public.idempotency_keys(created_at);

alter table public.idempotency_keys enable row level security;
-- No policies are defined: only the backend's service-role key (which
-- bypasses RLS) may read or write this table, matching admin_audit_logs.
