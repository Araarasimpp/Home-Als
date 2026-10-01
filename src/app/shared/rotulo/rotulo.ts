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
  const productos = p.productos.length
    ? p.productos.map((x) => esc(x)).join('<br>')
    : '—';
  const fila = (etiqueta: string, valor: string | null | undefined, clase = '') =>
    `<tr${clase ? ` class="${clase}"` : ''}><th>${etiqueta}</th><td>${valor ? valor : '—'}</td></tr>`;

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

    <table class="datos">
      ${fila('Pedido', '#' + esc(p.numero), 'pedido')}
      ${fila('Nombre', esc(p.cliente_nombre), 'destacado')}
      ${fila('Dirección', esc(p.direccion), 'destacado')}
      ${fila('Barrio', esc(p.barrio))}
      ${fila('Celular', esc(p.cliente_telefono))}
      ${fila('Producto', productos)}
      ${fila('Observación', esc(p.observaciones))}
    </table>

    ${n.texto_garantia ? `<p class="garantia">${esc(n.texto_garantia)}</p>` : ''}
  </section>`;
}

export const ROTULO_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px 0;
    font-family: Arial, Helvetica, sans-serif;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .rotulo {
    width: 400px;
    margin: 0 auto 24px;
    padding: 14px 18px 16px;
    border: 2px solid #000;
    border-radius: 14px;
    page-break-after: always;
    break-after: page;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .rotulo:last-child { page-break-after: auto; break-after: auto; }

  /* Cabecera: el logo manda a la izquierda, contacto a la derecha */
  .cabecera {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid #000;
  }
  .logo {
    flex: 0 0 auto;
    width: 172px;
    height: 172px;
    object-fit: contain;
  }
  .contacto {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    text-align: right;
    font-size: 12px;
    line-height: 1.35;
  }
  .etiqueta {
    display: block;
    margin-bottom: 3px;
    font-size: 10px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .fecha-cajas { display: flex; gap: 4px; justify-content: flex-end; }
  .fecha-cajas span {
    min-width: 30px;
    padding: 3px 4px;
    border: 1px solid #000;
    border-radius: 3px;
    font-size: 13px;
    font-weight: bold;
    text-align: center;
  }
  .fecha-cajas .anio { min-width: 46px; }
  .telefonos { font-weight: bold; font-size: 13px; }
  .redes { font-size: 12px; }

  .cobro {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin: 12px 0 10px;
  }
  .cobro-label {
    font-size: 15px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .cobro-valor {
    padding: 6px 14px;
    border: 2px solid #000;
    border-radius: 6px;
    font-size: 22px;
    white-space: nowrap;
  }

  .datos { width: 100%; border-collapse: collapse; font-size: 13px; }
  .datos th, .datos td { padding: 3px 0; vertical-align: top; text-align: left; }
  .datos th { width: 92px; font-weight: bold; }
  .datos tr.pedido td { font-weight: bold; }
  .datos tr.destacado td { font-size: 15px; font-weight: bold; }

  .garantia {
    margin: 12px 0 0;
    padding-top: 8px;
    border-top: 1px dashed #000;
    font-size: 10px;
    line-height: 1.4;
    text-align: center;
  }

  @media print {
    body { padding: 0; }
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
  body { padding: 12px 0; }
  .rotulo { margin-bottom: 0; }
  @media (max-width: 430px) { body { zoom: 0.9; } }
  @media (max-width: 390px) { body { zoom: 0.82; } }
  @media (max-width: 350px) { body { zoom: 0.74; } }
`;
