# News Android App

Customer-facing Android application for the paid news and research publication platform.

## Stack

- React Native + Expo + TypeScript
- Supabase Auth
- Supabase database/API
- FCM for push notifications (planned)

## Current implementation

- Supabase client with persistent mobile session storage
- Phone-number login using SMS OTP
- OTP verification
- Basic authenticated home placeholder for INDIA and CRYPTO
- Sign out
- Environment variables via `.env`

## Run locally

1. Copy `.env.example` to `.env`.
2. Add the Supabase Project URL and **publishable key** from the Supabase Connect/API settings.
3. Install dependencies:

```bash
cd mobile
npm install
```

4. Start Expo:

```bash
npx expo start
```

5. Scan the QR code with Expo Go on an Android phone.

The current phone login uses the India `+91` country code and a 10-digit mobile number. Supabase sends the SMS OTP through the configured Twilio provider.

## Security

- Never put the Supabase service-role key in this app.
- Only the Supabase publishable key belongs in the mobile app.
- Do not commit `.env` or provider secrets.
