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

function fecha(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
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

  return `
  <section class="rotulo">
    <img class="logo" src="${ROTULO_LOGO_BASE64}" alt="${esc(n.nombre_negocio)}" />

    <div class="contacto">
      <div class="contacto-datos">
        ${telefonos}
        ${n.redes ? `<div class="redes">${esc(n.redes)}</div>` : ''}
      </div>
      <div class="fecha">
        <span>Fecha</span>
        <strong>${fecha(p.created_at)}</strong>
      </div>
    </div>

    <div class="cobro">
      <div>
        <span class="cobro-label">Valor a cobrar</span>
        <span class="pedido">Pedido N.º ${esc(p.numero)}</span>
      </div>
      <strong class="cobro-valor">${moneda(p.total)}</strong>
    </div>

    <table class="datos">
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
    width: 340px;
    margin: 0 auto 24px;
    padding: 14px 18px 16px;
    border: 2px solid #000;
    border-radius: 14px;
    page-break-after: always;
    break-after: page;
  }
  .rotulo:last-child { page-break-after: auto; break-after: auto; }

  /* El logo manda: grande y centrado, sin alterar su diseño */
  .logo {
    display: block;
    width: 210px;
    height: 210px;
    margin: 0 auto 8px;
    object-fit: contain;
  }

  .contacto {
    display: flex;
    justify-content: space-between;
    align-items: stretch;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    font-size: 12px;
    line-height: 1.35;
  }
  .contacto-datos { font-weight: bold; }
  .redes { font-weight: normal; margin-top: 2px; }
  .fecha {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-end;
    text-align: right;
  }
  .fecha span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
  .fecha strong { font-size: 14px; }

  .cobro {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin: 10px 0;
    padding: 8px 12px;
    border: 2px solid #000;
    border-radius: 8px;
  }
  .cobro-label {
    display: block;
    font-size: 11px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .pedido { display: block; font-size: 12px; margin-top: 2px; }
  .cobro-valor { font-size: 22px; white-space: nowrap; }

  .datos { width: 100%; border-collapse: collapse; font-size: 13px; }
  .datos th, .datos td { padding: 3px 0; vertical-align: top; text-align: left; }
  .datos th { width: 88px; font-weight: bold; }
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
export function documentoRotulos(rotulos: string[], titulo = 'Rótulos'): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${esc(titulo)}</title>
    <style>${ROTULO_CSS}</style>
  </head>
  <body>${rotulos.join('')}</body>
</html>`;
}
