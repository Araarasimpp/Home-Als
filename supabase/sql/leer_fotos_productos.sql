-- Solo lectura (modo "leer"): de dónde vienen las fotos de los productos.
-- Solo cuenta por sitio y tipo de link; no muestra datos de clientes.
select case
         when imagen_url is null or trim(imagen_url) = '' then '(sin foto)'
         else split_part(imagen_url, '/', 3)
       end as sitio,
       case
         when imagen_url ilike '%/storage/v1/object/public/%' then 'storage público'
         when imagen_url ilike '%/storage/v1/object/sign/%' then 'storage FIRMADO (vence)'
         when imagen_url ilike '%/storage/v1/%' then 'storage otro'
         when imagen_url ilike '%drive.google%' then 'google drive'
         when imagen_url is null or trim(imagen_url) = '' then '-'
         else 'otro'
       end as tipo,
       count(*) as productos
  from public.productos
 group by 1, 2
 order by 3 desc;

select id, public, file_size_limit from storage.buckets order by id;

-- ¿Existen en storage los archivos a los que apuntan los links?
select b.bucket,
       count(*) as links,
       count(o.id) as archivo_existe
  from (
    select split_part(split_part(imagen_url, '/storage/v1/object/public/', 2), '/', 1) as bucket,
           split_part(split_part(imagen_url, '/storage/v1/object/public/', 2), '?', 1) as ruta
      from public.productos
     where imagen_url ilike '%/storage/v1/object/public/%'
  ) b
  left join storage.objects o
    on o.bucket_id = b.bucket
   and o.name = substr(b.ruta, length(b.bucket) + 2)
 group by b.bucket;

select policyname, cmd, qual from pg_policies
 where schemaname = 'storage' and tablename = 'objects' order by policyname;
