-- Prueba (modo "probar": se deshace al final). Solo muestra totales, sin nombres.
\i supabase/sql/2026-10-15_ranking_metas.sql
do $$
declare v_admin uuid; v_vend uuid; n_v int; n_d int; total numeric; v_meta numeric;
begin
  select id into v_admin from public.profiles where role = 'admin' and activo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select count(*) filter (where tipo = 'vendedor'), count(*) filter (where tipo = 'domiciliario'), sum(ventas)
    into n_v, n_d, total from public.ranking(date_trunc('month', now() at time zone 'America/Bogota')::date, (now() at time zone 'America/Bogota')::date);
  raise notice 'ranking del mes: % vendedores, % domiciliarios, ventas totales %', n_v, n_d, total;
  assert n_v > 0 and n_d > 0, 'debe haber vendedores y domiciliarios';
  -- el admin puede fijar metas
  select usuario_id into v_vend from public.ranking(current_date, current_date) where tipo = 'vendedor' limit 1;
  insert into public.metas (usuario_id, meta_ventas) values (v_vend, 2000000)
    on conflict (usuario_id) do update set meta_ventas = excluded.meta_ventas;
  select meta into v_meta from public.ranking(current_date, current_date) where usuario_id = v_vend and tipo = 'vendedor';
  assert v_meta = 2000000, 'la meta debe aparecer en el ranking';
  raise notice 'PRUEBA OK';
end $$;
