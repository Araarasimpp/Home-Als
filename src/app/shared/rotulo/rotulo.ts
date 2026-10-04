// src/app/shared/rotulo/rotulo.ts
// Todo lo del rótulo de entrega en un solo lugar: lo usan la página de
// pedidos (para imprimir) y Configuración (para la vista previa en vivo).
import { SupabaseClient } from '@supabase/supabase-js';
import { ROTULO_LOGO_BASE64 } from '../../admin/rotulo-logo';

export interface DatosNegocio {
  nombre_negocio: string;
  telefonos: string | null;
  redes: string | null;
  texto_garantia: string | null;
}

export interface PedidoRotulo {
  numero: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  direccion: string;
  barrio: string | null;
  observaciones: string | null;
  total: number;
  created_at: string;
  /** Líneas ya armadas, ej. "Termo 1 L x2" */
  productos: string[];
}

/** Se usan solo si la tabla configuracion está vacía o no se puede leer. */
export const NEGOCIO_POR_DEFECTO: DatosNegocio = {
  nombre_negocio: 'Home ALS',
  telefonos: '318 8156960 - 310 7425663',
  redes: '@variedadesjyb',
  texto_garantia:
    'Todos nuestros productos cuentan con garantía. Guarda este documento ya que es el soporte para la garantía.',
};

/** Lee los datos del negocio desde Configuración (tabla configuracion, fila id = true). */
export async function cargarDatosNegocio(client: SupabaseClient): Promise<DatosNegocio> {
  const { data, error } = await client
    .from('configuracion')
    .select('nombre_negocio, telefonos, redes, texto_garantia')
    .eq('id', true)
    .single();

  if (error || !data) return NEGOCIO_POR_DEFECTO;

  return {
    nombre_negocio: data.nombre_negocio?.trim() || NEGOCIO_POR_DEFECTO.nombre_negocio,
    telefonos: data.telefonos?.trim() || null,
    redes: data.redes?.trim() || null,
    texto_garantia: data.texto_garantia?.trim() || null,
  };
}

function esc(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function moneda(valor: number): string {
  return Number(valor || 0).toLocaleString('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });
}

/** "318 8156960 - 310 7425663" → una línea por número. */
function lineasTelefono(telefonos: string | null): string[] {
  return (telefonos ?? '')
    .split(/\s*[-,/|]\s*(?=\d)|\n/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Un rótulo. Todo el texto que viene de la base de datos se escapa. */
export function rotuloHtml(p: PedidoRotulo, n: DatosNegocio): string {
  const telefonos = lineasTelefono(n.telefonos)
    .map((t) => `<div>${esc(t)}</div>`)
    .join('');
  // En una etiqueta de 100 × 100 mm caben unas 3 líneas de productos
  const MAX_PRODUCTOS = 3;
  const lineasProd =
    p.productos.length > MAX_PRODUCTOS
      ? [...p.productos.slice(0, MAX_PRODUCTOS - 1).map((x) => esc(x)), `y ${p.productos.length - (MAX_PRODUCTOS - 1)} productos más`]
      : p.productos.map((x) => esc(x));
  const productos = lineasProd.length ? lineasProd.join('<br>') : '—';
  // El valor va dentro de un div para poder recortarlo a 2 líneas si es muy largo
  const fila = (etiqueta: string, valor: string | null | undefined, clase = '') =>
    `<tr${clase ? ` class="${clase}"` : ''}><th>${etiqueta}</th><td><div class="v">${valor ? valor : '—'}</div></td></tr>`;

  const d = new Date(p.created_at);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');

  return `
  <section class="rotulo">
    <header class="cabecera">
      <img class="logo" src="${ROTULO_LOGO_BASE64}" alt="${esc(n.nombre_negocio)}" />

      <div class="contacto">
        <div class="fecha">
          <span class="etiqueta">Fecha</span>
          <div class="fecha-cajas">
            <span>${dia}</span><span>${mes}</span><span class="anio">${d.getFullYear()}</span>
          </div>
        </div>
        ${telefonos ? `<div class="telefonos">${telefonos}</div>` : ''}
        ${n.redes ? `<div class="redes">${esc(n.redes)}</div>` : ''}
      </div>
    </header>

    <div class="cobro">
      <span class="cobro-label">Valor a cobrar</span>
      <strong class="cobro-valor">${moneda(p.total)}</strong>
    </div>

    <div class="cuerpo">
    <table class="datos">
      ${fila('Pedido', '#' + esc(p.numero), 'pedido')}
      ${fila('Nombre', esc(p.cliente_nombre), 'destacado')}
      ${fila('Dirección', esc(p.direccion), 'destacado')}
      ${fila('Barrio', esc(p.barrio))}
      ${fila('Celular', esc(p.cliente_telefono))}
      ${fila('Producto', productos, 'productos')}
      ${fila('Observación', esc(p.observaciones))}
    </table>
    </div>

    ${n.texto_garantia ? `<p class="garantia">${esc(n.texto_garantia)}</p>` : ''}
  </section>`;
}

// Etiqueta adhesiva en rollo de 100 × 100 mm: una etiqueta por página.
// El código no define márgenes: los pone el navegador (diálogo de impresión).
// El rótulo ocupa todo el espacio que quede dentro de esos márgenes, así nunca
// se pasa a una segunda etiqueta. Medidas en mm/pt para que el papel salga igual
// sin importar la pantalla.
export const ROTULO_CSS = `
  @page { size: 100mm 100mm; }
  * { box-sizing: border-box; }
  /* Solo quita el espacio que el navegador pone por defecto dentro de la página */
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .rotulo {
    width: 100%;
    /* En impresión, 100vh es el alto disponible de la página (ya sin márgenes) */
    height: 100vh;
    padding: 2.5mm 3mm 2mm;
    border: 0.3mm solid #000;
    border-radius: 3mm;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    page-break-after: always;
    break-after: page;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .rotulo:last-child { page-break-after: auto; break-after: auto; }

  /* Cabecera: logo a la izquierda, fecha y contacto a la derecha */
  .cabecera {
    display: flex;
    align-items: center;
    gap: 3mm;
    padding-bottom: 1.5mm;
    border-bottom: 0.3mm solid #000;
  }
  .logo { flex: 0 0 auto; width: 34mm; height: 34mm; object-fit: contain; }
  .contacto {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.9mm;
    text-align: right;
    font-size: 8.5pt;
    line-height: 1.25;
  }
  .etiqueta {
    display: block;
    margin-bottom: 0.6mm;
    font-size: 6.5pt;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .fecha-cajas { display: flex; gap: 1mm; justify-content: flex-end; }
  .fecha-cajas span {
    min-width: 7mm;
    padding: 0.5mm 1mm;
    border: 0.25mm solid #000;
    border-radius: 0.6mm;
    font-size: 9pt;
    font-weight: bold;
    text-align: center;
  }
  .fecha-cajas .anio { min-width: 11mm; }
  .telefonos { font-size: 9pt; font-weight: bold; }
  .redes { font-size: 8.5pt; }

  .cobro {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 2mm;
    margin: 1.6mm 0 1.2mm;
  }
  .cobro-label { font-size: 10pt; font-weight: bold; text-transform: uppercase; }
  .cobro-valor {
    padding: 0.8mm 3mm;
    border: 0.5mm solid #000;
    border-radius: 1.2mm;
    font-size: 14pt;
    white-space: nowrap;
  }

  /* Los datos ocupan el espacio libre; si algo no cabe se recorta aquí y la
     garantía de abajo siempre se ve completa */
  .cuerpo { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .datos { width: 100%; border-collapse: collapse; font-size: 8.5pt; line-height: 1.14; }
  .datos th, .datos td { padding: 0.3mm 0; vertical-align: top; text-align: left; }
  .datos th { width: 21mm; font-weight: bold; }
  .datos td { overflow-wrap: anywhere; }
  .datos tr.destacado td { font-size: 10pt; font-weight: bold; }
  /* Textos largos: máximo 2 líneas (productos: 3) para no salirse de la etiqueta */
  .datos .v { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  .datos tr.productos .v { -webkit-line-clamp: 3; }

  .garantia {
    flex: 0 0 auto;
    margin: 1mm 0 0;
    padding-top: 1.2mm;
    border-top: 0.25mm dashed #000;
    font-size: 6.5pt;
    line-height: 1.25;
    text-align: center;
  }

  /* Solo en pantalla (vista previa): fondo y borde de referencia del tamaño
     real. Nada de esto se imprime. */
  @media screen {
    body { background: #f4f5f7; padding: 16px 0; }
    .rotulo { width: 100mm; height: 100mm; margin: 0 auto 16px; background: #fff; }
  }
`;

/** Documento completo listo para imprimir (uno o varios rótulos). */
export function documentoRotulos(rotulos: string[], titulo = 'Rótulos', cssExtra = ''): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${esc(titulo)}</title>
    <style>${ROTULO_CSS}${cssExtra}</style>
  </head>
  <body>${rotulos.join('')}</body>
</html>`;
}

/**
 * Para la vista previa dentro de un iframe angosto: reduce el rótulo para que
 * quepa completo (las media queries se miden contra el ancho del iframe).
 * La impresión real no usa esto.
 */
export const ROTULO_CSS_VISTA_PREVIA = `
  @media screen {
    body { padding: 12px 0; }
    .rotulo { margin-bottom: 0; }
  }
  @media (max-width: 400px) { body { zoom: 0.9; } }
  @media (max-width: 360px) { body { zoom: 0.82; } }
  @media (max-width: 330px) { body { zoom: 0.74; } }
`;

/**
 * Escribe el documento en una ventana ya abierta, abre el diálogo de
 * impresión y cierra la ventana sola cuando termina (al imprimir o cancelar).
 *
 * La ventana debe abrirse con window.open() en el mismo clic del usuario,
 * antes de cualquier await: si se abre después, el navegador la bloquea.
 */
export function imprimirEnVentana(ventana: Window, html: string): void {
  ventana.document.open();
  ventana.document.write(html);
  ventana.document.close();
  ventana.focus();

  // Los eventos se registran DESPUÉS de document.write: document.open() borra
  // los que hubiera en la ventana.
  let cerrada = false;
  const cerrar = () => {
    if (cerrada) return;
    cerrada = true;
    // Pequeña espera para que el navegador termine de mandar el trabajo a la impresora
    setTimeout(() => {
      try {
        ventana.close();
      } catch {
        /* si el navegador no deja cerrarla, se queda abierta sin problema */
      }
    }, 300);
  };
  ventana.addEventListener('afterprint', cerrar);

  // Imprime cuando cargue el logo; el temporizador es por si "load" ya pasó.
  // La bandera evita abrir el diálogo dos veces.
  let yaImpreso = false;
  const imprimir = () => {
    if (yaImpreso) return;
    yaImpreso = true;
    ventana.print();
  };
  ventana.addEventListener('load', imprimir);
  setTimeout(imprimir, 800);
}
