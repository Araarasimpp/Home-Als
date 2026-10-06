-- La ganancia de la tienda cuenta solo pedidos ENTREGADOS, por la fecha de entrega
-- (antes sumaba también los que iban en ruta, por fecha de creación).
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
      where p.estado = 'entregado'
        and p.entregado_at >= p_desde and p.entregado_at <= p_hasta
    ), 0)
    -
    coalesce((
      select sum(p.comision + (p.pago_domiciliario - p.valor_domicilio))
      from public.pedidos p
      where p.estado = 'entregado'
        and p.entregado_at >= p_desde and p.entregado_at <= p_hasta
    ), 0);
$$;

create index if not exists pedidos_entregado_at_idx on public.pedidos (entregado_at) where estado = 'entregado';

-- Comparación (solo lectura): ganancia de hoy antes y después del cambio
select
  public.ganancia_tienda(((now() at time zone 'America/Bogota')::date::text || ' 00:00:00-05:00')::timestamptz, now()) as ganancia_hoy_entregados,
  (select coalesce(sum(total), 0) from public.pedidos
    where estado = 'entregado'
      and entregado_at >= ((now() at time zone 'America/Bogota')::date::text || ' 00:00:00-05:00')::timestamptz) as ventas_hoy_entregadas,
  (select coalesce(sum(total), 0) from public.pedidos
    where estado in ('en_ruta', 'entregado')
      and created_at >= ((now() at time zone 'America/Bogota')::date::text || ' 00:00:00-05:00')::timestamptz) as ventas_hoy_como_estaba;
