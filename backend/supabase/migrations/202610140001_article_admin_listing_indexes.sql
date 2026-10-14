-- Index the query shapes actually used by the mobile/admin APIs that were not
-- yet covered by existing indexes:
--   * admin.js  GET /admin/articles  -> order by updated_at desc, no filter
--   * articles.js GET /articles      -> status = 'PUBLISHED' order by published_at desc
--                                       (existing articles_category_status_published_idx
--                                       only helps when a category filter is present)
--   * articles.js GET /articles      -> ilike '%term%' on title (substring search)
--   * admin-users.js GET /admin/users -> order by created_at desc limit 500
--
-- Rollback:
--   drop index if exists public.articles_updated_at_idx;
--   drop index if exists public.articles_status_published_idx;
--   drop index if exists public.profiles_created_at_idx;
--   drop index if exists public.articles_title_trgm_idx;
--   -- only drop the extension if nothing else on the database depends on it
--   drop extension if exists pg_trgm;

create index if not exists articles_updated_at_idx
  on public.articles(updated_at desc);

create index if not exists articles_status_published_idx
  on public.articles(status, published_at desc);

create index if not exists profiles_created_at_idx
  on public.profiles(created_at desc);

-- Title search is a case-insensitive substring match (ilike '%term%'), not
-- full-text search, so a trigram index is used instead of tsvector/GIN
-- full-text search to avoid changing match semantics.
create extension if not exists pg_trgm;

create index if not exists articles_title_trgm_idx
  on public.articles using gin (title gin_trgm_ops);
