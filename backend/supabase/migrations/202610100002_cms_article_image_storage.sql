-- Public read access lets the mobile app render article cover images.
-- Only active admins may upload, replace or delete objects in this bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'article-images',
  'article-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Active admins upload article images" on storage.objects;
create policy "Active admins upload article images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'article-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'ADMIN'
      and p.status = true
  )
);

drop policy if exists "Active admins update article images" on storage.objects;
create policy "Active admins update article images"
on storage.objects for update to authenticated
using (
  bucket_id = 'article-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'ADMIN'
      and p.status = true
  )
)
with check (
  bucket_id = 'article-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'ADMIN'
      and p.status = true
  )
);

drop policy if exists "Active admins delete article images" on storage.objects;
create policy "Active admins delete article images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'article-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'ADMIN'
      and p.status = true
  )
);
