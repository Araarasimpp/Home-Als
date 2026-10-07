-- Home ALS · 2026-10-07
--  1. Ventas en local: si el cliente paga por transferencia o mixto, el
--     comprobante es obligatorio (igual que en las entregas a domicilio).
--  2. El vendedor puede subir comprobantes y ver los de sus propias ventas.
--  3. Entregas a domicilio: la base de datos también exige el comprobante
--     cuando el domiciliario registra transferencia o pago mixto.
--  4. Editar pedido: si se cambia el pago a transferencia o mixto, se pide
--     comprobante; también se puede reemplazar el que tenía.
-- Sin begin/commit: el workflow "SQL en Supabase" lo envuelve en una transacción.

-- ───────────────────────── Comprobante válido ─────────────────────────

-- El comprobante debe ser un archivo que ya esté en el bucket privado
create or replace function public.comprobante_existe(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(trim(p_ruta), '') <> ''
     and exists (select 1 from storage.objects o
                  where o.bucket_id = 'comprobantes' and o.name = trim(p_ruta));
$$;

revoke all on function public.comprobante_existe(text) from public, anon;
grant execute on function public.comprobante_existe(text) to authenticated;

-- ───────────────────────── 1. crear_pedido con comprobante ─────────────────────────

drop function if exists public.crear_pedido(text, text, text, text, numeric, text, jsonb, text, text, numeric);

create or replace function public.crear_pedido(
  p_cliente_nombre text,
  p_cliente_telefono text,
  p_direccion text,
  p_barrio text,
  p_valor_domicilio numeric,
  p_observaciones text,
  p_items jsonb,
  p_canal text default 'domicilio',
  p_metodo_pago text default null,
  p_monto_efectivo numeric default null,
  p_comprobante_url text default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_canal text := coalesce(nullif(trim(p_canal), ''), 'domicilio');
  v_local boolean;
  v_pedido_id uuid;
  v_numero bigint;
  v_subtotal numeric(12,2);
  v_comision numeric(12,2);
  v_domicilio numeric(12,2);
begin
  if public.current_role() not in ('vendedor', 'admin', 'despachador') then
    raise exception 'No tienes permiso para crear pedidos';
  end if;
  if v_canal not in ('domicilio', 'local') then
    raise exception 'Canal de venta no válido';
  end if;
  v_local := v_canal = 'local';

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe tener al menos un producto';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i
              where coalesce((i->>'cantidad')::int, 0) <= 0
                 or coalesce((i->>'precio_unitario')::numeric, 0) <= 0) then
    raise exception 'Revisa cantidades y precios: ninguno puede quedar en 0';
  end if;

  if v_local then
    if p_metodo_pago is null or p_metodo_pago not in ('efectivo', 'transferencia', 'mixto') then
      raise exception 'Indica cómo pagó el cliente';
    end if;
    if p_metodo_pago in ('transferencia', 'mixto') and not public.comprobante_existe(p_comprobante_url) then
      raise exception 'Sube la foto del comprobante de la transferencia';
    end if;
    v_domicilio := 0;
  else
    if coalesce(trim(p_cliente_nombre), '') = '' or coalesce(trim(p_direccion), '') = '' then
      raise exception 'Falta el nombre del cliente o la dirección';
    end if;
    v_domicilio := greatest(coalesce(p_valor_domicilio, 0), 0);
  end if;

  -- El precio base sale del producto (no del navegador)
  select sum(x.cantidad * x.precio_unitario),
         sum(x.cantidad * (x.precio_unitario - pr.precio_base))
    into v_subtotal, v_comision
    from (select (i->>'producto_id')::uuid as producto_id,
                 (i->>'cantidad')::int as cantidad,
                 (i->>'precio_unitario')::numeric as precio_unitario
            from jsonb_array_elements(p_items) i) x
    join public.productos pr on pr.id = x.producto_id;

  if v_subtotal is null then
    raise exception 'Alguno de los productos ya no existe';
  end if;

  insert into public.pedidos (
    vendedor_id, canal, cliente_nombre, cliente_telefono, direccion, barrio,
    valor_domicilio, pago_domiciliario, comision, observaciones, total,
    estado, entregado_at, metodo_pago, monto_efectivo, comprobante_url
  )
  values (
    auth.uid(), v_canal,
    case when v_local then coalesce(nullif(trim(p_cliente_nombre), ''), 'Cliente en local') else trim(p_cliente_nombre) end,
    nullif(trim(p_cliente_telefono), ''),
    case when v_local then 'Punto físico' else trim(p_direccion) end,
    case when v_local then null else nullif(trim(p_barrio), '') end,
    v_domicilio,
    case when v_local then 0 else public.pago_domiciliario_de(p_barrio) end,
    coalesce(v_comision, 0),
    nullif(trim(p_observaciones), ''),
    v_subtotal + v_domicilio,
    case when v_local then 'entregado'::public.estado_pedido else 'pendiente'::public.estado_pedido end,
    case when v_local then now() else null end,
    case when v_local then p_metodo_pago else null end,
    case when v_local and p_metodo_pago = 'mixto' then p_monto_efectivo else null end,
    case when v_local and p_metodo_pago in ('transferencia', 'mixto') then trim(p_comprobante_url) else null end
  )
  returning id, numero into v_pedido_id, v_numero;

  -- El trigger on_pedido_item_created descuenta el stock (y valida que alcance)
  insert into public.pedido_items (pedido_id, producto_id, cantidad, precio_unitario, precio_base)
  select v_pedido_id, pr.id, (i->>'cantidad')::int, (i->>'precio_unitario')::numeric, pr.precio_base
    from jsonb_array_elements(p_items) i
    join public.productos pr on pr.id = (i->>'producto_id')::uuid;

  return v_numero;
end;
$$;

revoke all on function public.crear_pedido(text, text, text, text, numeric, text, jsonb, text, text, numeric, text) from public, anon;
grant execute on function public.crear_pedido(text, text, text, text, numeric, text, jsonb, text, text, numeric, text) to authenticated;

-- ───────────────────────── 2. Storage: el vendedor sube comprobantes ─────────────────────────

drop policy if exists "comprobantes: insert vendedor" on storage.objects;
create policy "comprobantes: insert vendedor" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprobantes' and public.current_role() = 'vendedor');

-- Solo ve los comprobantes de sus propias ventas
drop policy if exists "comprobantes: select vendedor" on storage.objects;
create policy "comprobantes: select vendedor" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprobantes'
    and public.current_role() = 'vendedor'
    and exists (select 1 from public.pedidos p
                 where p.comprobante_url = storage.objects.name
                   and p.vendedor_id = (select auth.uid()))
  );

-- ───────────────────────── 3. Entregas a domicilio ─────────────────────────

create or replace function public.proteger_pedido_domiciliario()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_rol text;
  -- Lo único que el domiciliario puede tocar al entregar
  v_permitidas text[] := array['estado', 'entregado_at', 'metodo_pago', 'monto_efectivo',
                               'monto_transferencia', 'comprobante_url'];
begin
  -- SQL Editor, tareas internas o funciones sin usuario: sin restricción
  if v_uid is null then
    return new;
  end if;

  select p.role::text into v_rol from public.profiles p where p.id = v_uid;

  -- Esta regla es solo para domiciliarios (admin y despachador editan todo;
  -- el vendedor no tiene permiso de actualizar pedidos por RLS)
  if v_rol is distinct from 'domiciliario' then
    return new;
  end if;

  -- cerrar_cuadre marca su origen para poder anotar el cuadre en los pedidos
  if coalesce(current_setting('homeals.origen', true), '') = 'cuadre' then
    if (to_jsonb(new) - 'cuadre_id') is distinct from (to_jsonb(old) - 'cuadre_id')
       or old.cuadre_id is not null then
      raise exception 'Cambio no permitido al cerrar el cuadre';
    end if;
    return new;
  end if;

  -- Ninguna otra columna puede cambiar (total, domicilio, comisión, cliente,
  -- dirección, domiciliario asignado, cuadre, etc.)
  if (to_jsonb(new) - v_permitidas) is distinct from (to_jsonb(old) - v_permitidas) then
    raise exception 'Como domiciliario solo puedes registrar la entrega del pedido';
  end if;

  -- La única transición permitida es en_ruta → entregado, una sola vez
  if not (old.estado::text = 'en_ruta' and new.estado::text = 'entregado') then
    raise exception 'Solo puedes marcar como entregado un pedido que está en ruta';
  end if;

  if new.metodo_pago is null then
    raise exception 'Indica cómo te pagaron el pedido';
  end if;

  -- Transferencia o mixto: el comprobante es obligatorio
  if new.metodo_pago::text in ('transferencia', 'mixto')
     and not public.comprobante_existe(new.comprobante_url) then
    raise exception 'Sube la foto del comprobante de la transferencia';
  end if;

  -- La hora de entrega la pone el servidor (no se puede adelantar ni atrasar
  -- para que el pedido caiga en otro cuadre)
  new.entregado_at := now();
  return new;
end;
$function$;

-- ───────────────────────── 4. editar_pedido con comprobante ─────────────────────────

create or replace function public.editar_pedido(p_pedido_id uuid, p_datos jsonb, p_items jsonb default null::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_p public.pedidos%rowtype;
  v_cuadre_estado text;
  v_bases jsonb;
  v_subtotal numeric(12,2);
  v_comision numeric(12,2);
  v_dom numeric(12,2);
  v_pago numeric(12,2);
  v_metodo text;
  v_comprobante text;
  d jsonb := coalesce(p_datos, '{}'::jsonb);
begin
  if public.current_role() not in ('admin', 'despachador') then
    raise exception 'No tienes permiso para editar pedidos';
  end if;

  select * into v_p from public.pedidos where id = p_pedido_id for update;
  if not found then raise exception 'El pedido no existe'; end if;
  if v_p.estado = 'cancelado' then raise exception 'No se puede editar un pedido cancelado'; end if;

  if v_p.cuadre_id is not null then
    select estado into v_cuadre_estado from public.cuadres where id = v_p.cuadre_id;
    if v_cuadre_estado = 'confirmado' then
      raise exception 'Este pedido está en un cuadre ya confirmado; no se puede editar';
    end if;
  end if;

  -- Productos
  if p_items is not null then
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
      raise exception 'El pedido debe tener al menos un producto (si no lleva nada, cancélalo)';
    end if;
    if exists (select 1 from jsonb_array_elements(p_items) i
                where coalesce((i->>'cantidad')::int, 0) <= 0
                   or coalesce((i->>'precio_unitario')::numeric, 0) <= 0) then
      raise exception 'Revisa cantidades y precios: ninguno puede quedar en 0';
    end if;

    -- Se conserva el precio base con el que se vendió cada producto
    select jsonb_object_agg(producto_id::text, precio_base) into v_bases
      from public.pedido_items where pedido_id = p_pedido_id;

    perform set_config('homeals.origen', 'pedido', true);
    update public.productos prod
       set stock = prod.stock + pi.cantidad
      from (select producto_id, sum(cantidad) as cantidad
              from public.pedido_items where pedido_id = p_pedido_id group by producto_id) pi
     where pi.producto_id = prod.id;
    delete from public.pedido_items where pedido_id = p_pedido_id;

    insert into public.pedido_items (pedido_id, producto_id, cantidad, precio_unitario, precio_base)
    select p_pedido_id, pr.id, (i->>'cantidad')::int, (i->>'precio_unitario')::numeric,
           coalesce((v_bases->>pr.id::text)::numeric, pr.precio_base)
      from jsonb_array_elements(p_items) i
      join public.productos pr on pr.id = (i->>'producto_id')::uuid;
    perform set_config('homeals.origen', '', true);

    if (select count(*) from public.pedido_items where pedido_id = p_pedido_id) <> jsonb_array_length(p_items) then
      raise exception 'Alguno de los productos ya no existe';
    end if;
  end if;

  select coalesce(sum(cantidad * precio_unitario), 0), coalesce(sum(cantidad * (precio_unitario - precio_base)), 0)
    into v_subtotal, v_comision
    from public.pedido_items where pedido_id = p_pedido_id;

  if v_p.canal = 'local' then
    v_dom := 0;
    v_pago := 0;
  else
    v_dom := case when d ? 'valor_domicilio' then greatest(coalesce((d->>'valor_domicilio')::numeric, 0), 0) else v_p.valor_domicilio end;
    v_pago := case when d ? 'pago_domiciliario' then greatest(coalesce((d->>'pago_domiciliario')::numeric, 0), 0) else v_p.pago_domiciliario end;
  end if;

  v_metodo := case when d ? 'metodo_pago' then nullif(d->>'metodo_pago', '') else v_p.metodo_pago end;
  if v_metodo is not null and v_metodo not in ('efectivo', 'transferencia', 'mixto') then
    raise exception 'Método de pago no válido';
  end if;
  if v_metodo is null and v_p.estado = 'entregado' then
    raise exception 'Un pedido entregado debe tener método de pago';
  end if;

  -- Comprobante: se puede reemplazar; si el pago pasa a transferencia o mixto, es obligatorio
  v_comprobante := v_p.comprobante_url;
  if nullif(trim(d->>'comprobante_url'), '') is not null then
    if not public.comprobante_existe(d->>'comprobante_url') then
      raise exception 'No se encontró el comprobante subido; intenta de nuevo';
    end if;
    v_comprobante := trim(d->>'comprobante_url');
  end if;
  if v_metodo in ('transferencia', 'mixto')
     and v_metodo is distinct from v_p.metodo_pago
     and v_comprobante is null then
    raise exception 'Sube la foto del comprobante de la transferencia';
  end if;

  update public.pedidos set
    cliente_nombre = case when d ? 'cliente_nombre' then coalesce(nullif(trim(d->>'cliente_nombre'), ''), cliente_nombre) else cliente_nombre end,
    cliente_telefono = case when d ? 'cliente_telefono' then nullif(trim(d->>'cliente_telefono'), '') else cliente_telefono end,
    direccion = case when d ? 'direccion' and canal = 'domicilio' then coalesce(nullif(trim(d->>'direccion'), ''), direccion) else direccion end,
    barrio = case when d ? 'barrio' and canal = 'domicilio' then nullif(trim(d->>'barrio'), '') else barrio end,
    observaciones = case when d ? 'observaciones' then nullif(trim(d->>'observaciones'), '') else observaciones end,
    valor_domicilio = v_dom,
    pago_domiciliario = v_pago,
    total = v_subtotal + v_dom,
    comision = case when comision_tipo = 'porcentaje' then comision else v_comision end,
    metodo_pago = v_metodo,
    monto_efectivo = case when v_metodo = 'mixto'
                          then coalesce((d->>'monto_efectivo')::numeric, monto_efectivo)
                          else monto_efectivo end,
    comprobante_url = v_comprobante
  where id = p_pedido_id;

  if v_p.cuadre_id is not null then
    perform public.recalcular_cuadre(v_p.cuadre_id);
  end if;
end;
$function$;

create index if not exists pedidos_comprobante_idx on public.pedidos (comprobante_url) where comprobante_url is not null;
