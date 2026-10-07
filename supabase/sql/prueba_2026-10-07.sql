-- Prueba funcional (se corre SOLO en modo "probar": todo se deshace al final).
\i supabase/sql/2026-10-07_comprobantes_local.sql

do $$
declare
  v_admin uuid; v_dom uuid; v_prod record; v_num bigint; v_ped public.pedidos%rowtype; v_ok boolean;
begin
  select id into v_admin from public.profiles where role = 'admin' and activo limit 1;
  select id, stock into v_prod from public.productos where activo and stock >= 5 order by stock desc limit 1;
  raise notice 'admin % producto stock %', v_admin is not null, v_prod.stock;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- 1. Local por transferencia SIN comprobante: debe fallar
  v_ok := false;
  begin
    perform public.crear_pedido(null, null, null, null, null, null,
      jsonb_build_array(jsonb_build_object('producto_id', v_prod.id, 'cantidad', 1, 'precio_unitario', 50000)),
      'local', 'transferencia', null, null);
  exception when others then
    v_ok := sqlerrm like '%comprobante%';
    raise notice 'sin comprobante -> %', sqlerrm;
  end;
  assert v_ok, 'local transferencia sin comprobante debe fallar';

  -- 2. Comprobante que no existe en el bucket: debe fallar
  v_ok := false;
  begin
    perform public.crear_pedido(null, null, null, null, null, null,
      jsonb_build_array(jsonb_build_object('producto_id', v_prod.id, 'cantidad', 1, 'precio_unitario', 50000)),
      'local', 'mixto', 20000, 'no-existe.jpg');
  exception when others then
    v_ok := sqlerrm like '%comprobante%';
  end;
  assert v_ok, 'comprobante inexistente debe fallar';

  -- 3. Mixto con comprobante: queda guardado
  insert into storage.objects (bucket_id, name) values ('comprobantes', 'prueba-local-123.jpg');
  v_num := public.crear_pedido(null, null, null, null, null, null,
    jsonb_build_array(jsonb_build_object('producto_id', v_prod.id, 'cantidad', 2, 'precio_unitario', 50000)),
    'local', 'mixto', 30000, 'prueba-local-123.jpg');
  select * into v_ped from public.pedidos where numero = v_num;
  raise notice 'LOCAL #% metodo=% efectivo=% transf=% comprobante=% vendedor=% hora=%',
    v_num, v_ped.metodo_pago, v_ped.monto_efectivo, v_ped.monto_transferencia, v_ped.comprobante_url,
    v_ped.vendedor_id = v_admin, v_ped.created_at is not null;
  assert v_ped.comprobante_url = 'prueba-local-123.jpg' and v_ped.monto_transferencia = 70000, 'local mixto';

  -- 4. Efectivo sin comprobante sigue funcionando
  v_num := public.crear_pedido(null, null, null, null, null, null,
    jsonb_build_array(jsonb_build_object('producto_id', v_prod.id, 'cantidad', 1, 'precio_unitario', 50000)),
    'local', 'efectivo', null, null);
  select * into v_ped from public.pedidos where numero = v_num;
  assert v_ped.comprobante_url is null and v_ped.monto_efectivo = 50000, 'local efectivo';

  -- 5. Editar: pasar de efectivo a transferencia sin comprobante falla; con comprobante pasa
  v_ok := false;
  begin
    perform public.editar_pedido(v_ped.id, '{"metodo_pago":"transferencia"}', null);
  exception when others then
    v_ok := sqlerrm like '%comprobante%';
  end;
  assert v_ok, 'editar a transferencia sin comprobante debe fallar';
  perform public.editar_pedido(v_ped.id, '{"metodo_pago":"transferencia","comprobante_url":"prueba-local-123.jpg"}', null);
  select * into v_ped from public.pedidos where id = v_ped.id;
  assert v_ped.metodo_pago = 'transferencia' and v_ped.comprobante_url = 'prueba-local-123.jpg'
     and v_ped.monto_transferencia = 50000, 'editar con comprobante';

  -- 6. Pedido a domicilio sigue igual
  v_num := public.crear_pedido('Prueba', null, 'Calle 1', 'Barrio de prueba xyz', 9000, null,
    jsonb_build_array(jsonb_build_object('producto_id', v_prod.id, 'cantidad', 1, 'precio_unitario', 50000)));
  select * into v_ped from public.pedidos where numero = v_num;
  assert v_ped.estado = 'pendiente' and v_ped.comprobante_url is null, 'domicilio';

  -- 7. El domiciliario entrega en mixto: sin comprobante falla, con comprobante pasa
  select id into v_dom from public.profiles where role = 'domiciliario' limit 1;
  if v_dom is not null then
    update public.pedidos set domiciliario_id = v_dom, estado = 'en_ruta' where id = v_ped.id;
    perform set_config('request.jwt.claims', json_build_object('sub', v_dom, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_dom::text, true);
    v_ok := false;
    begin
      update public.pedidos set estado = 'entregado', metodo_pago = 'mixto', monto_efectivo = 20000 where id = v_ped.id;
    exception when others then
      v_ok := sqlerrm like '%comprobante%';
    end;
    assert v_ok, 'entrega mixta sin comprobante debe fallar';
    update public.pedidos set estado = 'entregado', metodo_pago = 'mixto', monto_efectivo = 20000,
           comprobante_url = 'prueba-local-123.jpg' where id = v_ped.id;
    select * into v_ped from public.pedidos where id = v_ped.id;
    raise notice 'DOMICILIO mixto efectivo=% transf=%', v_ped.monto_efectivo, v_ped.monto_transferencia;
    assert v_ped.estado = 'entregado' and v_ped.monto_transferencia = v_ped.total - 20000, 'entrega mixta';
  end if;

  raise notice 'PRUEBA OK';
end $$;
