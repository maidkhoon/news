# Master Admin Setup

The Newsroom API recognizes two privileged profile roles:

- `ADMIN`: can use the Newsroom tools and read the user list.
- `MASTER_ADMIN`: can additionally assign/remove ADMIN access and manually assign/remove plan entitlements.

## One-time bootstrap

Do not promote an account from the mobile client. A trusted project owner must use the Supabase SQL editor and promote the already-verified, enabled administrator account explicitly.

First inspect candidate accounts:

```sql
select id, email, role, status
from public.profiles
where role in ('ADMIN', 'MASTER_ADMIN')
order by created_at;
```

After confirming the exact account belongs to the project owner, run an update using that account's exact profile ID (preferred) or exact verified email:

```sql
update public.profiles
set role = 'MASTER_ADMIN', updated_at = now()
where id = '<CONFIRMED_PROFILE_UUID>'
  and role = 'ADMIN'
  and status = true
returning id, email, role, status;
```

Confirm exactly one row was returned. If zero rows are returned, stop and inspect the account rather than broadening the update. Do not commit profile IDs, access tokens, service-role keys, or other secrets to Git.

The application deliberately does not auto-promote an account based on email, because email-based promotion in application code would create an unsafe privilege-escalation path.

## Permission boundaries

- Role assignment accepts only `ADMIN` or `USER`; the mobile interface cannot create another `MASTER_ADMIN`.
- The master-admin account cannot change its own role through this endpoint.
- Non-master admins cannot assign/remove admin roles or manually change subscription entitlements.
- Manual plan assignment changes app entitlement only; it does not charge, refund, or cancel a Google Play subscription.
- Manual plan changes and role changes are written to `admin_audit_logs`.
