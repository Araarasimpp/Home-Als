-- Solo lectura de estructura (modo "leer"): definición de eliminar_pedido y
-- las políticas de pedidos y comprobantes. No consulta datos de clientes.
select pg_get_functiondef(p.oid) as definicion
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('eliminar_pedido', 'cancelar_pedido');

select tablename, policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename in ('pedidos', 'pedido_items', 'comprobantes');

select tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where c.relname in ('pedidos', 'pedido_items') and not t.tgisinternal;
