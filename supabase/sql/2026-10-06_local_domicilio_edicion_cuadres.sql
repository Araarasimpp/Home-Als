-- Home ALS · 2026-10-06
--  1. Ventas en punto físico (pedidos.canal = 'local').
--  2. Domicilio: lo que se cobra al cliente (valor_domicilio) y lo que se le
--     paga al domiciliario (pago_domiciliario), configurable por barrio.
--  3. Editar pedidos (admin y despachador): datos, productos y cantidades.
--  4. Cuadres: el admin puede cerrar el cuadre de un domiciliario y cada noche
--     se cierran solos los que queden abiertos.
-- Sin begin/commit: el workflow "SQL en Supabase" lo envuelve en una transacción.

-- ───────────────────────── 1 y 2. Columnas ─────────────────────────

alter table public.zonas_domicilio
  add column if not exists pago_domiciliario numeric(12,2) not null default 10000
  constraint zonas_pago_domiciliario_check check (pago_domiciliario >= 0);

alter table public.configuracion
  add column if not exists pago_domiciliario numeric(12,2) not null default 10000
  constraint configuracion_pago_domiciliario_check check (pago_domiciliario >= 0);

alter table public.pedidos
  add column if not exists canal text not null default 'domicilio'
  constraint pedidos_canal_check check (canal in ('domicilio', 'local'));

alter table public.pedidos
  add column if not exists pago_domiciliario numeric(12,2) not null default 0
  constraint pedidos_pago_domiciliario_check check (pago_domiciliario >= 0);

alter table public.cuadres
  add column if not exists cerrado_por uuid references public.profiles(id);

-- Hasta hoy al domiciliario se le pagaba lo mismo que se le cobraba al cliente:
-- los pedidos que ya existen conservan ese valor (sin tocar comisiones ni registro).
alter table public.pedidos disable trigger trg_00_proteger_pedido_domiciliario;
alter table public.pedidos disable trigger trg_actividad_pedidos;
alter table public.pedidos disable trigger trg_pedido_recalcular_comision;
update public.pedidos set pago_domiciliario = valor_domicilio where canal = 'domicilio';
alter table public.pedidos enable trigger trg_00_proteger_pedido_domiciliario;
alter table public.pedidos enable trigger trg_actividad_pedidos;
alter table public.pedidos enable trigger trg_pedido_recalcular_comision;

-- Los cuadres que ya existen los cerró el propio domiciliario
update public.cuadres set cerrado_por = domiciliario_id where cerrado_por is null;

create index if not exists pedidos_canal_created_idx on public.pedidos (canal, created_at desc);
create index if not exists pedidos_sin_cuadre_idx on public.pedidos (domiciliario_id, entregado_at)
  where estado = 'entregado' and cuadre_id is null;
create index if not exists pedidos_cuadre_idx on public.pedidos (cuadre_id) where cuadre_id is not null;
create index if not exists pedido_items_pedido_idx on public.pedido_items (pedido_id);

-- Pago al domiciliario según el barrio (si el barrio no está en la lista, el de Configuración)
create or replace function public.pago_domiciliario_de(p_barrio text)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select z.pago_domiciliario from public.zonas_domicilio z
      where lower(trim(z.nombre)) = lower(trim(p_barrio)) limit 1),
    (select c.pago_domiciliario from public.configuracion c limit 1),
    10000);
$$;

-- ───────────────────────── crear_pedido (domicilio o local) ─────────────────────────

drop function if exists public.crear_pedido(text, text, text, text, numeric, text, jsonb);

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
  p_monto_efectivo numeric default null
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
    estado, entregado_at, metodo_pago, monto_efectivo
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
    case when v_local and p_metodo_pago = 'mixto' then p_monto_efectivo else null end
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

revoke all on function public.crear_pedido(text, text, text, text, numeric, text, jsonb, text, text, numeric) from public, anon;
grant execute on function public.crear_pedido(text, text, text, text, numeric, text, jsonb, text, text, numeric) to authenticated;

-- En ventas de local no se guarda "Punto físico" como dirección del cliente
create or replace function public.pedido_vincular_cliente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tel text := public.normalizar_telefono(new.cliente_telefono);
  v_local boolean := new.canal = 'local';
begin
  if v_tel is null or length(v_tel) < 7 then
    return new;
  end if;
  insert into public.clientes (telefono, nombre, direccion, barrio)
  values (v_tel, new.cliente_nombre,
          case when v_local then null else new.direccion end,
          case when v_local then null else new.barrio end)
  on conflict (telefono) do update
    set nombre = case when v_local and excluded.nombre = 'Cliente en local' then clientes.nombre else excluded.nombre end,
        direccion = coalesce(excluded.direccion, clientes.direccion),
        barrio = coalesce(excluded.barrio, clientes.barrio),
        updated_at = now()
  returning id into new.cliente_id;
  return new;
end;
$$;

-- Las ventas en local no avisan como "pedido nuevo" (ya están entregadas)
create or replace function public.pedido_avisos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_desc text := new.cliente_nombre || coalesce(', ' || new.barrio, '') || ', ' || public.pesos(new.total);
begin
  if tg_op = 'INSERT' then
    if new.canal = 'domicilio' then
      perform public.avisar_roles(array['admin', 'despachador'], 'pedido_nuevo',
        'Nuevo pedido #' || new.numero, v_desc, '/admin/pedidos', '/despachador/pedidos');
    end if;
    return null;
  end if;

  if new.domiciliario_id is not null and new.domiciliario_id is distinct from old.domiciliario_id
     and new.estado::text in ('pendiente', 'en_ruta') then
    perform public.avisar_usuario(new.domiciliario_id, 'pedido_asignado',
      'Te asignaron el pedido #' || new.numero, new.direccion || coalesce(', ' || new.barrio, ''), '/domiciliario');
  end if;

  if new.estado::text = 'entregado' and old.estado::text <> 'entregado' then
    perform public.avisar_usuario(new.vendedor_id, 'pedido_entregado',
      'Tu pedido #' || new.numero || ' fue entregado', v_desc, '/vendedor');
  end if;

  if new.estado::text = 'cancelado' and old.estado::text <> 'cancelado' then
    perform public.avisar_usuario(new.vendedor_id, 'pedido_cancelado',
      'Se canceló el pedido #' || new.numero, v_desc, '/vendedor');
    perform public.avisar_usuario(new.domiciliario_id, 'pedido_cancelado',
      'Se canceló el pedido #' || new.numero, 'Ya no tienes que entregarlo', '/domiciliario');
  end if;
  return null;
end;
$$;

-- ───────────────────────── 4. Cuadres ─────────────────────────

-- Núcleo sin permisos (solo lo llaman las funciones de abajo)
create or replace function public.cuadre_cerrar_interno(p_domiciliario uuid, p_fecha date, p_cerrado_por uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cuadre_id uuid;
  v_inicio timestamptz := (p_fecha::text || ' 00:00:00-05:00')::timestamptz;
  v_fin timestamptz := (p_fecha::text || ' 23:59:59.999-05:00')::timestamptz;
  v_domicilios numeric(12,2);
  v_efectivo numeric(12,2);
  v_transferencia numeric(12,2);
  v_general numeric(12,2);
  v_cantidad int;
begin
  -- Se bloquean los pedidos para que no entren dos cierres a la vez
  perform 1 from public.pedidos
   where domiciliario_id = p_domiciliario and estado = 'entregado' and cuadre_id is null
     and entregado_at between v_inicio and v_fin
   for update;

  -- Al domiciliario se le descuenta lo que se le PAGA por cada domicilio
  select coalesce(sum(pago_domiciliario), 0),
         coalesce(sum(coalesce(monto_efectivo, case when metodo_pago = 'efectivo' then total else 0 end)), 0),
         coalesce(sum(coalesce(monto_transferencia, case when metodo_pago = 'transferencia' then total else 0 end)), 0),
         coalesce(sum(total), 0),
         count(*)
    into v_domicilios, v_efectivo, v_transferencia, v_general, v_cantidad
    from public.pedidos
   where domiciliario_id = p_domiciliario and estado = 'entregado' and cuadre_id is null
     and entregado_at between v_inicio and v_fin;

  if v_cantidad = 0 then
    return null;
  end if;

  insert into public.cuadres (domiciliario_id, fecha, cantidad_pedidos, total_domicilios,
                              total_efectivo, total_transferencia, total_general, estado, cerrado_por)
  values (p_domiciliario, p_fecha, v_cantidad, v_domicilios,
          v_efectivo, v_transferencia, v_general, 'pendiente', p_cerrado_por)
  returning id into v_cuadre_id;

  perform set_config('homeals.origen', 'cuadre', true);
  update public.pedidos
     set cuadre_id = v_cuadre_id
   where domiciliario_id = p_domiciliario and estado = 'entregado' and cuadre_id is null
     and entregado_at between v_inicio and v_fin;
  perform set_config('homeals.origen', '', true);

  return v_cuadre_id;
end;
$$;

revoke all on function public.cuadre_cerrar_interno(uuid, date, uuid) from public, anon, authenticated;

drop function if exists public.cerrar_cuadre(date);

-- El domiciliario cierra el suyo; admin y despachador pueden cerrar el de cualquiera
create or replace function public.cerrar_cuadre(
  p_fecha date default ((now() at time zone 'America/Bogota'))::date,
  p_domiciliario uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rol text := public.current_role()::text;
  v_dom uuid := coalesce(p_domiciliario, auth.uid());
  v_id uuid;
begin
  if v_rol is null or v_rol not in ('domiciliario', 'admin', 'despachador') then
    raise exception 'No tienes permiso para cerrar un cuadre';
  end if;
  if v_dom is distinct from auth.uid() and v_rol not in ('admin', 'despachador') then
    raise exception 'Solo puedes cerrar tu propio cuadre';
  end if;

  v_id := public.cuadre_cerrar_interno(v_dom, p_fecha, auth.uid());
  if v_id is null then
    raise exception 'No hay pedidos entregados sin cuadrar en este día';
  end if;
  return v_id;
end;
$$;

revoke all on function public.cerrar_cuadre(date, uuid) from public, anon;
grant execute on function public.cerrar_cuadre(date, uuid) to authenticated;

-- Cierre automático de todo lo que quedó abierto (lo llama pg_cron cada noche)
create or replace function public.cerrar_cuadres_pendientes()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select distinct domiciliario_id, (entregado_at at time zone 'America/Bogota')::date as fecha
      from public.pedidos
     where estado = 'entregado' and cuadre_id is null and domiciliario_id is not null
  loop
    if public.cuadre_cerrar_interno(r.domiciliario_id, r.fecha, null) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.cerrar_cuadres_pendientes() from public, anon, authenticated;

-- Avisos de cuadre según quién lo cerró
create or replace function public.cuadre_avisos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_nombre text;
begin
  select nombre into v_nombre from public.profiles where id = new.domiciliario_id;
  if tg_op = 'INSERT' then
    if new.cerrado_por is not distinct from new.domiciliario_id then
      perform public.avisar_roles(array['admin', 'despachador'], 'cuadre_cerrado',
        coalesce(v_nombre, 'Un domiciliario') || ' cerró su cuadre',
        'Entrega ' || public.pesos(new.total_a_entregar),
        '/admin/cuadres?fecha=' || new.fecha, '/despachador/cuadres?fecha=' || new.fecha);
    else
      if new.cerrado_por is null then
        perform public.avisar_roles(array['admin', 'despachador'], 'cuadre_cerrado',
          'Cuadre de ' || coalesce(v_nombre, 'un domiciliario') || ' cerrado automáticamente',
          'Entrega ' || public.pesos(new.total_a_entregar),
          '/admin/cuadres?fecha=' || new.fecha, '/despachador/cuadres?fecha=' || new.fecha);
      end if;
      perform public.avisar_usuario(new.domiciliario_id, 'cuadre_cerrado',
        'Se cerró tu cuadre del ' || to_char(new.fecha::date, 'DD/MM'),
        'Entregas ' || public.pesos(new.total_a_entregar), '/domiciliario/cuadres');
    end if;
  elsif new.estado::text = 'confirmado' and old.estado::text <> 'confirmado' then
    perform public.avisar_usuario(new.domiciliario_id, 'cuadre_confirmado',
      'Tu cuadre del ' || to_char(new.fecha::date, 'DD/MM') || ' fue confirmado',
      public.pesos(new.total_a_entregar), '/domiciliario/cuadres');
  end if;
  return null;
end;
$$;

-- Recalcula los totales de un cuadre pendiente (cuando se edita uno de sus pedidos)
create or replace function public.recalcular_cuadre(p_cuadre uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.cuadres c
     set cantidad_pedidos = s.cantidad,
         total_domicilios = s.domicilios,
         total_efectivo = s.efectivo,
         total_transferencia = s.transferencia,
         total_general = s.general
    from (select count(*) as cantidad,
                 coalesce(sum(pago_domiciliario), 0) as domicilios,
                 coalesce(sum(coalesce(monto_efectivo, case when metodo_pago = 'efectivo' then total else 0 end)), 0) as efectivo,
                 coalesce(sum(coalesce(monto_transferencia, case when metodo_pago = 'transferencia' then total else 0 end)), 0) as transferencia,
                 coalesce(sum(total), 0) as general
            from public.pedidos where cuadre_id = p_cuadre) s
   where c.id = p_cuadre and c.estado = 'pendiente';
end;
$$;

revoke all on function public.recalcular_cuadre(uuid) from public, anon, authenticated;

-- ───────────────────────── 3. Editar pedido ─────────────────────────
-- p_datos: cualquiera de cliente_nombre, cliente_telefono, direccion, barrio,
--          valor_domicilio, pago_domiciliario, observaciones, metodo_pago, monto_efectivo
-- p_items: null = no cambia productos; si viene, reemplaza la lista completa
--          [{producto_id, cantidad, precio_unitario}]
create or replace function public.editar_pedido(p_pedido_id uuid, p_datos jsonb, p_items jsonb default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_p public.pedidos%rowtype;
  v_cuadre_estado text;
  v_bases jsonb;
  v_subtotal numeric(12,2);
  v_comision numeric(12,2);
  v_dom numeric(12,2);
  v_pago numeric(12,2);
  v_metodo text;
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
                          else monto_efectivo end
  where id = p_pedido_id;

  if v_p.cuadre_id is not null then
    perform public.recalcular_cuadre(v_p.cuadre_id);
  end if;
end;
$$;

revoke all on function public.editar_pedido(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.editar_pedido(uuid, jsonb, jsonb) to authenticated;

-- ───────────────────────── Ganancia de la tienda ─────────────────────────
-- Ahora descuenta lo que la tienda pone de su bolsillo en cada domicilio
-- (pago al domiciliario − domicilio cobrado al cliente).
create or replace function public.ganancia_tienda(p_desde timestamptz, p_hasta timestamptz)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select
    coalesce((
      select sum(pi.cantidad * (pi.precio_unitario - coalesce(pr.costo, pi.precio_base)))
      from public.pedido_items pi
      join public.pedidos p on p.id = pi.pedido_id
      join public.productos pr on pr.id = pi.producto_id
      where p.estado in ('en_ruta', 'entregado')
        and p.created_at >= p_desde and p.created_at <= p_hasta
    ), 0)
    -
    coalesce((
      select sum(p.comision + (p.pago_domiciliario - p.valor_domicilio))
      from public.pedidos p
      where p.estado in ('en_ruta', 'entregado')
        and p.created_at >= p_desde and p.created_at <= p_hasta
    ), 0);
$$;

-- ───────────────────────── Cierre automático cada noche ─────────────────────────
-- 23:50 hora Colombia (04:50 UTC). Para quitarlo:
--   select cron.unschedule('cerrar-cuadres-noche');
select cron.unschedule(jobid) from cron.job where jobname = 'cerrar-cuadres-noche';
select cron.schedule('cerrar-cuadres-noche', '50 4 * * *', 'select public.cerrar_cuadres_pendientes()');

-- ───────────────────────── Prueba rápida (solo lectura) ─────────────────────────
select 'ok' as migracion,
       (select count(*) from public.pedidos) as pedidos,
       (select count(*) from public.zonas_domicilio) as zonas,
       public.pago_domiciliario_de('barrio que no existe') as pago_por_defecto;
