-- Home ALS · 2026-10-26
-- El admin puede eliminar ventas del local (por ejemplo, una que se registró por
-- error). eliminar_pedido no sirve porque las ventas del local nacen entregadas y
-- esa función bloquea los entregados (por los cuadres de los domiciliarios, que
-- las ventas del local no tienen).
--  - Solo admin (en modo admin) y solo pedidos con canal = 'local'.
--  - Devuelve el stock de los productos, igual que eliminar_pedido.
--  - La foto del comprobante la borra la app del bucket después.
-- Sin begin/commit: el workflow "SQL en Supabase" lo envuelve en una transacción.

create or replace function public.eliminar_venta_local(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  v_canal text;
begin
  if public.current_role()::text <> 'admin' then
    raise exception 'Solo el admin puede eliminar ventas del local';
  end if;
  select canal::text into v_canal from public.pedidos where id = p_pedido_id;
  if v_canal is null then raise exception 'La venta no existe'; end if;
  if v_canal <> 'local' then
    raise exception 'Solo se pueden eliminar aquí ventas del local';
  end if;

  perform set_config('homeals.origen', 'pedido', true);
  update public.productos prod
     set stock = prod.stock + pi.cantidad
    from public.pedido_items pi
   where pi.pedido_id = p_pedido_id and pi.producto_id = prod.id;
  delete from public.pedidos where id = p_pedido_id;
end;
$f$;

revoke all on function public.eliminar_venta_local(uuid) from public, anon;
grant execute on function public.eliminar_venta_local(uuid) to authenticated;

-- El admin puede borrar la foto del comprobante de la venta que elimina
drop policy if exists "comprobantes: admin borra" on storage.objects;
create policy "comprobantes: admin borra" on storage.objects
  for delete to authenticated
  using (bucket_id = 'comprobantes' and public.current_role()::text = 'admin');
