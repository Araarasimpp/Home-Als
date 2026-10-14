-- Home ALS · 2026-10-15
-- Ranking y metas:
--  - metas: meta mensual de ventas (vendedor) y de entregas (domiciliario). Solo el admin la cambia.
--  - ranking(desde, hasta): totales por persona para el podio. Solo devuelve
--    nombres y números (ningún dato de clientes), por eso cualquiera con sesión
--    puede consultarlo aunque por RLS cada quien solo vea sus pedidos.
-- Ventas = pedidos ENTREGADOS (venta sin domicilio) por fecha de entrega, igual que el dashboard.
-- Sin begin/commit: el workflow "SQL en Supabase" lo envuelve en una transacción.

create table if not exists public.metas (
  usuario_id uuid primary key references public.profiles(id) on delete cascade,
  meta_ventas numeric(12,2) check (meta_ventas is null or meta_ventas >= 0),
  meta_entregas integer check (meta_entregas is null or meta_entregas >= 0),
  updated_at timestamptz not null default now()
);

alter table public.metas enable row level security;

drop policy if exists "metas: leer autenticados" on public.metas;
create policy "metas: leer autenticados" on public.metas
  for select to authenticated using (true);

drop policy if exists "metas: admin escribe" on public.metas;
create policy "metas: admin escribe" on public.metas
  for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create or replace function public.ranking(p_desde date, p_hasta date)
returns table (
  usuario_id uuid,
  nombre text,
  avatar_url text,
  tipo text,          -- 'vendedor' | 'domiciliario'
  pedidos integer,
  ventas numeric,
  entregas integer,
  meta numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with rango as (
    select (p_desde::timestamp at time zone 'America/Bogota') as ini,
           ((p_hasta + 1)::timestamp at time zone 'America/Bogota') as fin
  ),
  entregados as (
    select p.* from public.pedidos p, rango r
     where p.estado = 'entregado'
       and coalesce(p.entregado_at, p.created_at) >= r.ini
       and coalesce(p.entregado_at, p.created_at) < r.fin
  ),
  vend as (
    select vendedor_id as id, count(*)::int as pedidos, sum(total - coalesce(valor_domicilio, 0)) as ventas
      from entregados group by vendedor_id
  ),
  dom as (
    select domiciliario_id as id, count(*)::int as entregas
      from entregados where canal = 'domicilio' and domiciliario_id is not null group by domiciliario_id
  )
  select pr.id, pr.nombre, pr.avatar_url, 'vendedor', coalesce(v.pedidos, 0), coalesce(v.ventas, 0), 0, m.meta_ventas
    from public.profiles pr
    left join vend v on v.id = pr.id
    left join public.metas m on m.usuario_id = pr.id
   where auth.uid() is not null
     and ((pr.activo and 'vendedor' = any (pr.roles::text[])) or v.id is not null)
  union all
  select pr.id, pr.nombre, pr.avatar_url, 'domiciliario', 0, 0, coalesce(d.entregas, 0), m.meta_entregas
    from public.profiles pr
    left join dom d on d.id = pr.id
    left join public.metas m on m.usuario_id = pr.id
   where auth.uid() is not null
     and ((pr.activo and 'domiciliario' = any (pr.roles::text[])) or d.id is not null);
$$;

revoke all on function public.ranking(date, date) from public, anon;
grant execute on function public.ranking(date, date) to authenticated;
