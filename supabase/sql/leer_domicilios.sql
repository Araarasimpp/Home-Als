-- Solo totales (sin datos de clientes): de dónde salen los valores de domicilio.
\pset format unaligned
select '==== CONFIG pago_domiciliario=' || pago_domiciliario from public.configuracion;
select '==== ZONA ' || coalesce(nombre,'?') || ' | cobra=' || valor || ' | paga=' || pago_domiciliario
  from public.zonas_domicilio order by valor, nombre;
select '==== PEDIDOS canal=' || canal || ' cobra=' || valor_domicilio || ' paga=' || pago_domiciliario || ' estado=' || estado || ' -> ' || n
  from (select canal, valor_domicilio, pago_domiciliario, estado::text as estado, count(*) as n
          from public.pedidos group by 1, 2, 3, 4) x order by canal, valor_domicilio, pago_domiciliario, estado;
select '==== 9000 en zona conocida: ' || en_zona || ' | cuadre: ' || con_cuadre || ' -> ' || n
  from (select (exists (select 1 from public.zonas_domicilio z where lower(trim(z.nombre)) = lower(trim(p.barrio))))::text as en_zona,
               (p.cuadre_id is not null)::text as con_cuadre, count(*) as n
          from public.pedidos p where canal = 'domicilio' and (valor_domicilio = 9000 or pago_domiciliario = 9000)
         group by 1, 2) x;
select '==== rango fechas con 9000: ' || min(created_at)::date || ' a ' || max(created_at)::date
  from public.pedidos where canal = 'domicilio' and (valor_domicilio = 9000 or pago_domiciliario = 9000);
select '==== COLUMNAS config: ' || string_agg(column_name || ' default ' || coalesce(column_default,'-'), ', ')
  from information_schema.columns where table_schema='public' and table_name in ('configuracion','zonas_domicilio');
