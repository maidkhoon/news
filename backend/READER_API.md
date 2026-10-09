# Reader API and integrations

Base URL: `https://news-api-egmd.onrender.com`

## Public reader endpoints

- `GET /api/health` — backend health.
- `GET /api/categories` — category list.
- `GET /api/articles?page=1&limit=30` — published article metadata only.
- `GET /api/articles/:slug` — article detail; free content is public and premium content requires a valid Supabase bearer token plus an active subscription.
- `GET /api/users/me` — requires `Authorization: Bearer <Supabase access token>`; creates a profile on first sign-in without overwriting an existing role/status.
- `GET /api/subscriptions/me` — requires a Supabase bearer token; returns active subscription state.
- `POST /api/subscriptions/verify-google-play` — requires a bearer token and a Google Play purchase token. The server verifies the token against Google Play before granting access.
- `POST /api/devices/register` — requires a bearer token; registers an Expo push token for Android or iOS.
- `DELETE /api/devices/register` — unregisters a device token belonging to the current user.
- `GET /api/notifications` — requires a bearer token; returns published-research notifications.

## Admin publishing

When an administrator creates or changes an article to `PUBLISHED`, the backend records a notification and attempts to send Expo push messages to registered devices. Push delivery failures do not fail the article publish request.

## Render environment for Google Play

Set these values only in the backend Render service, never in the mobile app:

- `GOOGLE_PLAY_PACKAGE_NAME` — must match the Android application ID.
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` — service-account JSON with Play Developer API access.
- `GOOGLE_PLAY_BASIC_MONTHLY_PRODUCT_ID`
- `GOOGLE_PLAY_BASIC_YEARLY_PRODUCT_ID`
- `GOOGLE_PLAY_PRO_MONTHLY_PRODUCT_ID`
- `GOOGLE_PLAY_PRO_YEARLY_PRODUCT_ID`

The four mobile `EXPO_PUBLIC_GOOGLE_PLAY_*_PRODUCT_ID` values must match the server product IDs and products created in Google Play Console. The service account JSON is secret and must never be committed to GitHub.
