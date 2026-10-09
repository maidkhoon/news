# Newsroom Admin

React + Vite admin panel for the INDIA and CRYPTO editorial workflow.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set the Supabase project URL and **publishable** key. Never put the Supabase secret/service-role key in this frontend.
3. Set `VITE_API_BASE_URL` to the deployed News API URL.
4. From this directory run:

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Vite outputs static assets to `dist/`.

## Render Static Site settings

- Repository: `https://github.com/maidkhoon/news`
- Branch: `main` after the Admin Panel pull request is merged
- Root directory: `admin`
- Build command: `npm install && npm run build`
- Publish directory: `dist`
- Environment variables:
  - `VITE_SUPABASE_URL`: the NEWS Supabase project URL
  - `VITE_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key (safe for browser use; database access remains protected by RLS and backend authorization)
  - `VITE_API_BASE_URL`: `https://news-api-egmd.onrender.com`

## Authentication

The login screen emails a Supabase sign-in link. Add the final Render static-site URL to Supabase Authentication URL Configuration > Redirect URLs. The backend validates every admin API request and requires a profile with `role = ADMIN` and `status = true`.

The UI supports article listing, search, category/status filters, create/edit, free/premium access, draft/publish/unpublish, and delete. Image upload and subscription management are not implemented in this version.
