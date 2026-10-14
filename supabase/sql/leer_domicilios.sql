-- Solo totales (sin datos de clientes): de dónde salen los valores de domicilio.
\pset format unaligned
select '==== CONFIG pago_domiciliario=' || pago_domiciliario from public.configuracion;
select '==== ZONA ' || coalesce(nombre,'?') || ' | cobra=' || valor || ' | paga=' || pago_domiciliario
  from public.zonas_domicilio order by valor, nombre;
select '==== PEDIDOS canal=' || canal || ' cobra=' || valor_domicilio || ' paga=' || pago_domiciliario || ' estado=' || estado || ' -> ' || count(*)
  from public.pedidos group by 1 order by 1;
select '==== PEDIDOS 9000 por barrio: ' || coalesce(barrio,'(sin barrio)') || ' (en zonas: ' ||
       (exists (select 1 from public.zonas_domicilio z where lower(trim(z.nombre)) = lower(trim(p.barrio))))::text || ') -> ' || count(*)
  from public.pedidos p where canal = 'domicilio' and (valor_domicilio = 9000 or pago_domiciliario = 9000)
  group by barrio order by count(*) desc;
select '==== COLUMNAS config: ' || string_agg(column_name || ' default ' || coalesce(column_default,'-'), ', ')
  from information_schema.columns where table_schema='public' and table_name in ('configuracion','zonas_domicilio');
