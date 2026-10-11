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
- `NVIDIA_MODEL` (optional): model ID; default is `nvidia/nemotron-3-super-120b-a12b`.

The mobile app calls `POST /api/insights/summary` with a published article slug. The API sends article text to the configured model and returns structured bullet points and key terms, plus the original source URL. The endpoint returns HTTP 503 until `NVIDIA_API_KEY` is configured.

### Model retirements (NVIDIA periodically EOLs hosted model IDs)

`meta/llama-3.3-70b-instruct` reached end of life on 2026-08-26; NVIDIA now returns `410 Gone`
for it. The default was changed to `nvidia/nemotron-3-super-120b-a12b`, cross-checked against
NVIDIA's public catalog at build.nvidia.com (same `https://integrate.api.nvidia.com/v1` endpoint,
listed GA, no deprecation notice) **but not verified against the production `NVIDIA_API_KEY`
account** — no access to that key/account was available when this default was changed. Before
relying on this in production:

1. Set `NVIDIA_MODEL` in Render to a model ID you've confirmed works with your actual API key
   (e.g. via a direct `curl` to `https://integrate.api.nvidia.com/v1/chat/completions`), or confirm
   the new default works, then leave `NVIDIA_MODEL` unset to use it.
2. If a model is retired again, Render logs will show `NVIDIA briefing request failed [model-retired] model=...: 410 ...` —
   update `NVIDIA_MODEL` without a code change or deploy.
3. Other distinguishable provider failures logged the same way: `[auth]` (401/403 — check the key),
   `[model-not-found]` (404), `[provider-rate-limited]` (429), `[provider-5xx]`, and a timeout log
   line if NVIDIA doesn't respond within 25s. The app never fabricates a summary on any of these —
   it returns a safe error and the user can retry.

## Related coverage

`GET /api/insights/context/:slug` finds related published stories by title keyword overlap and category. This is a first-pass related-story feature, not a claim that two reports are about the exact same event. Editorial/source grouping and event timelines should be improved as ingestion volume grows.

## Personalized daily briefing

The mobile app lets users choose India, Crypto, and Cricket topics and stores those preferences on-device. This filters the home feed. A server-generated scheduled digest/push notification is a follow-up phase: it needs account-linked topic preferences, a scheduler, and push delivery tests before it should be described as a delivered daily digest.
