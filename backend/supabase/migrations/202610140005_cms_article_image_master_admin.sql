-- Keep the article image bucket restricted to enabled newsroom admins,
-- including MASTER_ADMIN accounts recognized by the API middleware.
drop policy if exists "Active admins upload article images" on storage.objects;
create policy "Active admins upload article images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'article-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('ADMIN', 'MASTER_ADMIN')
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
      and p.role in ('ADMIN', 'MASTER_ADMIN')
      and p.status = true
  )
)
with check (
  bucket_id = 'article-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('ADMIN', 'MASTER_ADMIN')
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
      and p.role in ('ADMIN', 'MASTER_ADMIN')
      and p.status = true
  )
);
