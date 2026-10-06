-- Solo estructura (sin datos): definiciones de funciones, triggers y columnas
-- que se van a modificar.
\pset format unaligned
\pset tuples_only on
select '==== FUNCION ' || p.proname || E'\n' || pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by p.proname;
select '==== TRIGGER ' || c.relname || '.' || t.tgname || ': ' || pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal order by 1;
select '==== COLUMNA ' || table_name || '.' || column_name || ' ' || data_type
  || coalesce(' default ' || column_default, '') || case when is_generated = 'ALWAYS' then ' GENERATED ' || coalesce(generation_expression,'') else '' end
  || case when is_nullable = 'NO' then ' not null' else '' end
from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position;
select '==== POLICY ' || tablename || '.' || policyname || ' ' || cmd || ' roles=' || array_to_string(roles, ',')
  || ' using(' || coalesce(qual,'') || ') check(' || coalesce(with_check,'') || ')'
from pg_policies where schemaname = 'public' order by 1;
select '==== CHECK ' || conrelid::regclass || '.' || conname || ': ' || pg_get_constraintdef(oid)
from pg_constraint where connamespace = 'public'::regnamespace and contype in ('c','f','u') order by 1;
select '==== ENUM ' || t.typname || ': ' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.typname;
