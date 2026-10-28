// Copia una foto de Google Drive al bucket "productos" de Supabase.
//
// Las fotos con link de Drive fallan en la app: cuando una pantalla pide muchas
// a la vez (el catálogo de Nuevo pedido, la lista de Pedidos), Google empieza a
// bloquear las descargas desde el celular de cada persona. Desde Supabase
// cargan siempre. Google entrega estas fotos con CORS, así que el navegador del
// admin las puede descargar y subir con su sesión normal.
import { SupabaseClient } from '@supabase/supabase-js';
import { comprimirImagen, extensionDe } from './comprimir';

const PATRONES = [
  /drive\.google\.com\/file\/d\/([\w-]{10,})/i,
  /drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^#]*&)?id=([\w-]{10,})/i,
  /docs\.google\.com\/uc\?(?:[^#]*&)?id=([\w-]{10,})/i,
  /lh3\.googleusercontent\.com\/d\/([\w-]{10,})/i,
];

/** Id del archivo si el link es de Google Drive; null si no lo es. */
export function idDeDrive(url: string | null | undefined): string | null {
  const limpio = (url ?? '').trim();
  for (const p of PATRONES) {
    const m = limpio.match(p);
    if (m) return m[1];
  }
  return null;
}

export const esDeDrive = (url: string | null | undefined) => idDeDrive(url) !== null;

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Descarga la foto de Drive, la comprime y la sube a productos/drive/<id>.
 * Devuelve el link público nuevo. Lanza un error si Drive no la entrega
 * (por ejemplo, si el archivo no está compartido con "cualquier persona").
 */
export async function copiarDeDrive(db: SupabaseClient, url: string): Promise<string> {
  const id = idDeDrive(url);
  if (!id) throw new Error('No es un link de Google Drive');

  let blob: Blob | null = null;
  for (let intento = 0; intento < 4 && !blob; intento++) {
    const r = await fetch(`https://lh3.googleusercontent.com/d/${id}=w1200`, {
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }).catch(() => null);
    if (r?.ok) {
      const b = await r.blob();
      if (!b.type.startsWith('image/')) throw new Error('Drive no devolvió una imagen (¿está compartida?)');
      blob = b;
    } else if (r && ![429, 500, 502, 503].includes(r.status)) {
      throw new Error(`Drive respondió ${r.status}`);
    } else {
      await esperar(1500 * (intento + 1)); // Google pide calma: se reintenta
    }
  }
  if (!blob) throw new Error('Drive no respondió');

  const archivo = await comprimirImagen(new File([blob], `${id}.jpg`, { type: blob.type }), 'producto');
  const ruta = `drive/${id}.${extensionDe(archivo)}`;
  const { error } = await db.storage
    .from('productos')
    .upload(ruta, archivo, { upsert: true, contentType: archivo.type, cacheControl: '31536000' });
  if (error) throw error;
  return db.storage.from('productos').getPublicUrl(ruta).data.publicUrl;
}
