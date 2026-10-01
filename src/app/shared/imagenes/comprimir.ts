// src/app/shared/imagenes/comprimir.ts
// Comprime fotos antes de subirlas a Supabase Storage. Una foto de celular
// pesa 3-8 MB; después de esto queda en ~150-400 KB, se sube más rápido con
// datos móviles y ocupa mucho menos espacio en el plan de Supabase.
// Necesita: npm install browser-image-compression
import imageCompression from 'browser-image-compression';

type Perfil = 'producto' | 'comprobante' | 'avatar';

const PERFILES: Record<Perfil, { maxSizeMB: number; maxWidthOrHeight: number; initialQuality: number }> = {
  // Se ve en el catálogo y en pantallas grandes
  producto: { maxSizeMB: 0.35, maxWidthOrHeight: 1200, initialQuality: 0.82 },
  // Debe seguir siendo legible (números de cuenta, valores, fechas)
  comprobante: { maxSizeMB: 0.5, maxWidthOrHeight: 1600, initialQuality: 0.85 },
  // Paso intermedio: luego se recorta cuadrada a 256 px
  avatar: { maxSizeMB: 0.2, maxWidthOrHeight: 640, initialQuality: 0.85 },
};

/**
 * Devuelve la imagen comprimida en JPEG. Si algo falla (formato raro, sin
 * memoria), devuelve el archivo original para no bloquear la subida.
 */
export async function comprimirImagen(archivo: File, perfil: Perfil): Promise<File> {
  // GIF animados y SVG se dejan como vienen
  if (!archivo.type.startsWith('image/') || /gif|svg/.test(archivo.type)) return archivo;

  const p = PERFILES[perfil];
  // Si ya es pequeña, no se toca
  if (archivo.size <= p.maxSizeMB * 1024 * 1024 && archivo.type === 'image/jpeg') return archivo;

  try {
    const comprimido = await imageCompression(archivo, {
      maxSizeMB: p.maxSizeMB,
      maxWidthOrHeight: p.maxWidthOrHeight,
      initialQuality: p.initialQuality,
      fileType: 'image/jpeg',
      useWebWorker: true, // no congela la pantalla mientras comprime
    });
    // Si por algún motivo salió más pesada, se usa la original
    if (comprimido.size >= archivo.size) return archivo;
    const nombre = archivo.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([comprimido], nombre, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return archivo;
  }
}

/** Extensión correcta según el tipo real del archivo (después de comprimir). */
export function extensionDe(archivo: File): string {
  if (archivo.type === 'image/jpeg') return 'jpg';
  if (archivo.type === 'image/png') return 'png';
  if (archivo.type === 'image/webp') return 'webp';
  if (archivo.type === 'image/gif') return 'gif';
  return (archivo.name.split('.').pop() || 'jpg').toLowerCase();
}
