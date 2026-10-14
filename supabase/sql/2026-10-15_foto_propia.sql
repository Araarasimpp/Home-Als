-- Home ALS · 2026-10-15
-- Cada persona puede subir, cambiar o quitar SU PROPIA foto de perfil
-- (archivo avatars/<su id>.jpg). El admin ya podía con todas.
-- Sin begin/commit: el workflow "SQL en Supabase" lo envuelve en una transacción.

drop policy if exists "avatars: cada quien sube la suya" on storage.objects;
create policy "avatars: cada quien sube la suya" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg');

drop policy if exists "avatars: cada quien cambia la suya" on storage.objects;
create policy "avatars: cada quien cambia la suya" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg')
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg');

drop policy if exists "avatars: cada quien borra la suya" on storage.objects;
create policy "avatars: cada quien borra la suya" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg');
