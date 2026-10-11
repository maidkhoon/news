-- BazaarNexa referrals: one attribution per invited user and one reward per referral.
alter table public.profiles
  add column if not exists referral_code text;

create unique index if not exists profiles_referral_code_unique
  on public.profiles(referral_code)
  where referral_code is not null;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null unique references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'rewarded')),
  reward_days integer not null default 7 check (reward_days between 1 and 365),
  paid_subscription_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint referrals_no_self_referral check (referrer_user_id <> referred_user_id)
);

alter table public.subscriptions
  add column if not exists referral_id uuid references public.referrals(id) on delete set null;

create unique index if not exists subscriptions_referral_reward_unique
  on public.subscriptions(referral_id)
  where referral_id is not null;

create index if not exists referrals_referrer_created_idx
  on public.referrals(referrer_user_id, created_at desc);

alter table public.referrals enable row level security;

create policy "users can read referrals they sent or received"
on public.referrals
for select
to authenticated
using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());

-- Writes are intentionally performed by the trusted backend service role.
