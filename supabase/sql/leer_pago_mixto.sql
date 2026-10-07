-- Solo estructura (sin datos): lo necesario para pago mixto y comprobantes.
\pset format unaligned
\pset tuples_only on
select '==== TRIGGER ' || t.tgname || ': ' || pg_get_triggerdef(t.oid) || E'\n' || pg_get_functiondef(t.tgfoid)
from pg_trigger t where t.tgrelid = 'public.pedidos'::regclass and not t.tgisinternal order by t.tgname;
select '==== COLUMNA ' || column_name || ' ' || data_type
  || coalesce(' default ' || column_default, '') || case when is_generated = 'ALWAYS' then ' GENERATED ' || coalesce(generation_expression,'') else '' end
from information_schema.columns where table_schema = 'public' and table_name = 'pedidos' order by ordinal_position;
select '==== CHECK ' || conname || ': ' || pg_get_constraintdef(oid)
from pg_constraint where conrelid = 'public.pedidos'::regclass and contype = 'c' order by 1;
select '==== POLICY ' || schemaname || '.' || tablename || '.' || policyname || ' ' || cmd || ' using(' || coalesce(qual,'') || ') check(' || coalesce(with_check,'') || ')'
from pg_policies where (schemaname = 'storage' and tablename = 'objects') or (schemaname = 'public' and tablename = 'pedidos') order by 1;
select '==== FUNCION ' || p.proname || E'\n' || pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('editar_pedido', 'current_role', 'tiene_rol');
