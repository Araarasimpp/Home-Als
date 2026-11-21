-- Prueba de Pagos de comisiones (solo modo "probar": todo se deshace al final).
-- El rol recolector no se puede probar aquí: un valor de enum nuevo no se puede
-- usar en la misma transacción en que se crea.
\i supabase/sql/2026-11-22_pagos_recolector.sql

do $$
declare
  v_admin uuid; v_vend uuid; v_res jsonb; v_peds jsonb; v_pago uuid; v_ok boolean; v_n int; v_total numeric; v_desde date;
begin
  select id into v_admin from public.profiles where 'admin' = any (roles::text[]) and activo order by created_at limit 1;
  -- Vendedor con algún pedido entregado
  select p.vendedor_id into v_vend from public.pedidos p join public.profiles u on u.id = p.vendedor_id
   where p.estado = 'entregado' and 'vendedor' = any (u.roles::text[]) and p.comision <> 0 and p.created_at > now() - interval '55 days'
   order by p.created_at desc limit 1;
  raise notice 'admin=% vendedor=%', v_admin, v_vend;

  -- Contar desde hace 60 días para tener datos
  update public.configuracion set comisiones_desde = (now() at time zone 'America/Bogota')::date - 60;
  v_desde := (now() at time zone 'America/Bogota')::date - 60;

  -- Como admin
  update public.profiles set role = 'admin' where id = v_admin;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_res := public.comisiones_periodo(v_desde, (now() at time zone 'America/Bogota')::date);
  raise notice 'vendedores con comisión: %', jsonb_array_length(v_res);
  raise notice 'primero: %', left((v_res -> 0)::text, 300);

  v_peds := public.comision_pedidos(v_vend, v_desde, (now() at time zone 'America/Bogota')::date, null);
  raise notice 'pedidos por pagar de %: %', v_vend, jsonb_array_length(v_peds);
  select sum((x ->> 'comision')::numeric) into v_total from jsonb_array_elements(v_peds) x;

  -- Transferencia sin comprobante: no deja
  v_ok := false;
  begin perform public.pagar_comisiones(v_vend, v_desde, (now() at time zone 'America/Bogota')::date, 'transferencia', '{}', 'x');
  exception when others then v_ok := true; raise notice 'bloqueado sin comprobante: %', sqlerrm; end;
  assert v_ok, 'transferencia sin comprobante';

  -- En efectivo sí
  v_pago := public.pagar_comisiones(v_vend, v_desde, (now() at time zone 'America/Bogota')::date, 'efectivo', '{}', 'Prueba');
  select cantidad_pedidos, total into v_n, v_total from public.pagos_comision where id = v_pago;
  raise notice 'pago % : % pedidos, total %', v_pago, v_n, v_total;
  assert v_n = jsonb_array_length(v_peds), 'cantidad de pedidos del pago';
  assert jsonb_array_length(public.comision_pedidos(v_vend, v_desde, (now() at time zone 'America/Bogota')::date, null)) = 0, 'ya no quedan por pagar';
  assert jsonb_array_length(public.comision_pedidos(v_vend, null, null, v_pago)) = v_n, 'pedidos del pago';
  assert exists (select 1 from public.notificaciones where usuario_id = v_vend and tipo = 'pago_comision'), 'aviso al vendedor';

  -- Pagar dos veces lo mismo: no deja
  v_ok := false;
  begin perform public.pagar_comisiones(v_vend, v_desde, (now() at time zone 'America/Bogota')::date, 'efectivo', '{}', 'otra');
  exception when others then v_ok := true; raise notice 'bloqueado doble pago: %', sqlerrm; end;
  assert v_ok, 'doble pago';

  -- Anular: vuelven a quedar por pagar
  perform public.anular_pago_comision(v_pago);
  assert jsonb_array_length(public.comision_pedidos(v_vend, v_desde, (now() at time zone 'America/Bogota')::date, null)) = v_n, 'anular devuelve pedidos';

  -- El vendedor solo ve lo suyo y no puede pagar
  update public.profiles set role = 'vendedor' where id = v_vend;
  perform set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  v_res := public.comisiones_periodo(v_desde, (now() at time zone 'America/Bogota')::date);
  assert jsonb_array_length(v_res) <= 1, 'vendedor ve solo lo suyo';
  raise notice 'el vendedor ve: %', left(v_res::text, 200);
  v_ok := false;
  begin perform public.pagar_comisiones(v_vend, v_desde, (now() at time zone 'America/Bogota')::date, 'efectivo', '{}', 'x');
  exception when others then v_ok := true; raise notice 'vendedor no paga: %', sqlerrm; end;
  assert v_ok, 'vendedor no puede pagar';
  v_ok := false;
  begin perform public.comision_pedidos(v_admin, null, null, null);
  exception when others then v_ok := true; end;
  assert v_ok, 'vendedor no ve pedidos de otro';

  raise notice 'PRUEBA PAGOS OK';
end $$;
