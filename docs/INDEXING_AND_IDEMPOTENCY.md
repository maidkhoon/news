# Database indexing and idempotency

## Indexing (backend/supabase/migrations/202610140001_article_admin_listing_indexes.sql)

Added to cover query shapes that existing indexes didn't:

| Index | Backs |
|---|---|
| `articles_updated_at_idx` on `articles(updated_at desc)` | `GET /api/admin/articles` (admin list, sorted by `updated_at`, paginated) |
| `articles_status_published_idx` on `articles(status, published_at desc)` | `GET /api/articles` with no category filter (existing `articles_category_status_published_idx` only helps when a category is given) |
| `profiles_created_at_idx` on `profiles(created_at desc)` | `GET /api/admin/users` (`order by created_at desc limit 500`) |
| `articles_title_trgm_idx` (GIN, `pg_trgm`) on `articles(title)` | `ilike '%term%'` title search in `GET /api/articles` — trigram, not full-text, to keep the existing substring-match semantics |

Status: **created locally only, not applied to any remote database.** No `psql`/Supabase CLI/local Postgres was available in this environment to run `EXPLAIN` or execute the migration, so there is no query-plan evidence beyond manual review of the SQL and the exact query call-sites listed above. Apply with the Supabase CLI or SQL editor, then verify with `EXPLAIN ANALYZE` on the queries above.

`202610140001` created `pg_trgm` with no schema (installs into `public`). Follow-up migration `202610140004_pg_trgm_extensions_schema.sql` relocates it into Supabase's conventional `extensions` schema (handles "not installed yet", "installed in public", and "already in extensions" starting states safely; `pg_trgm` is relocatable so the existing `articles_title_trgm_idx` keeps working without a rebuild). Also unapplied.

## Idempotency (backend/src/lib/idempotency.js, migration 202610140002_idempotency_keys.sql)

- New table `idempotency_keys`, scoped `unique(actor_id, scope, idempotency_key)`. RLS enabled, no policies — only the backend's service-role key can read/write it (same pattern as `admin_audit_logs`).
- `withIdempotency({ actorId, scope, key, payload, handler })`: opt-in — if the caller sends no key, behavior is unchanged. If a key is sent, the request payload is hashed (SHA-256) and compared against any stored fingerprint for that `(actor, scope, key)`:
  - no existing row → runs `handler()`, stores the result.
  - existing row, same fingerprint, completed → returns the stored result (no re-run), regardless of age (short of the 24h full-key TTL below).
  - existing row, different fingerprint → `409 IDEMPOTENCY_KEY_REUSE_MISMATCH`.
  - existing row older than 24h (`created_at`) → deleted and retried fresh (lazy expiry; add a scheduled purge if the table grows large).
  - existing row, same fingerprint, not yet completed, lease renewed within the last 30s (`claimed_at`) → `409 REQUEST_IN_PROGRESS` (genuinely in-flight; safe to retry shortly).
  - existing row, same fingerprint, not yet completed, lease stale (no renewal for 30s) → **reclaim**: the original claimant is presumed dead. One caller atomically reclaims via a compare-and-swap `UPDATE ... WHERE id = ? AND lease_token = ? AND response_body IS NULL` and runs the handler; anyone who loses that race gets `409 REQUEST_IN_PROGRESS`.

**Ownership, lease renewal, and why a slow-but-alive handler isn't falsely reclaimed**: the original issue with a plain 30s staleness check was that it couldn't distinguish "crashed" from "just slow" — a handler that legitimately takes longer than 30s (a retry-laden push fan-out, a cold connection) would get its lease stolen by a reclaimer *while it was still running*, and since the reclaimer would then also run the handler, that was a real duplicate-execution path. Fixed with:
- A `lease_token` (random UUID, migration `202610140003_idempotency_keys_claim_lease.sql`) that changes on every claim/reclaim, used as a compare-and-swap fencing value.
- The current owner renews its own lease (`claimed_at = now()`, same `lease_token`) every 10s (`RENEW_INTERVAL_MS`) for as long as its handler is running, via a background interval cleared in a `finally` block. As long as renewal reaches the database, `claimed_at` never goes stale, so `CLAIM_TIMEOUT_MS` is never exceeded and no reclaim is attempted.
- The final "persist the result" write is *also* conditioned on `lease_token` matching. If a reclaim did happen (meaning this owner's renewals failed or lagged for the full 30s — in practice requires the renewal path to be unreachable while the handler's own work, through the same database, keeps succeeding), the persist affects zero rows; this is logged, and the real result is still returned to *this* caller (the work genuinely happened), but it is not recorded as the key's canonical stored response.
- **This is best-effort, not a guarantee of exactly-once execution.** A sustained renewal-only outage overlapping a still-succeeding handler is the one scenario this can't fully rule out. In this codebase it's a narrow window because `admin_article_create`'s handler and the idempotency bookkeeping go through the same Supabase/Postgres instance — if that instance is unreachable for renewals, the handler's own `articles` insert is unreachable too. And for that specific handler there's a second, independent backstop: `articles.slug` is globally unique, so even a false reclaim re-running the handler gets a `409` slug conflict rather than actually inserting a duplicate row.
- Response-persistence failures (not reclaim-related, e.g. a transient DB error on the final write) are retried up to 3 times with backoff before giving up; if all retries fail, `withIdempotency` throws rather than reporting success while the response may be unrecorded. The row is left with `response_body = null`, which self-heals: once the lease goes stale, a later retry can reclaim and run again (backed by the same `articles.slug` safety net for this handler).
- Deleting an expired (24h+) key is error-checked: a delete failure throws immediately instead of recursing blindly or assuming cleanup succeeded. Concurrent requests that all observe the same expired key race safely to a single fresh claim via the same unique-constraint-backed insert used everywhere else; the rest observe the fresh claim and get `409 REQUEST_IN_PROGRESS` (or a replay, if the winner has already finished).
- Wired into `POST /api/admin/articles` (`scope: "admin_article_create"`) via an optional `Idempotency-Key` request header.
- `mcp-server/src/index.js` and `tools/bazaarnexa-mcp/src/index.js` both send `Idempotency-Key = sha256(title|category_id|content)` on `save_draft` / `bazaarnexa_create_draft`, so re-invoking the same draft returns the original article instead of erroring on the slug-uniqueness conflict or creating a near-duplicate under a different slug.
- `PATCH /api/admin/articles/:id`: fixed a duplicate-side-effect bug — retrying/resubmitting a publish (`status: "PUBLISHED"`) on an already-published article no longer re-inserts a push notification. The pre-update status is checked before deciding whether to notify.
- Subscriptions (`POST /api/subscriptions/verify-google-play`) already had working idempotency before this change (unique `purchase_token`, `upsert` with `onConflict`, unique partial index on `subscriptions.referral_id` guarding the referral reward) — reused as-is, not duplicated.
- Not covered / out of scope: no payment gateway exists to idempotency-protect beyond the above. No webhooks exist in this repo.
- Tests: `backend/src/lib/idempotency.test.js` (unit, in-memory fake Supabase table) and `backend/src/routes/admin.test.js` (integration against the real route). Run with `npm test` in `backend/`.

## Known duplicate MCP implementation

The repo has **two** local MCP servers for drafting articles:
- `mcp-server/` (repo root) — Supabase password sign-in + token refresh, not referenced by CI.
- `tools/bazaarnexa-mcp/` — static `BAZAARNEXA_ACCESS_TOKEN` env var (expires, must be refreshed by hand), wired into `.github/workflows/validate.yml` and `.github/workflows/bazaarnexa-mcp.yml`.

Both are draft-only and now carry the same idempotency-key fix. Decide which one is canonical and remove the other to avoid drift.
