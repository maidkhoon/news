-- 202610140001_article_admin_listing_indexes.sql ran `create extension if
-- not exists pg_trgm;` with no schema, which installs it into `public`.
-- Supabase's own convention (and its Security Advisor lint) is to keep
-- extensions out of `public` and in a dedicated `extensions` schema, which
-- Supabase projects already include in the default search_path - this is
-- why relocating here doesn't require any search_path change of our own.
--
-- Handles every starting state safely:
--   * not installed anywhere yet -> create directly in extensions
--   * already installed in public (e.g. by 202610140001 on an older run) -> move it
--   * already installed in extensions -> no-op
-- pg_trgm is a relocatable extension, so ALTER EXTENSION ... SET SCHEMA
-- updates its catalog entry in place; the articles_title_trgm_idx index
-- built in 202610140001 keeps working without a rebuild.
--
-- Rollback:
--   alter extension pg_trgm set schema public;

create schema if not exists extensions;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    if not exists (
      select 1
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'pg_trgm' and n.nspname = 'extensions'
    ) then
      alter extension pg_trgm set schema extensions;
    end if;
  else
    create extension pg_trgm with schema extensions;
  end if;
end
$$;
