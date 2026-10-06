-- Prueba funcional (se corre SOLO en modo "probar": todo se deshace al final).
\i supabase/sql/2026-10-06_local_domicilio_edicion_cuadres.sql

do $$
declare
  v_admin uuid; v_dom uuid; v_prod record; v_num bigint; v_ped public.pedidos%rowtype;
  v_stock0 int; v_stock1 int; v_cuadre uuid; v_c public.cuadres%rowtype;
begin
  select id into v_admin from public.profiles where role = 'admin' and activo limit 1;
  select id into v_dom from public.profiles where role = 'domiciliario' limit 1;
  select id, stock, precio_base, precio_sugerido into v_prod from public.productos where activo and stock >= 5 order by stock desc limit 1;
  raise notice 'admin % dom % producto stock %', v_admin is not null, v_dom is not null, v_prod.stock;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- 1. Venta en local
  v_stock0 := v_prod.stock;
  v_num := public.crear_pedido(null, null, null, null, null, null,
    jsonb_build_array(jsonb_build_object('producto_id', v_prod.id, 'cantidad', 2, 'precio_unitario', 50000)),
    'local', 'mixto', 30000);
  select * into v_ped from public.pedidos where numero = v_num;
  select stock into v_stock1 from public.productos where id = v_prod.id;
  raise notice 'LOCAL #% canal=% estado=% total=% efectivo=% transf=% dom=% pago=% dir=% stock % -> %',
    v_num, v_ped.canal, v_ped.estado, v_ped.total, v_ped.monto_efectivo, v_ped.monto_transferencia,
    v_ped.valor_domicilio, v_ped.pago_domiciliario, v_ped.direccion, v_stock0, v_stock1;
  assert v_ped.canal = 'local' and v_ped.estado = 'entregado' and v_ped.total = 100000
     and v_ped.monto_transferencia = 70000 and v_stock1 = v_stock0 - 2, 'venta local';

  -- 2. Pedido a domicilio con barrio desconocido -> pago por defecto
  v_num := public.crear_pedido('Prueba', null, 'Calle 1', 'Barrio de prueba xyz', 9000, null,
    jsonb_build_array(jsonb_build_object('producto_id', v_prod.id, 'cantidad', 2, 'precio_unitario', 50000)));
  select * into v_ped from public.pedidos where numero = v_num;
  raise notice 'DOMICILIO #% total=% dom=% pago=% comision=%', v_num, v_ped.total, v_ped.valor_domicilio, v_ped.pago_domiciliario, v_ped.comision;
  assert v_ped.total = 109000 and v_ped.pago_domiciliario = 10000, 'domicilio';

  -- 3. Editar: el cliente solo se queda con 1
  select stock into v_stock0 from public.productos where id = v_prod.id;
  perform public.editar_pedido(v_ped.id, '{"observaciones":"Se quedó con uno"}',
    jsonb_build_array(jsonb_build_object('producto_id', v_prod.id, 'cantidad', 1, 'precio_unitario', 50000)));
  select * into v_ped from public.pedidos where id = v_ped.id;
  select stock into v_stock1 from public.productos where id = v_prod.id;
  raise notice 'EDITADO total=% obs=% stock % -> % comision=%', v_ped.total, v_ped.observaciones, v_stock0, v_stock1, v_ped.comision;
  assert v_ped.total = 59000 and v_stock1 = v_stock0 + 1, 'editar';

  -- 4. Entregar y cerrar cuadre en nombre del domiciliario
  if v_dom is not null then
    update public.pedidos set domiciliario_id = v_dom, estado = 'en_ruta' where id = v_ped.id;
    update public.pedidos set estado = 'entregado', entregado_at = now(), metodo_pago = 'efectivo' where id = v_ped.id;
    v_cuadre := public.cerrar_cuadre(((now() at time zone 'America/Bogota'))::date, v_dom);
    select * into v_c from public.cuadres where id = v_cuadre;
    raise notice 'CUADRE pedidos=% efectivo=% domicilios=% a_entregar=%', v_c.cantidad_pedidos, v_c.total_efectivo, v_c.total_domicilios, v_c.total_a_entregar;
    -- editar despues de cerrado (pendiente) recalcula
    perform public.editar_pedido(v_ped.id, '{"pago_domiciliario": 12000}', null);
    select * into v_c from public.cuadres where id = v_cuadre;
    raise notice 'CUADRE tras editar domicilios=% a_entregar=%', v_c.total_domicilios, v_c.total_a_entregar;
  end if;

  raise notice 'ganancia hoy %', public.ganancia_tienda(now() - interval '1 hour', now() + interval '1 hour');
  raise notice 'cierre automatico: % cuadres', public.cerrar_cuadres_pendientes();
end $$;
