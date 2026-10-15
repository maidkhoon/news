-- Fail the disposable integration test if the migrations didn't produce
-- the expected indexes, lease columns, extension placement, and storage rules.
do $$
declare
  required_index text;
  required_indexes text[] := array[
    'articles_updated_at_idx',
    'articles_status_published_idx',
    'profiles_created_at_idx',
    'articles_title_trgm_idx',
    'idempotency_keys_created_at_idx'
  ];
  policy_count integer;
  policy_text text;
begin
  foreach required_index in array required_indexes loop
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = required_index
    ) then
      raise exception 'Required index missing: %', required_index;
    end if;
  end loop;

  if to_regclass('public.idempotency_keys') is null then
    raise exception 'public.idempotency_keys table was not created';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'idempotency_keys'
      and column_name = 'claimed_at' and is_nullable = 'NO'
  ) then
    raise exception 'idempotency_keys.claimed_at missing or nullable';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'idempotency_keys'
      and column_name = 'lease_token' and is_nullable = 'NO'
  ) then
    raise exception 'idempotency_keys.lease_token missing or nullable';
  end if;

  if not exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm' and n.nspname = 'extensions'
  ) then
    raise exception 'pg_trgm is not installed in the extensions schema';
  end if;

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname in (
      'Active admins upload article images',
      'Active admins update article images',
      'Active admins delete article images'
    );

  if policy_count <> 3 then
    raise exception 'Expected 3 article image policies, found %', policy_count;
  end if;

  select string_agg(coalesce(qual, '') || ' ' || coalesce(with_check, ''), ' ')
    into policy_text
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname in (
      'Active admins upload article images',
      'Active admins update article images',
      'Active admins delete article images'
    );

  if policy_text not like '%MASTER_ADMIN%' then
    raise exception 'Article image policies do not include MASTER_ADMIN';
  end if;
end
$$;

select 'Migration integration assertions passed' as result;
