-- Home ALS · 2026-11-22 · Pagos de comisiones y Recolector (como en jasta)
--
-- 1. PAGOS: el admin ve lo que se le debe a cada vendedor (pedidos CREADOS en la
--    semana —sábado a viernes— que ya se entregaron y no se han pagado), registra
--    el pago con su comprobante y queda el historial. El vendedor ve lo suyo.
--    La comisión de cada pedido es la misma de Reportes: pedidos.comision menos su
--    mitad del envío que se pone (solo vendedores por %).
--
-- 2. RECOLECTOR: rol nuevo. Recibe bases de dinero (el admin se las envía y él
--    las acepta, o las agrega él mismo diciendo de dónde vienen) y registra cada
--    compra con proveedor, producto y foto de la factura. Cada día cuadra solo:
--    base − compras − lo que ya le entregó al admin = falta por entregar.
--    Si compra un producto del catálogo, el costo del producto queda con lo que pagó.
--
-- El valor 'recolector' del enum se agrega aquí y NO se usa como user_role en este
-- mismo archivo (Postgres no deja usar un valor de enum nuevo antes del commit):
-- todo se compara como texto.
-- Sin begin/commit: el workflow "SQL en Supabase" lo envuelve en una transacción.

-- ═════════════════════════ Rol recolector ═════════════════════════

alter type public.user_role add value if not exists 'recolector';

create or replace function public.sincronizar_roles()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_orden text[] := array['admin', 'despachador', 'vendedor', 'domiciliario', 'recolector'];
begin
  -- Sin repetidos y en orden de importancia
  select coalesce(array_agg(r order by array_position(v_orden, r::text)), array['vendedor']::public.user_role[])
    into new.roles
    from (select distinct unnest(new.roles) as r) x;

  if tg_op = 'UPDATE' and new.roles is not distinct from old.roles and not (new.role = any (new.roles)) then
    new.roles := array[new.role];
  elsif not (new.role = any (new.roles)) then
    new.role := new.roles[1];
  end if;
  return new;
end;
$$;

create or replace function public.mi_nombre()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select nombre from public.profiles where id = auth.uid();
$$;
revoke all on function public.mi_nombre() from public, anon;
grant execute on function public.mi_nombre() to authenticated;

-- ═════════════════════════ 1. PAGOS DE COMISIONES ═════════════════════════

-- Desde qué día se cuentan las comisiones (lo de antes se toma como ya pagado)
alter table public.configuracion
  add column if not exists comisiones_desde date not null default date '2026-11-14';

create table if not exists public.pagos_comision (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  vendedor_id uuid not null references public.profiles(id),
  desde date not null,
  hasta date not null,
  cantidad_pedidos int not null check (cantidad_pedidos > 0),
  total numeric(12, 2) not null,
  metodo text not null check (metodo in ('efectivo', 'transferencia', 'otro')),
  comprobantes text[] not null default '{}',
  nota text check (nota is null or length(nota) <= 200),
  pedido_ids uuid[] not null default '{}',
  pagado_por uuid references public.profiles(id),
  pagado_por_nombre text,
  pagado_at timestamptz not null default now(),
  anulado boolean not null default false,
  anulado_at timestamptz,
  anulado_por uuid references public.profiles(id),
  check (hasta >= desde)
);
create index if not exists pagos_comision_vendedor_idx on public.pagos_comision (vendedor_id, pagado_at desc);
create index if not exists pagos_comision_fecha_idx on public.pagos_comision (pagado_at desc);

-- Un pedido se paga una sola vez (al anular el pago, vuelve a quedar por pagar)
create table if not exists public.pago_comision_pedidos (
  pedido_id uuid primary key references public.pedidos(id) on delete cascade,
  pago_id uuid not null references public.pagos_comision(id) on delete cascade
);
create index if not exists pago_comision_pedidos_pago_idx on public.pago_comision_pedidos (pago_id);

alter table public.pagos_comision enable row level security;
alter table public.pago_comision_pedidos enable row level security;

drop policy if exists "pagos_comision: admin o el vendedor leen" on public.pagos_comision;
create policy "pagos_comision: admin o el vendedor leen" on public.pagos_comision
  for select to authenticated
  using ((select public.tiene_rol(array['admin'])) or vendedor_id = (select auth.uid()));
-- Sin políticas de escritura: todo pasa por las funciones de abajo.
grant select on public.pagos_comision to authenticated;
revoke insert, update, delete on public.pagos_comision from authenticated, anon;
revoke all on public.pago_comision_pedidos from authenticated, anon;

-- Comisión de un pedido (misma regla de Reportes y de envio.ts)
create or replace function public.comision_neta(p_comision numeric, p_canal text, p_tipo text, p_valor_domicilio numeric, p_pago_domiciliario numeric)
returns numeric
language sql
immutable
set search_path to ''
as $$
  select coalesce(p_comision, 0)
       - case when p_canal = 'local' or p_tipo is distinct from 'porcentaje' then 0
              else round(greatest(0, coalesce(p_pago_domiciliario, p_valor_domicilio, 0) - coalesce(p_valor_domicilio, 0)) / 2)
         end;
$$;

-- Pedidos de un vendedor que deben comisión: entregados, sin pagar y desde el día configurado
create or replace function public.comisiones_pendientes(p_vendedor uuid)
returns table (id uuid, numero bigint, dia date, cliente_nombre text, total numeric, comision numeric)
language sql
stable
security definer
set search_path to ''
as $$
  select p.id, p.numero, (p.created_at at time zone 'America/Bogota')::date, p.cliente_nombre, p.total,
         public.comision_neta(p.comision, p.canal, p.comision_tipo, p.valor_domicilio, p.pago_domiciliario)
  from public.pedidos p
  where p.vendedor_id = p_vendedor
    and p.estado = 'entregado'
    and (p.created_at at time zone 'America/Bogota')::date >= (select comisiones_desde from public.configuracion limit 1)
    and not exists (select 1 from public.pago_comision_pedidos x where x.pedido_id = p.id)
    and public.comision_neta(p.comision, p.canal, p.comision_tipo, p.valor_domicilio, p.pago_domiciliario) <> 0;
$$;
revoke all on function public.comisiones_pendientes(uuid) from public, anon, authenticated;

-- Lo que se le debe a cada vendedor en un periodo (y lo que quedó sin pagar de antes)
create or replace function public.comisiones_periodo(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_admin boolean := public.tiene_rol(array['admin']);
begin
  if auth.uid() is null then raise exception 'No hay sesión'; end if;
  if p_hasta < p_desde then raise exception 'Revisa las fechas'; end if;
  return coalesce((
    select jsonb_agg(x order by x.total desc, x.nombre)
    from (
      select u.id as vendedor_id, u.nombre, u.avatar_url,
             count(*) filter (where c.dia between p_desde and p_hasta) as pedidos,
             coalesce(sum(c.comision) filter (where c.dia between p_desde and p_hasta), 0) as total,
             coalesce(sum(c.comision) filter (where c.dia < p_desde), 0) as anteriores,
             min(c.dia) filter (where c.dia between p_desde and p_hasta) as desde,
             max(c.dia) filter (where c.dia between p_desde and p_hasta) as hasta
      from public.profiles u
      cross join lateral public.comisiones_pendientes(u.id) c
      where (v_admin and 'vendedor' = any (u.roles::text[])) or u.id = auth.uid()
      group by u.id, u.nombre, u.avatar_url
    ) x
    where x.total <> 0 or x.anteriores <> 0
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.comisiones_periodo(date, date) from public, anon;
grant execute on function public.comisiones_periodo(date, date) to authenticated;

-- Pedidos por pagar de un vendedor en un periodo, o los que cubrió un pago
create or replace function public.comision_pedidos(p_vendedor uuid, p_desde date default null, p_hasta date default null, p_pago uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_pago public.pagos_comision;
begin
  if not (public.tiene_rol(array['admin']) or p_vendedor = auth.uid()) then raise exception 'Sin permiso'; end if;
  if p_pago is not null then
    select * into v_pago from public.pagos_comision where id = p_pago and vendedor_id = p_vendedor;
    if not found then raise exception 'Ese pago no existe'; end if;
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'numero', p.numero, 'dia', (p.created_at at time zone 'America/Bogota')::date,
               'cliente_nombre', p.cliente_nombre, 'total', p.total,
               'comision', public.comision_neta(p.comision, p.canal, p.comision_tipo, p.valor_domicilio, p.pago_domiciliario))
             order by p.created_at)
      from public.pedidos p where p.id = any (v_pago.pedido_ids)
    ), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(c) order by c.dia, c.numero)
    from public.comisiones_pendientes(p_vendedor) c
    where (p_desde is null or c.dia >= p_desde) and (p_hasta is null or c.dia <= p_hasta)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.comision_pedidos(uuid, date, date, uuid) from public, anon;
grant execute on function public.comision_pedidos(uuid, date, date, uuid) to authenticated;

-- Registrar el pago de las comisiones de un periodo
create or replace function public.pagar_comisiones(p_vendedor uuid, p_desde date, p_hasta date, p_metodo text, p_comprobantes text[], p_nota text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_ids uuid[];
  v_total numeric;
  v_soportes text[];
  v_id uuid;
  v_nombre text;
begin
  if not public.tiene_rol(array['admin']) then raise exception 'Solo el admin registra pagos'; end if;
  if p_metodo not in ('efectivo', 'transferencia', 'otro') then raise exception 'Elige cómo le pagaste'; end if;
  if p_hasta < p_desde then raise exception 'Revisa las fechas'; end if;
  select nombre into v_nombre from public.profiles where id = p_vendedor;
  if v_nombre is null then raise exception 'Ese vendedor no existe'; end if;

  -- Que nadie más pague lo mismo al tiempo
  perform pg_advisory_xact_lock(hashtext('pagar_comisiones:' || p_vendedor::text));

  select array_agg(c.id), sum(c.comision) into v_ids, v_total
  from public.comisiones_pendientes(p_vendedor) c
  where c.dia between p_desde and p_hasta;
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'No hay pedidos por pagar en estas fechas'; end if;

  select coalesce(array_agg(trim(r)), '{}') into v_soportes
  from unnest(coalesce(p_comprobantes, '{}')) r
  where public.comprobante_existe(r);
  if p_metodo = 'transferencia' and cardinality(v_soportes) = 0 then
    raise exception 'Sube el comprobante de la transferencia';
  end if;

  insert into public.pagos_comision (vendedor_id, desde, hasta, cantidad_pedidos, total, metodo, comprobantes, nota, pedido_ids, pagado_por, pagado_por_nombre)
  values (p_vendedor, p_desde, p_hasta, cardinality(v_ids), v_total, p_metodo, v_soportes,
          nullif(left(trim(coalesce(p_nota, '')), 200), ''), v_ids, auth.uid(), public.mi_nombre())
  returning id into v_id;
  insert into public.pago_comision_pedidos (pedido_id, pago_id) select unnest(v_ids), v_id;

  perform public.avisar_usuario(p_vendedor, 'pago_comision',
    'Te pagaron ' || public.pesos(v_total) || ' de comisiones',
    cardinality(v_ids) || case when cardinality(v_ids) = 1 then ' pedido' else ' pedidos' end
      || ' del ' || to_char(p_desde, 'DD/MM') || ' al ' || to_char(p_hasta, 'DD/MM')
      || case p_metodo when 'transferencia' then ' · por transferencia' when 'efectivo' then ' · en efectivo' else '' end,
    '/vendedor/pagos?pago=' || v_id);
  return v_id;
end;
$$;
revoke all on function public.pagar_comisiones(uuid, date, date, text, text[], text) from public, anon;
grant execute on function public.pagar_comisiones(uuid, date, date, text, text[], text) to authenticated;

-- Anular un pago: sus pedidos vuelven a quedar por pagar
create or replace function public.anular_pago_comision(p_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.tiene_rol(array['admin']) then raise exception 'Solo el admin anula pagos'; end if;
  update public.pagos_comision set anulado = true, anulado_at = now(), anulado_por = auth.uid()
  where id = p_id and not anulado;
  if not found then raise exception 'Ese pago no existe o ya estaba anulado'; end if;
  delete from public.pago_comision_pedidos where pago_id = p_id;
end;
$$;
revoke all on function public.anular_pago_comision(uuid) from public, anon;
grant execute on function public.anular_pago_comision(uuid) to authenticated;

-- Subir el soporte después (pago en efectivo, o se olvidó el pantallazo)
create or replace function public.agregar_soporte_pago(p_id uuid, p_comprobantes text[])
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_soportes text[];
  v_pago public.pagos_comision;
begin
  if not public.tiene_rol(array['admin']) then raise exception 'Solo el admin sube soportes'; end if;
  select coalesce(array_agg(trim(r)), '{}') into v_soportes
  from unnest(coalesce(p_comprobantes, '{}')) r where public.comprobante_existe(r);
  if cardinality(v_soportes) = 0 then raise exception 'Sube al menos una foto del soporte'; end if;
  update public.pagos_comision set comprobantes = comprobantes || v_soportes
  where id = p_id and not anulado returning * into v_pago;
  if not found then raise exception 'Ese pago no existe o está anulado'; end if;
  perform public.avisar_usuario(v_pago.vendedor_id, 'pago_comision', 'Ya está el comprobante de tu pago',
    public.pesos(v_pago.total) || ' del ' || to_char(v_pago.desde, 'DD/MM') || ' al ' || to_char(v_pago.hasta, 'DD/MM'),
    '/vendedor/pagos?pago=' || v_pago.id);
end;
$$;
revoke all on function public.agregar_soporte_pago(uuid, text[]) from public, anon;
grant execute on function public.agregar_soporte_pago(uuid, text[]) to authenticated;

create or replace function public.guardar_comisiones_desde(p_dia date)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.tiene_rol(array['admin']) then raise exception 'Solo el admin cambia esta fecha'; end if;
  if p_dia is null or p_dia > (now() at time zone 'America/Bogota')::date then raise exception 'Elige un día que ya haya pasado'; end if;
  update public.configuracion set comisiones_desde = p_dia;
end;
$$;
revoke all on function public.guardar_comisiones_desde(date) from public, anon;
grant execute on function public.guardar_comisiones_desde(date) to authenticated;

-- ═════════════════════════ 2. RECOLECTOR ═════════════════════════

create table if not exists public.recoleccion_bases (
  id uuid primary key default gen_random_uuid(),
  recolector_id uuid not null references public.profiles(id),
  monto numeric(12, 2) not null check (monto > 0 and monto <= 100000000),
  nombre text not null check (length(trim(nombre)) between 1 and 120),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada')),
  creada_por uuid references public.profiles(id),
  creada_por_nombre text,
  respondida_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recoleccion_bases_rec_idx on public.recoleccion_bases (recolector_id, created_at desc);

create table if not exists public.recoleccion_compras (
  id uuid primary key default gen_random_uuid(),
  recolector_id uuid not null references public.profiles(id),
  valor numeric(12, 2) not null check (valor > 0 and valor <= 100000000),
  proveedor text not null check (length(trim(proveedor)) between 1 and 120),
  producto text not null check (length(trim(producto)) between 1 and 200),
  facturas text[] not null default '{}',
  producto_id uuid references public.productos(id) on delete set null,
  cantidad int check (cantidad is null or cantidad > 0),
  costo_unitario numeric(12, 2),
  costo_anterior numeric(12, 2),
  creada_por_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists recoleccion_compras_rec_idx on public.recoleccion_compras (recolector_id, created_at desc);

create table if not exists public.recoleccion_entregas (
  id uuid primary key default gen_random_uuid(),
  recolector_id uuid not null references public.profiles(id),
  valor numeric(12, 2) not null check (valor > 0),
  nota text check (nota is null or length(nota) <= 300),
  dia date not null,
  recibida_por uuid references public.profiles(id),
  recibida_por_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists recoleccion_entregas_dia_idx on public.recoleccion_entregas (recolector_id, dia);

alter table public.recoleccion_bases enable row level security;
alter table public.recoleccion_compras enable row level security;
alter table public.recoleccion_entregas enable row level security;

-- Lectura (para el tiempo real): admin y despachador todo; el recolector lo suyo
drop policy if exists "recoleccion_bases: ver" on public.recoleccion_bases;
create policy "recoleccion_bases: ver" on public.recoleccion_bases for select to authenticated
  using ((select public.tiene_rol(array['admin', 'despachador'])) or recolector_id = (select auth.uid()));
drop policy if exists "recoleccion_compras: ver" on public.recoleccion_compras;
create policy "recoleccion_compras: ver" on public.recoleccion_compras for select to authenticated
  using ((select public.tiene_rol(array['admin', 'despachador'])) or recolector_id = (select auth.uid()));
drop policy if exists "recoleccion_entregas: ver" on public.recoleccion_entregas;
create policy "recoleccion_entregas: ver" on public.recoleccion_entregas for select to authenticated
  using ((select public.tiene_rol(array['admin', 'despachador'])) or recolector_id = (select auth.uid()));
grant select on public.recoleccion_bases, public.recoleccion_compras, public.recoleccion_entregas to authenticated;
revoke insert, update, delete on public.recoleccion_bases, public.recoleccion_compras, public.recoleccion_entregas from authenticated, anon;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['recoleccion_bases', 'recoleccion_compras', 'recoleccion_entregas'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

create or replace function public.es_recolector(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (select 1 from public.profiles where id = p_id and activo and 'recolector' = any (roles::text[]));
$$;
revoke all on function public.es_recolector(uuid) from public, anon;
grant execute on function public.es_recolector(uuid) to authenticated;

-- Avisos a quien tenga el rol admin (esté en el modo que esté)
create or replace function public.avisar_admins(p_tipo text, p_titulo text, p_cuerpo text, p_url text)
returns void
language sql
security definer
set search_path to ''
as $$
  insert into public.notificaciones (usuario_id, tipo, titulo, cuerpo, url)
  select p.id, p_tipo, p_titulo, p_cuerpo, p_url
  from public.profiles p
  where 'admin' = any (p.roles::text[]) and p.activo and p.id is distinct from auth.uid();
$$;
revoke all on function public.avisar_admins(text, text, text, text) from public, anon, authenticated;

-- Lo que falta por entregar de un día (o de un rango)
create or replace function public.recoleccion_pendiente(p_rec uuid, p_desde date, p_hasta date)
returns numeric
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((select sum(monto) from public.recoleccion_bases where recolector_id = p_rec and estado = 'aceptada'
           and created_at >= (p_desde::text || ' 00:00 America/Bogota')::timestamptz
           and created_at < ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz), 0)
       - coalesce((select sum(valor) from public.recoleccion_compras where recolector_id = p_rec
           and created_at >= (p_desde::text || ' 00:00 America/Bogota')::timestamptz
           and created_at < ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz), 0)
       - coalesce((select sum(valor) from public.recoleccion_entregas where recolector_id = p_rec and dia between p_desde and p_hasta), 0);
$$;
revoke all on function public.recoleccion_pendiente(uuid, date, date) from public, anon, authenticated;

create or replace function public.recoleccion_resumen(p_desde date, p_hasta date, p_recolector uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  d timestamptz := (p_desde::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz;
  v_ve_todos boolean := public.tiene_rol(array['admin', 'despachador']);
  v_rec uuid;
  v_ini date := greatest(p_desde - 21, date '2026-11-01');
begin
  if v_ve_todos then v_rec := p_recolector;
  elsif public.tiene_rol(array['recolector']) then v_rec := auth.uid();
  else raise exception 'Sin permiso'; end if;
  if p_hasta < p_desde or p_hasta - p_desde > 400 then raise exception 'Rango de fechas inválido (máximo 400 días)'; end if;
  return jsonb_build_object(
    'base', (select coalesce(sum(monto), 0) from public.recoleccion_bases where estado = 'aceptada'
             and (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'compras', (select coalesce(sum(valor), 0) from public.recoleccion_compras
             where (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'entregado', (select coalesce(sum(valor), 0) from public.recoleccion_entregas
             where (v_rec is null or recolector_id = v_rec) and dia between p_desde and p_hasta),
    'saldo', case when v_rec is not null then public.recoleccion_pendiente(v_rec, p_desde, p_hasta) end,
    'n_compras', (select count(*) from public.recoleccion_compras where (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'n_bases', (select count(*) from public.recoleccion_bases where estado = 'aceptada' and (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'pendientes', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'monto', b.monto, 'nombre', b.nombre, 'de', b.creada_por_nombre,
                     'recolector', u.nombre, 'fecha', b.created_at) order by b.created_at), '[]')
                   from public.recoleccion_bases b join public.profiles u on u.id = b.recolector_id
                   where b.estado = 'pendiente' and (v_rec is null or b.recolector_id = v_rec)),
    'movimientos', (select coalesce(jsonb_agg(m order by m.fecha desc), '[]') from (
        select 'base' as tipo, b.id, b.created_at as fecha, b.monto as valor, b.nombre, b.estado, b.creada_por_nombre as quien, u.nombre as recolector,
               null::text as proveedor, null::text as producto, null::text[] as facturas, null::date as dia
        from public.recoleccion_bases b join public.profiles u on u.id = b.recolector_id
        where (v_rec is null or b.recolector_id = v_rec) and b.created_at >= d and b.created_at < h
        union all
        select 'compra', c.id, c.created_at, c.valor, null, null, c.creada_por_nombre, u.nombre, c.proveedor, c.producto, c.facturas, null
        from public.recoleccion_compras c join public.profiles u on u.id = c.recolector_id
        where (v_rec is null or c.recolector_id = v_rec) and c.created_at >= d and c.created_at < h
        union all
        select 'entrega', e.id, e.created_at, e.valor, e.nota, null, e.recibida_por_nombre, u.nombre, null, null, null, e.dia
        from public.recoleccion_entregas e join public.profiles u on u.id = e.recolector_id
        where (v_rec is null or e.recolector_id = v_rec) and e.dia between p_desde and p_hasta
        order by 3 desc limit 500) m),
    'recolectores', case when v_ve_todos then (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre), '[]')
                      from public.profiles where activo and 'recolector' = any (roles::text[])) else '[]'::jsonb end,
    -- Una tarjeta por recolector con lo de este día
    'por_recolector', case when v_ve_todos and v_rec is null then (select coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'nombre', u.nombre, 'avatar_url', u.avatar_url,
        'base', (select coalesce(sum(monto), 0) from public.recoleccion_bases where recolector_id = u.id and estado = 'aceptada' and created_at >= d and created_at < h),
        'compras', (select coalesce(sum(valor), 0) from public.recoleccion_compras where recolector_id = u.id and created_at >= d and created_at < h),
        'entregado', (select coalesce(sum(valor), 0) from public.recoleccion_entregas where recolector_id = u.id and dia between p_desde and p_hasta),
        'pendientes', (select count(*) from public.recoleccion_bases where recolector_id = u.id and estado = 'pendiente'),
        'saldo', public.recoleccion_pendiente(u.id, p_desde, p_hasta)) order by u.nombre), '[]')
      from public.profiles u where u.activo and 'recolector' = any (u.roles::text[])) else '[]'::jsonb end,
    -- Días anteriores (últimas 3 semanas) que quedaron sin entregar, para no perderlos de vista
    'dias_sin_entregar', (select coalesce(jsonb_agg(x order by x.dia desc, x.nombre), '[]') from (
        select u.id, u.nombre, dd.dia, public.recoleccion_pendiente(u.id, dd.dia, dd.dia) as falta
        from public.profiles u
        cross join lateral (
          select (created_at at time zone 'America/Bogota')::date as dia from public.recoleccion_bases
            where recolector_id = u.id and estado = 'aceptada' and created_at >= (v_ini::text || ' 00:00 America/Bogota')::timestamptz and created_at < d
          union
          select (created_at at time zone 'America/Bogota')::date from public.recoleccion_compras
            where recolector_id = u.id and created_at >= (v_ini::text || ' 00:00 America/Bogota')::timestamptz and created_at < d
        ) dd
        where 'recolector' = any (u.roles::text[]) and (v_rec is null or u.id = v_rec)
      ) x where x.falta > 0)
  );
end;
$$;
revoke all on function public.recoleccion_resumen(date, date, uuid) from public, anon;
grant execute on function public.recoleccion_resumen(date, date, uuid) to authenticated;

-- Agregar (recolector) o enviar (admin) una base
create or replace function public.recoleccion_agregar_base(p_monto numeric, p_nombre text, p_recolector uuid default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_yo uuid := auth.uid();
  v_rec uuid;
  v_id uuid;
begin
  if coalesce(p_monto, 0) <= 0 then raise exception 'Escribe el valor de la base'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Ponle nombre a la base (de dónde viene)'; end if;
  if public.tiene_rol(array['recolector']) then
    v_rec := v_yo;
  elsif public.tiene_rol(array['admin']) then
    v_rec := p_recolector;
    if v_rec is null or not public.es_recolector(v_rec) then raise exception 'Elige a qué recolector va la base'; end if;
  else
    raise exception 'Sin permiso';
  end if;
  insert into public.recoleccion_bases (recolector_id, monto, nombre, estado, creada_por, creada_por_nombre, respondida_at)
  values (v_rec, round(p_monto), left(trim(p_nombre), 120), case when v_rec = v_yo then 'aceptada' else 'pendiente' end,
          v_yo, public.mi_nombre(), case when v_rec = v_yo then now() end)
  returning id into v_id;
  if v_rec <> v_yo then
    perform public.avisar_usuario(v_rec, 'base_recolector', 'Te enviaron una base de ' || public.pesos(p_monto),
      left(trim(p_nombre), 120) || ' · de ' || coalesce(public.mi_nombre(), 'el admin') || '. Acéptala para sumarla.', '/recolector');
  end if;
  return v_id;
end;
$$;
revoke all on function public.recoleccion_agregar_base(numeric, text, uuid) from public, anon;
grant execute on function public.recoleccion_agregar_base(numeric, text, uuid) to authenticated;

create or replace function public.recoleccion_responder_base(p_base uuid, p_aceptar boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  b public.recoleccion_bases;
begin
  select * into b from public.recoleccion_bases where id = p_base for update;
  if not found then raise exception 'Base no encontrada'; end if;
  if b.recolector_id <> auth.uid() or not public.tiene_rol(array['recolector']) then raise exception 'Esta base no es tuya'; end if;
  if b.estado <> 'pendiente' then raise exception 'Esta base ya fue %', b.estado; end if;
  update public.recoleccion_bases set estado = case when p_aceptar then 'aceptada' else 'rechazada' end, respondida_at = now() where id = p_base;
  if b.creada_por is not null then
    perform public.avisar_usuario(b.creada_por, 'base_recolector',
      coalesce(public.mi_nombre(), 'El recolector') || case when p_aceptar then ' aceptó la base de ' else ' rechazó la base de ' end || public.pesos(b.monto),
      b.nombre, '/admin/recolector');
  end if;
end;
$$;
revoke all on function public.recoleccion_responder_base(uuid, boolean) from public, anon;
grant execute on function public.recoleccion_responder_base(uuid, boolean) to authenticated;

create or replace function public.recoleccion_registrar_compra(p_valor numeric, p_proveedor text, p_producto text, p_facturas text[],
  p_producto_id uuid default null, p_cantidad int default null, p_costo numeric default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_yo uuid := auth.uid();
  v_ev text[];
  v_id uuid;
  pr public.productos;
  v_valor numeric := round(coalesce(p_valor, 0));
  v_texto text := trim(coalesce(p_producto, ''));
  v_costo numeric := round(coalesce(p_costo, 0));
begin
  if not public.tiene_rol(array['recolector']) then raise exception 'Solo el recolector registra compras'; end if;
  if coalesce(trim(p_proveedor), '') = '' then raise exception 'Escribe el proveedor'; end if;
  if p_producto_id is not null then
    select * into pr from public.productos where id = p_producto_id for update;
    if not found then raise exception 'Ese producto no existe'; end if;
    if coalesce(p_cantidad, 0) <= 0 then raise exception 'Escribe cuántos compraste'; end if;
    if v_costo <= 0 then raise exception 'Escribe cuánto te costó cada uno'; end if;
    v_valor := v_costo * p_cantidad;
    v_texto := p_cantidad || ' × ' || pr.nombre;
  end if;
  if v_valor <= 0 then raise exception 'Escribe el valor de la compra'; end if;
  if v_texto = '' then raise exception 'Escribe qué compraste'; end if;
  select coalesce(array_agg(trim(r)), '{}') into v_ev
  from unnest(coalesce(p_facturas, '{}')) r where public.comprobante_existe(r);
  if cardinality(v_ev) = 0 then raise exception 'Sube la foto de la factura'; end if;

  insert into public.recoleccion_compras (recolector_id, valor, proveedor, producto, facturas, creada_por_nombre, producto_id, cantidad, costo_unitario, costo_anterior)
  values (v_yo, v_valor, left(trim(p_proveedor), 120), left(v_texto, 200), v_ev, public.mi_nombre(),
          pr.id, case when pr.id is not null then p_cantidad end, case when pr.id is not null then v_costo end, pr.costo)
  returning id into v_id;

  -- El costo del producto queda con lo que le costó al recolector
  if pr.id is not null and pr.costo is distinct from v_costo then
    update public.productos set costo = v_costo, updated_at = now() where id = pr.id;
    perform public.avisar_admins('compras', 'Costo actualizado: ' || pr.nombre,
      'De ' || public.pesos(coalesce(pr.costo, 0)) || ' a ' || public.pesos(v_costo) || ' · compra de ' || coalesce(public.mi_nombre(), 'el recolector')
        || ' a ' || left(trim(p_proveedor), 60) || ' (' || p_cantidad || ' und)',
      '/admin/recolector');
  end if;
  return v_id;
end;
$$;
revoke all on function public.recoleccion_registrar_compra(numeric, text, text, text[], uuid, int, numeric) from public, anon;
grant execute on function public.recoleccion_registrar_compra(numeric, text, text, text[], uuid, int, numeric) to authenticated;

create or replace function public.recoleccion_borrar_compra(p_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  c public.recoleccion_compras;
  v_admin boolean := public.tiene_rol(array['admin']);
  v_ultima uuid;
begin
  select * into c from public.recoleccion_compras where id = p_id for update;
  if not found then raise exception 'Esa compra ya no existe'; end if;
  if not v_admin then
    if not public.tiene_rol(array['recolector']) or c.recolector_id is distinct from auth.uid() then raise exception 'Sin permiso'; end if;
    if (c.created_at at time zone 'America/Bogota')::date <> (now() at time zone 'America/Bogota')::date then
      raise exception 'Solo puedes quitar compras de hoy. Pídele al admin que la quite.';
    end if;
  end if;
  -- Si fue la última compra de ese producto, el costo vuelve a como estaba
  if c.producto_id is not null and c.costo_anterior is not null then
    select id into v_ultima from public.recoleccion_compras
      where producto_id = c.producto_id and costo_unitario is not null order by created_at desc, id desc limit 1;
    if v_ultima = c.id then
      update public.productos set costo = c.costo_anterior, updated_at = now()
        where id = c.producto_id and costo = c.costo_unitario;
    end if;
  end if;
  delete from public.recoleccion_compras where id = c.id;
  if not v_admin then
    perform public.avisar_admins('compras', 'Compra quitada: ' || c.producto,
      coalesce(public.mi_nombre(), 'El recolector') || ' quitó la compra de ' || public.pesos(c.valor) || ' a ' || coalesce(c.proveedor, '—'),
      '/admin/recolector');
  end if;
end;
$$;
revoke all on function public.recoleccion_borrar_compra(uuid) from public, anon;
grant execute on function public.recoleccion_borrar_compra(uuid) to authenticated;

-- El admin recibe la plata: queda a nombre del día que se está cuadrando
create or replace function public.recoleccion_recibir(p_recolector uuid, p_valor numeric, p_nota text, p_dia date default null)
returns numeric
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_valor numeric := round(coalesce(p_valor, 0));
  v_dia date := coalesce(p_dia, (now() at time zone 'America/Bogota')::date);
  v_falta numeric;
begin
  if not public.tiene_rol(array['admin']) then raise exception 'Solo el admin recibe la plata del recolector'; end if;
  if not public.es_recolector(p_recolector) then raise exception 'Ese recolector no existe'; end if;
  if v_valor <= 0 then raise exception 'Escribe cuánto recibiste'; end if;
  if v_dia > (now() at time zone 'America/Bogota')::date then raise exception 'No puedes recibir plata de un día que no ha llegado'; end if;
  insert into public.recoleccion_entregas (recolector_id, valor, nota, dia, recibida_por, recibida_por_nombre)
  values (p_recolector, v_valor, nullif(left(trim(coalesce(p_nota, '')), 300), ''), v_dia, auth.uid(), public.mi_nombre());
  v_falta := public.recoleccion_pendiente(p_recolector, v_dia, v_dia);
  perform public.avisar_usuario(p_recolector, 'base_recolector',
    coalesce(public.mi_nombre(), 'El admin') || ' recibió ' || public.pesos(v_valor) || ' del ' || to_char(v_dia, 'DD/MM'),
    case when v_falta = 0 then 'Ese día quedó en cero.'
         when v_falta > 0 then 'De ese día todavía faltan ' || public.pesos(v_falta)
         else 'De ese día quedó a tu favor ' || public.pesos(-v_falta) end,
    '/recolector');
  return v_falta;
end;
$$;
revoke all on function public.recoleccion_recibir(uuid, numeric, text, date) from public, anon;
grant execute on function public.recoleccion_recibir(uuid, numeric, text, date) to authenticated;

create or replace function public.recoleccion_borrar_entrega(p_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.tiene_rol(array['admin']) then raise exception 'Sin permiso'; end if;
  delete from public.recoleccion_entregas where id = p_id;
  if not found then raise exception 'Esa entrega ya no existe'; end if;
end;
$$;
revoke all on function public.recoleccion_borrar_entrega(uuid) from public, anon;
grant execute on function public.recoleccion_borrar_entrega(uuid) to authenticated;

-- ═════════════════════════ Comprobantes (bucket privado) ═════════════════════════
-- Soportes de pagos: carpeta pagos/ (los sube el admin; los ve el admin y el vendedor del pago).
-- Facturas del recolector: carpeta recoleccion/<su id>/ (las sube él; las ven él, admin y despachador).

drop policy if exists "comprobantes: pagos sube admin" on storage.objects;
create policy "comprobantes: pagos sube admin" on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and name like 'pagos/%' and (select public.tiene_rol(array['admin'])));

drop policy if exists "comprobantes: pagos ver" on storage.objects;
create policy "comprobantes: pagos ver" on storage.objects for select to authenticated
  using (
    bucket_id = 'comprobantes' and name like 'pagos/%'
    and ((select public.tiene_rol(array['admin']))
         or exists (select 1 from public.pagos_comision g where g.vendedor_id = (select auth.uid()) and storage.objects.name = any (g.comprobantes)))
  );

drop policy if exists "comprobantes: recoleccion sube" on storage.objects;
create policy "comprobantes: recoleccion sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and name like 'recoleccion/' || (select auth.uid())::text || '/%'
              and (select public.tiene_rol(array['recolector'])));

drop policy if exists "comprobantes: recoleccion ver" on storage.objects;
create policy "comprobantes: recoleccion ver" on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and name like 'recoleccion/%'
         and ((select public.tiene_rol(array['admin', 'despachador'])) or name like 'recoleccion/' || (select auth.uid())::text || '/%'));
