-- Home ALS · 2026-10-14
-- Se deshace 2026-10-14_domicilio_por_defecto.sql: el cobro al cliente sigue
-- siendo el que escribe el vendedor (9.000 en barrios normales). La columna
-- se agregó hoy y nada la usa.
-- Sin begin/commit: el workflow "SQL en Supabase" lo envuelve en una transacción.
alter table public.configuracion drop column if exists valor_domicilio;
