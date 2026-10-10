-- Restrict self-service profile updates to user-editable fields.
-- Authenticated users may update their own name, phone, and profile email,
-- but must not be able to modify role, status, or server-managed timestamps.
-- This migration changes database privileges only; it does not alter live data.

begin;

revoke update on table public.profiles from authenticated;

-- Explicitly remove any column-level update grants on protected fields.
revoke update (role, status, created_at, updated_at)
  on table public.profiles
  from authenticated;

grant update (name, phone, email)
  on table public.profiles
  to authenticated;

commit;
