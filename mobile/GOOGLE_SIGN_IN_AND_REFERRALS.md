# BazaarNexa Google Sign-In & Referral Setup

## Google Sign-In (required one-time provider setup)

1. In Google Cloud Console, configure an OAuth consent screen and a **Web application** OAuth client for Supabase Auth.
2. In Supabase Dashboard → Authentication → Providers → Google, enable Google and enter the Google client ID and client secret.
3. Add the Supabase callback URL shown on that provider page to the Google OAuth client's **Authorized redirect URIs**.
4. In Supabase Dashboard → Authentication → URL Configuration → Redirect URLs, allow the native callback: `bazaarnexa://auth/callback`.
5. Keep the OAuth client secret only in Supabase/provider settings. Never put it in the mobile `.env` or app bundle.

The app uses PKCE authorization-code exchange and the existing Supabase AsyncStorage session. Phone OTP remains available.

> **Troubleshooting "Google sign-in callback did not contain an authorization code."**
> This means the client fell back to the implicit flow. `createClient()` in `mobile/lib/supabase.ts` must set `auth.flowType: 'pkce'` — without it, Supabase's GoTrue server never issues a `code` to exchange, regardless of correct dashboard redirect URIs. Confirm dashboard steps 1–4 above are also correct; a redirect-URI mismatch produces a different error (`error`/`error_description` on the callback, surfaced distinctly by `mobile/lib/googleAuthCallback.ts`) rather than a missing code.

## Referral database and backend

1. Run `backend/supabase/migrations/202610110001_referral_system.sql` in the Supabase SQL Editor for the same project configured in Render.
2. Deploy the backend branch to the existing Render service after the PR is reviewed/merged.
3. Optional Render variable: `REFERRAL_REWARD_DAYS=7` (defaults to 7; reward is clamped to 1–365 days).
4. A referral code must be applied before the referred account's first Google Play subscription purchase. The backend grants the inviter a referral entitlement only after Google Play Developer API verification succeeds. Duplicate attribution and reward rows are constrained in the database.

## Mobile dependencies and test build

From the repository root:

```powershell
cd mobile
npm install
npx expo install --check
npx expo-doctor
```

Create a new EAS preview build after installing the dependencies and configuring the Google provider. Existing preview APKs do not contain these changes.

## Manual Android test steps for the Google sign-in callback fix

`mobile/lib/googleAuthCallback.ts` has unit coverage (`npm test` in `mobile/`) for the pure
URL-parsing/classification logic, but the actual browser round-trip (`WebBrowser.openAuthSessionAsync`,
the OS intercepting the `bazaarnexa://` deep link, and `exchangeCodeForSession` hitting a real
Supabase project) can only be verified on a device/emulator with a real Google account and a real
Supabase project. Build a new preview APK (dashboard config above must be done first) and check:

1. Tap "Continue with Google" → Google account picker opens in the in-app browser.
2. Pick an account → browser closes and the app returns to the foreground automatically (no manual
   "open BazaarNexa?" prompt hanging) → lands on the home screen signed in.
3. Force-close and reopen the app → still signed in (session persisted via AsyncStorage).
4. Tap "Continue with Google" again, then press the browser's back/cancel button before picking an
   account → returns to the auth screen with no error alert (the cancelled case must be silent).
5. Temporarily revoke/remove the Google OAuth client's authorized redirect URI in Google Cloud
   Console (or similar misconfiguration), retry sign-in → expect a distinct, readable error alert
   from the `error`/`error_description` callback params, not a crash or a generic JS error.

## Smoke-test checklist

- Guest can browse feed without signing in.
- Phone OTP login still works.
- Google sign-in completes and survives app restart.
- Referral code and share action load for signed-in user.
- A second account can apply a valid code once; invalid, self, duplicate, and post-purchase claims are rejected.
- No referral reward is granted on sign-up alone.
- A successful first verified Google Play purchase grants the referrer the configured premium days, extending an existing entitlement if present.
- Verify premium access while a referral entitlement is active and after expiry.