-- Add a bounded processing lease to idempotency_keys so a crashed request
-- (one that claimed a key but never wrote a response) doesn't block retries
-- for the full 24h key TTL, plus a fencing token so a slow-but-still-alive
-- handler can't be silently overwritten by a reclaim: the original owner
-- keeps renewing claimed_at while it runs, and both the renewal and the
-- final response write are conditioned on still holding lease_token. See
-- backend/src/lib/idempotency.js for the full claim/renew/reclaim logic.
--
-- Rollback:
--   alter table public.idempotency_keys drop column if exists claimed_at;
--   alter table public.idempotency_keys drop column if exists lease_token;

alter table public.idempotency_keys
  add column if not exists claimed_at timestamptz;

update public.idempotency_keys
  set claimed_at = coalesce(claimed_at, created_at)
  where claimed_at is null;

alter table public.idempotency_keys
  alter column claimed_at set default now(),
  alter column claimed_at set not null;

alter table public.idempotency_keys
  add column if not exists lease_token uuid;

update public.idempotency_keys
  set lease_token = coalesce(lease_token, gen_random_uuid())
  where lease_token is null;

alter table public.idempotency_keys
  alter column lease_token set default gen_random_uuid(),
  alter column lease_token set not null;
