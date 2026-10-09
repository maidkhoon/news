# Admin Article API

These endpoints are protected by Supabase access-token verification and an active `public.profiles` row whose role is `ADMIN`.

## Promote an existing account to admin

1. Sign in to the app once using the admin's phone number so that the account exists in Supabase Authentication.
2. In Supabase SQL Editor, find the account ID:

```sql
select id, phone from auth.users order by created_at desc;
```

3. Promote only the intended account. Replace the UUID with that user's actual Auth ID:

```sql
insert into public.profiles (id, role, status)
values ('REPLACE-WITH-AUTH-USER-UUID', 'ADMIN', true)
on conflict (id) do update
set role = 'ADMIN', status = true, updated_at = now();
```

Do not promote an account based only on a phone number supplied by an unverified requester. Never put the Supabase secret key in the mobile app or browser.

## Authentication

Send the signed-in user's Supabase access token as a bearer token:

```
Authorization: Bearer <SUPABASE_ACCESS_TOKEN>
Content-Type: application/json
```

Requests without a valid token return `401`; authenticated non-admin users return `403`.

## Endpoints

- `GET /api/admin/articles?page=1&limit=20` — list drafts, published and unpublished articles.
- `POST /api/admin/articles` — create an article.
- `PATCH /api/admin/articles/:id` — update article fields.
- `DELETE /api/admin/articles/:id` — delete an article.

Create body example:

```json
{
  "title": "Bitcoin Market Analysis",
  "content": "Article content goes here.",
  "category_id": "UUID-FOR-CRYPTO-CATEGORY",
  "image_url": null,
  "access_type": "PREMIUM",
  "status": "DRAFT"
}
```

Allowed `access_type` values: `FREE`, `PREMIUM`. Allowed `status` values: `DRAFT`, `PUBLISHED`, `UNPUBLISHED`. Publishing sets `published_at`; moving an article out of the published state clears it.

Before the admin UI is built, test only with a real admin account and its short-lived access token. Do not paste tokens or secret keys into chat, commit them, or expose them in client-side code.
