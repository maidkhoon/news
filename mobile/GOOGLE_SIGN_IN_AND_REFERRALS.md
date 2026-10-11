# BazaarNexa Google Sign-In & Referral Setup

## Google Sign-In (required one-time provider setup)

1. In Google Cloud Console, configure an OAuth consent screen and a **Web application** OAuth client for Supabase Auth.
2. In Supabase Dashboard → Authentication → Providers → Google, enable Google and enter the Google client ID and client secret.
3. Add the Supabase callback URL shown on that provider page to the Google OAuth client's **Authorized redirect URIs**.
4. In Supabase Dashboard → Authentication → URL Configuration → Redirect URLs, allow the native callback: `bazaarnexa://auth/callback`.
5. Keep the OAuth client secret only in Supabase/provider settings. Never put it in the mobile `.env` or app bundle.

The app uses PKCE authorization-code exchange and the existing Supabase AsyncStorage session. Phone OTP remains available.

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

## Smoke-test checklist

- Guest can browse feed without signing in.
- Phone OTP login still works.
- Google sign-in completes and survives app restart.
- Referral code and share action load for signed-in user.
- A second account can apply a valid code once; invalid, self, duplicate, and post-purchase claims are rejected.
- No referral reward is granted on sign-up alone.
- A successful first verified Google Play purchase grants the referrer the configured premium days, extending an existing entitlement if present.
- Verify premium access while a referral entitlement is active and after expiry.