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

## Idempotency (backend/src/lib/idempotency.js, migration 202610140002_idempotency_keys.sql)

- New table `idempotency_keys`, scoped `unique(actor_id, scope, idempotency_key)`. RLS enabled, no policies — only the backend's service-role key can read/write it (same pattern as `admin_audit_logs`).
- `withIdempotency({ actorId, scope, key, payload, handler })`: opt-in — if the caller sends no key, behavior is unchanged. If a key is sent, the request payload is hashed (SHA-256) and compared against any stored fingerprint for that `(actor, scope, key)`:
  - no existing row → runs `handler()`, stores the result.
  - existing row, same fingerprint, completed → returns the stored result (no re-run).
  - existing row, same fingerprint, not yet completed → `409 REQUEST_IN_PROGRESS` (safe to retry).
  - existing row, different fingerprint → `409 IDEMPOTENCY_KEY_REUSE_MISMATCH`.
  - existing row older than 24h → deleted and retried fresh (lazy expiry; add a scheduled purge if the table grows large).
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
