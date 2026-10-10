-- Support automated news ingestion while retaining publisher attribution.
alter table public.articles
  add column if not exists source_url text,
  add column if not exists source_name text;

create unique index if not exists articles_source_url_unique
  on public.articles (source_url)
  where source_url is not null;

insert into public.categories (name, slug)
values
  ('INDIA', 'india'),
  ('CRYPTO', 'crypto'),
  ('CRICKET', 'cricket')
on conflict (slug) do nothing;
