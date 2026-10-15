# Supabase migration review and safe rollout

**Review date:** 2026-10-15  
**Scope:** Static repository review plus read-only inspection of the connected NEWS Supabase project.  
**Database changes:** None. No migrations were applied, no migration history was edited, and no production configuration or deployment was changed.

## Findings addressed by this PR

- Resolved the duplicate repository migration version 202610140001 by assigning the Master Admin article-image policy migration a later unique version, 202610140005.
- Added a CI check that rejects malformed migration filenames, duplicate versions, and incorrect ordering of the article-index/pg_trgm and idempotency-table/lease migration pairs.
- Documented the distinction between repository migration files and the live project's migration history.

## Live migration history does not match repository filenames

The connected project's migration history contained these entries at review time:

| Live version | Live name | Related repository filename |
|---|---|---|
| 20261009142506 | profiles_column_update_permissions | 202610090001_profiles_column_update_permissions.sql |
| 20261010042756 | automated_news_ingestion | 202610100001_automated_news_ingestion.sql |
| 20261010055435 | admin_audit_logs | 20261010100000_admin_audit_logs.sql |

These names look related, but a matching name alone does **not** prove that every statement in a repository migration is reflected in the live schema. Before using supabase db push or applying SQL, compare each migration's complete DDL with the live tables, indexes, grants, and policies. Use the Supabase migration repair workflow only after that comparison confirms the exact state. Do not blindly re-run the older files: they contain non-idempotent statements such as CREATE POLICY.

## Read-only findings from the connected database

At review time:

- The project was active and contained 426 articles, 6 profiles, and 3 categories.
- The live migration history contained the three entries listed above; it did not list the new indexing, idempotency, lease, extension-schema, or Master Admin image-policy migrations.
- The public.idempotency_keys table was absent.
- The pg_trgm extension was absent.
- The live article-image insert/update/delete policies allowed enabled ADMIN profiles but did not include MASTER_ADMIN.
- RLS was enabled on public.admin_audit_logs, with no client-facing policies returned by pg_policies. This is consistent with backend-only service-role access only if the application never accesses this table directly from a user client.
- Security Advisor reported leaked-password protection disabled. Performance Advisor reported foreign-key index and RLS auth-function performance warnings; those are separate follow-up items and are not changed by this PR.

These are point-in-time observations, not a guarantee that the project has not changed since the review.

## Migration dependency order

The intended order for the new migrations is:

1. 202610140001_article_admin_listing_indexes.sql — listing indexes and the trigram index.
2. 202610140002_idempotency_keys.sql — idempotency table and unique key.
3. 202610140003_idempotency_keys_claim_lease.sql — lease columns on that table.
4. 202610140004_pg_trgm_extensions_schema.sql — ensure pg_trgm resides in extensions.
5. 202610140005_cms_article_image_master_admin.sql — allow enabled ADMIN and MASTER_ADMIN profiles to manage article-image objects.

The pg_trgm migration handles the extension being absent, already in public, or already in extensions. The index migration and extension-schema migration must still be tested together on a disposable development database before production rollout.

## Required validation before production

1. Review the PR and confirm the migration filenames are unique.
2. Use a separate development Supabase project or an approved disposable database; do not use production for first-run testing.
3. Reconcile the three existing migration-history entries against actual live schema state before invoking the migration runner.
4. Apply the full sequence to development and verify the extension schema, all expected indexes, RLS policies, and idempotency lease columns.
5. Run backend tests and query-plan checks (including EXPLAIN for the article listing/search queries).
6. Re-run Supabase Security and Performance Advisors.
7. Only after the review and explicit approval should a separate production rollout be planned.

## Out of scope

This PR does not change database contents, migration history, secrets, Supabase settings, Render settings, or deployment state.
