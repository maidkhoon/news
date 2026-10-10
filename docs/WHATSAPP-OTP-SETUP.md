# BazaarNexa WhatsApp OTP and AI Briefings Setup

## WhatsApp OTP

The mobile app requests phone OTP through Supabase Auth with the WhatsApp channel. Supabase currently supports WhatsApp as a phone OTP channel with Twilio or Twilio Verify; this does not work until the provider is configured in the Supabase project.

1. Open Supabase Dashboard → Authentication → Sign In / Providers → Phone.
2. Enable phone authentication and configure the Twilio or Twilio Verify provider credentials.
3. In Twilio, enable/configure WhatsApp for authentication messages and use an approved WhatsApp sender/template as required by your account and region.
4. Ensure the phone number is stored in E.164 format. BazaarNexa currently normalizes Indian numbers to +91 followed by 10 digits.
5. Test with a WhatsApp-enabled phone number. Check Supabase Auth logs and Twilio messaging/Verify logs for delivery failures and rate limits.
6. Do not set phone auto-confirmation if you expect users to verify an OTP. Never put Twilio secrets in the mobile app or GitHub.

The app verifies the entered code through Supabase Auth. The verification type remains the Supabase phone OTP type even when the delivery channel is WhatsApp.

## AI-powered briefings

Set these secrets in Render → news-api → Environment (never commit secrets):

- `NVIDIA_API_KEY`: API key for NVIDIA API Catalog / NIM.
- `NVIDIA_MODEL` (optional): model ID; default is `meta/llama-3.3-70b-instruct`.

The mobile app calls `POST /api/insights/summary` with a published article slug. The API sends article text to the configured model and returns structured bullet points and key terms, plus the original source URL. The endpoint returns HTTP 503 until `NVIDIA_API_KEY` is configured.

## Related coverage

`GET /api/insights/context/:slug` finds related published stories by title keyword overlap and category. This is a first-pass related-story feature, not a claim that two reports are about the exact same event. Editorial/source grouping and event timelines should be improved as ingestion volume grows.

## Personalized daily briefing

The mobile app lets users choose India, Crypto, and Cricket topics and stores those preferences on-device. This filters the home feed. A server-generated scheduled digest/push notification is a follow-up phase: it needs account-linked topic preferences, a scheduler, and push delivery tests before it should be described as a delivered daily digest.
