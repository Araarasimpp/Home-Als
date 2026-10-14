-- Solo estructura: perfiles, políticas y funciones relacionadas
\pset format unaligned
\pset tuples_only on
select '==== COLUMNA profiles.' || column_name || ' ' || data_type || coalesce(' default ' || column_default, '')
  from information_schema.columns where table_schema='public' and table_name='profiles' order by ordinal_position;
select '==== POLICY ' || tablename || '.' || policyname || ' ' || cmd || ' using(' || coalesce(qual,'') || ') check(' || coalesce(with_check,'') || ')'
  from pg_policies where schemaname='public' and tablename='profiles';
select '==== TRIGGER profiles.' || t.tgname from pg_trigger t where t.tgrelid='public.profiles'::regclass and not t.tgisinternal;
select '==== FUNCION ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1;
select '==== ROLES por perfil: ' || array_to_string(roles, ',') || ' activo=' || activo || ' -> ' || count(*)
  from public.profiles group by roles, activo order by 1;
