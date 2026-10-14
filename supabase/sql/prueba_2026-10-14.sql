-- Prueba (modo "probar": se deshace al final)
\i supabase/sql/2026-10-14_domicilio_por_defecto.sql
do $$
declare v numeric;
begin
  select valor_domicilio into v from public.configuracion where id;
  raise notice 'valor_domicilio por defecto = %', v;
  assert v = 10000, 'debe quedar en 10000';
end $$;
