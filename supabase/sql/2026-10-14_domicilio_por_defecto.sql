-- Home ALS · 2026-10-14
-- Valor del domicilio que se le cobra al cliente cuando el barrio no está en
-- la lista de zonas (antes los vendedores lo escribían a mano y quedaba en 9.000).
-- Se edita en Configuración → Barrios, junto al pago al domiciliario.
-- Sin begin/commit: el workflow "SQL en Supabase" lo envuelve en una transacción.

alter table public.configuracion
  add column if not exists valor_domicilio numeric(12,2) not null default 10000
  constraint configuracion_valor_domicilio_check check (valor_domicilio >= 0);

update public.configuracion set valor_domicilio = 10000 where valor_domicilio is distinct from 10000;
