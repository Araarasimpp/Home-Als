-- Prueba (modo "probar": se deshace al final). Actúa como un vendedor real.
\i supabase/sql/2026-10-15_foto_propia.sql
do $$
declare v_yo uuid; v_otro uuid; v_ok boolean;
begin
  select id into v_yo from public.profiles where role = 'vendedor' and activo limit 1;
  select id into v_otro from public.profiles where id <> v_yo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_yo, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_yo::text, true);
  execute 'set local role authenticated';

  -- su propia foto: sí
  insert into storage.objects (bucket_id, name) values ('avatars', v_yo::text || '.jpg');
  update public.profiles set avatar_url = 'https://ejemplo/x.jpg' where id = v_yo;
  raise notice 'propia: ok';

  -- la de otra persona: no
  v_ok := false;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', v_otro::text || '.jpg');
  exception when others then v_ok := true; raise notice 'ajena bloqueada: %', sqlerrm;
  end;
  assert v_ok, 'no debe poder subir la foto de otra persona';
  execute 'reset role';
  raise notice 'PRUEBA OK';
end $$;
