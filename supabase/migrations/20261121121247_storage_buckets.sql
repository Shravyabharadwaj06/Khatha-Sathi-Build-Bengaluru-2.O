-- Three PRIVATE buckets. Files are read through short-lived signed URLs, never public links.
-- Path rule: the first folder of every object path is the owner's shop id, e.g.
--   khata-scans/<shop_id>/<import_id>.jpg
--   support-attachments/<shop_id>/<report_id>/<file-name>
--   avatars/<shop_id>/<user_id>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('khata-scans', 'khata-scans', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('support-attachments', 'support-attachments', false, 8388608,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']),
  ('avatars', 'avatars', false, 2097152,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- A signed-in user may read and upload files only inside their own shop's folder.
create policy khata_files_select on storage.objects for select to authenticated
  using (
    bucket_id in ('khata-scans', 'support-attachments', 'avatars')
    and (storage.foldername(name))[1] = (select private.current_shop_id())::text
  );

create policy khata_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id in ('khata-scans', 'support-attachments', 'avatars')
    and (storage.foldername(name))[1] = (select private.current_shop_id())::text
  );

-- Only profile photos may be replaced or removed, and only your own (file name = <your user id>.<ext>).
create policy khata_avatars_update on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select private.current_shop_id())::text
    and storage.filename(name) like (select auth.uid())::text || '.%'
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select private.current_shop_id())::text
    and storage.filename(name) like (select auth.uid())::text || '.%'
  );

create policy khata_avatars_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select private.current_shop_id())::text
    and storage.filename(name) like (select auth.uid())::text || '.%'
  );
