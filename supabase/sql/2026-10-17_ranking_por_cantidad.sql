-- Home ALS · 2026-10-17
-- Ranking de vendedores por CANTIDAD de ventas (pedidos entregados), para todos.
-- A igual cantidad gana quien vendió más en pesos. El resto queda igual que en
-- 2026-10-16_ranking_privado.sql (los pesos solo los ven admin y despachador).
-- Sin begin/commit: el workflow "SQL en Supabase" lo envuelve en una transacción.

-- Cambian las columnas que devuelve: hay que borrarla y crearla de nuevo
drop function if exists public.ranking(date, date);

create function public.ranking(p_desde date, p_hasta date)
returns table (
  usuario_id uuid,
  nombre text,
  avatar_url text,
  tipo text,          -- 'vendedor' | 'domiciliario'
  pedidos integer,
  ventas numeric,     -- null si quien consulta no puede ver pesos
  entregas integer,
  meta numeric,       -- null en metas de ventas si no puede ver pesos
  orden integer,      -- puesto dentro de su tipo (1 = primero); vendedores por cantidad de ventas
  avance integer      -- % de la meta del mes (de todos si ve pesos; si no, solo el propio)
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with yo as (
    select exists (
      select 1 from public.profiles
       where id = auth.uid()
         and ('admin' = any (roles::text[]) or 'despachador' = any (roles::text[]))
    ) as ve_pesos
  ),
  rango as (
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
  ),
  filas as (
    select pr.id, pr.nombre, pr.avatar_url, 'vendedor'::text as tipo,
           coalesce(v.pedidos, 0) as pedidos, coalesce(v.ventas, 0) as ventas, 0 as entregas,
           m.meta_ventas as meta, coalesce(v.pedidos, 0) as puntaje, coalesce(v.ventas, 0) as logro
      from public.profiles pr
      left join vend v on v.id = pr.id
      left join public.metas m on m.usuario_id = pr.id
     where (pr.activo and 'vendedor' = any (pr.roles::text[])) or v.id is not null
    union all
    select pr.id, pr.nombre, pr.avatar_url, 'domiciliario', 0, 0, coalesce(d.entregas, 0),
           m.meta_entregas, coalesce(d.entregas, 0), coalesce(d.entregas, 0)
      from public.profiles pr
      left join dom d on d.id = pr.id
      left join public.metas m on m.usuario_id = pr.id
     where (pr.activo and 'domiciliario' = any (pr.roles::text[])) or d.id is not null
  )
  select f.id, f.nombre, f.avatar_url, f.tipo, f.pedidos,
         case when yo.ve_pesos then f.ventas end,
         f.entregas,
         case when yo.ve_pesos or f.tipo = 'domiciliario' then f.meta end,
         (row_number() over (partition by f.tipo order by f.puntaje desc, f.ventas desc, f.nombre))::int,
         case when f.meta > 0 and (yo.ve_pesos or f.tipo = 'domiciliario' or f.id = auth.uid())
              then least(100, round(f.logro / f.meta * 100))::int end
    from filas f, yo
   where auth.uid() is not null;
$$;

revoke all on function public.ranking(date, date) from public, anon;
grant execute on function public.ranking(date, date) to authenticated;
