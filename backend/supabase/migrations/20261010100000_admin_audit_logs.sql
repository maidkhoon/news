-- Admin user management audit trail. No auth secrets or purchase tokens are stored here.
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  target_user_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('USER_STATUS_CHANGED', 'USER_PROFILE_UPDATED', 'PLAN_ASSIGNED', 'PLAN_REMOVED')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_target_created_idx
  on public.admin_audit_logs (target_user_id, created_at desc);

alter table public.admin_audit_logs enable row level security;
