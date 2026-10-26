-- Solo lectura de estructura (modo "leer"): qué deja cambiar la base en profiles.
select policyname, cmd, qual, with_check
  from pg_policies where schemaname = 'public' and tablename = 'profiles';

select tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where c.relname = 'profiles' and not t.tgisinternal;

select p.proname, pg_get_functiondef(p.oid)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc p on p.oid = t.tgfoid
 where c.relname = 'profiles' and not t.tgisinternal;

select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' order by ordinal_position;
