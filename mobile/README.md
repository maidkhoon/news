# BazaarNexa Mobile App

Android-first customer app for INDIA and CRYPTO market research.

## Implemented app features

- Supabase phone OTP authentication for India (+91)
- Dark navy/blue BazaarNexa interface
- Published article feed, featured story, search and category filters
- Article detail screen with server-enforced premium access checks
- Persistent saved articles/bookmarks
- Subscription plan selection, native Google Play Billing purchase flow, server verification and restore-purchase workflow
- Notification inbox and Expo push registration workflow
- Deep-link handling from push notification payloads
- Pull-to-refresh, loading, empty and error states

## Stack

- React Native + Expo + TypeScript
- Supabase Auth
- Existing Render Express API
- Expo Notifications (remote push requires an EAS project and device credentials)
- Google Play subscription verification on the backend

## Local setup

1. Copy `.env.example` to `.env`.
2. Set `EXPO_PUBLIC_SUPABASE_URL` and the Supabase **publishable key**.
3. Set `EXPO_PUBLIC_API_BASE_URL=https://news-api-egmd.onrender.com`.
4. Install packages and start Expo:

```bash
cd mobile
npm install
npx expo start
```

## Push notifications

Remote notifications require an EAS project and a development/production build; Expo Go alone is not sufficient for the final Android push test.

1. Run `npx eas-cli init` and link the app to the correct EAS project.
2. Add the generated `extra.eas.projectId` to `app.json`.
3. Configure Android FCM credentials for the EAS project.
4. Build an Android development client with `npx eas-cli build --profile development --platform android`.
5. Install the build, allow notifications, sign in, and publish an article from the admin panel to test delivery.

## Google Play subscriptions

The native Google Play Billing flow, purchase restoration and server-side verification request are implemented. Live purchase checkout will work only after:
- Create Basic/Pro monthly and yearly subscriptions in Google Play Console.
- Set the four matching product IDs in the backend Render environment.
- Set `GOOGLE_PLAY_PACKAGE_NAME` and `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` in Render, using a service account authorized for Play Developer API access.
- Configure the four matching `EXPO_PUBLIC_GOOGLE_PLAY_*_PRODUCT_ID` values in the mobile build environment.
- Build and test with an Android development client. Google Play test purchases must be made by licensed tester accounts from a Play testing track.

The backend verification endpoint never trusts a client-supplied price or expiry; it checks purchase tokens with Google Play. Until the native billing client and Play Console products are configured, the app clearly reports that checkout is not enabled.

## Security

- Never put the Supabase service-role key in this app.
- Only the Supabase publishable key belongs in the mobile app.
- Never commit `.env`, Google service-account JSON, or provider secrets.
