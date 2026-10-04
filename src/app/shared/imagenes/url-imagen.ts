// src/app/shared/imagenes/url-imagen.ts
// Convierte links "para compartir" en links directos de imagen.
//
// Un link de Google Drive como
//   https://drive.google.com/file/d/ID/view?usp=sharing
// abre la página de Drive, no la imagen, por eso no se ve dentro de un <img>.
// Se convierte a la miniatura pública de Drive, que sí es una imagen:
//   https://drive.google.com/thumbnail?id=ID&sz=w800
// (El archivo debe estar compartido como "Cualquier persona con el enlace".)

const PATRONES_DRIVE = [
  /drive\.google\.com\/file\/d\/([\w-]{10,})/i,
  /drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^#]*&)?id=([\w-]{10,})/i,
  /docs\.google\.com\/uc\?(?:[^#]*&)?id=([\w-]{10,})/i,
  /lh3\.googleusercontent\.com\/d\/([\w-]{10,})/i,
];

/** Link directo de la imagen, listo para usar en <img src>. */
export function urlImagen(url: string | null | undefined, ancho = 800): string | null {
  const limpio = (url ?? '').trim();
  if (!limpio) return null;
  for (const patron of PATRONES_DRIVE) {
    const m = limpio.match(patron);
    if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w${ancho}`;
  }
  return limpio;
}
