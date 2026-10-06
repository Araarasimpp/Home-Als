// src/app/admin/reportes/excel-ventas.ts
// Excel de ventas con el mismo formato de la planilla que usa la tienda:
// una fila por pedido, colores por mensajero y totales de comisión al final.
//
//  - Vendedores por porcentaje: FECHA, CANT, PRODUCTO, COSTO, VENTA, GANANCIA,
//    DOMICILIOS, TOTAL, MENSAJERO, VENDEDOR + "Comisión vendedor / Comisión ALS".
//  - Vendedores por margen: además PRECIO BASE, GANANCIA TIENDA y COMISIÓN
//    VENDEDOR (lo que cobró por encima del precio base).
//
// Una hoja por vendedor (y por esquema, si se le cambió en el periodo) y una
// hoja "Resumen" cuando hay más de una. Necesita: npm install exceljs
import type { Borders, Cell, Fill, Worksheet } from 'exceljs';
import { SupabaseClient } from '@supabase/supabase-js';
import { finDiaColombia, inicioDiaColombia } from '../../shared/fecha-colombia';

export interface OpcionesExcel {
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD
  vendedorId: string; // 'todos' o el id
  estado: string; // 'todos' o un estado
}

interface FilaPedido {
  fecha: string;
  cantidad: number;
  productos: string;
  costo: number;
  base: number;
  venta: number;
  ganancia: number;
  comision: number;
  domicilio: number;
  total: number;
  mensajero: string;
  mensajeroId: string; // para el color
  vendedor: string;
  sinCosto: boolean;
}

interface Grupo {
  vendedor: string;
  porcentaje: number | null; // null = margen
  filas: FilaPedido[];
}

// ---------- Estilo (colores tomados de la planilla de la tienda) ----------
const ROSA_ENCABEZADO = 'FFF4C7F4';
const ROSA_GANANCIA = 'FFFAD4FA';
const AZUL_LOCAL = 'FFBDD7EE';
const AZUL_COMISION = 'FFDDEBF7';
const PALETA_MENSAJEROS = [
  'FFA9D08E', 'FF9BC2E6', 'FFC9C2F2', 'FFFFD966', 'FFF8CBAD',
  'FF8FD6C1', 'FFB4A7D6', 'FFF4B183', 'FFC6E0B4', 'FFE2B5E8',
];
const BORDE: Partial<Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};
const PESOS = '#,##0';

const relleno = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** "SABADO 19" en hora de Colombia, como en la planilla. */
function fechaPlanilla(iso: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' });
  const num = d.toLocaleDateString('es-CO', { day: 'numeric', timeZone: 'America/Bogota' });
  return `${sinTildes(dia).toUpperCase()} ${num}`;
}

/** Nombre de hoja válido para Excel: máx. 31 caracteres y sin : \ / ? * [ ] */
function nombreHoja(base: string, usados: Set<string>): string {
  let nombre = base.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Hoja';
  let n = 2;
  while (usados.has(nombre.toLowerCase())) {
    const sufijo = ` (${n++})`;
    nombre = nombre.slice(0, 31 - sufijo.length) + sufijo;
  }
  usados.add(nombre.toLowerCase());
  return nombre;
}

// ---------- Datos ----------
async function cargarGrupos(db: SupabaseClient, o: OpcionesExcel): Promise<Grupo[]> {
  let q = db
    .from('pedidos')
    .select('*')
    .gte('created_at', inicioDiaColombia(o.desde).toISOString())
    .lte('created_at', finDiaColombia(o.hasta).toISOString())
    .order('created_at', { ascending: true });
  if (o.vendedorId !== 'todos') q = q.eq('vendedor_id', o.vendedorId);
  // Los cancelados nunca cuentan como venta
  q = o.estado !== 'todos' ? q.eq('estado', o.estado) : q.neq('estado', 'cancelado');

  const [{ data: pedidos, error }, { data: perfiles }] = await Promise.all([
    q,
    db.from('profiles').select('id, nombre'),
  ]);
  if (error) throw error;
  if (!pedidos?.length) return [];

  const { data: items, error: errItems } = await db
    .from('pedido_items')
    .select('pedido_id, cantidad, precio_unitario, precio_base, producto:productos(nombre, costo)')
    .in('pedido_id', pedidos.map((p: any) => p.id));
  if (errItems) throw errItems;

  const nombre = new Map<string, string>((perfiles ?? []).map((p: any) => [p.id, p.nombre]));
  const grupos = new Map<string, Grupo>();

  for (const p of pedidos as any[]) {
    const propios = (items ?? []).filter((i: any) => i.pedido_id === p.id) as any[];
    let cantidad = 0, costo = 0, base = 0, venta = 0, sinCosto = false;
    for (const i of propios) {
      const q = Number(i.cantidad);
      const pb = Number(i.precio_base);
      const c = i.producto?.costo;
      if (c == null) sinCosto = true;
      cantidad += q;
      costo += q * (c != null ? Number(c) : pb);
      base += q * pb;
      venta += q * Number(i.precio_unitario);
    }

    const domicilio = Number(p.valor_domicilio || 0);
    const esLocal = p.canal === 'local' || (!p.domiciliario_id && domicilio === 0);
    let mensajero: string;
    if (esLocal) {
      mensajero = 'LOCAL';
      if (p.metodo_pago === 'transferencia') mensajero += ' TRANSFERENCIA';
      else if (p.metodo_pago === 'mixto') mensajero += ` MIXTO (EF ${Math.round(Number(p.monto_efectivo || 0) / 1000)} MIL)`;
    } else if (p.domiciliario_id) {
      mensajero = (nombre.get(p.domiciliario_id) ?? 'DOMICILIARIO').toUpperCase();
      if (p.metodo_pago === 'transferencia') mensajero += ' TRANSFERENCIA';
      else if (p.metodo_pago === 'mixto') mensajero += ` MIXTO (EF ${Math.round(Number(p.monto_efectivo || 0) / 1000)} MIL)`;
    } else {
      mensajero = 'SIN ASIGNAR';
    }

    const porcentaje = p.comision_tipo === 'porcentaje' ? Number(p.comision_porcentaje ?? 50) : null;
    const vendedor = (nombre.get(p.vendedor_id) ?? 'Vendedor').toUpperCase();
    const llave = `${p.vendedor_id}|${porcentaje ?? 'margen'}`;
    if (!grupos.has(llave)) grupos.set(llave, { vendedor, porcentaje, filas: [] });

    grupos.get(llave)!.filas.push({
      fecha: fechaPlanilla(p.created_at),
      cantidad,
      productos: propios.map((i) => String(i.producto?.nombre ?? 'Producto').toUpperCase()).join(', '),
      costo,
      base,
      venta,
      ganancia: venta - costo,
      comision: Number(p.comision || 0),
      domicilio,
      total: Number(p.total || 0),
      mensajero,
      mensajeroId: esLocal ? 'local' : p.domiciliario_id ?? 'sin',
      vendedor,
      sinCosto,
    });
  }

  return [...grupos.values()].sort((a, b) => a.vendedor.localeCompare(b.vendedor));
}

// ---------- Hojas ----------
function estilarCelda(c: Cell, opciones: { fill?: string; bold?: boolean; num?: boolean; izquierda?: boolean } = {}) {
  c.border = BORDE;
  c.font = { name: 'Calibri', size: 10, bold: !!opciones.bold };
  c.alignment = { vertical: 'middle', horizontal: opciones.izquierda ? 'left' : 'center', wrapText: false };
  if (opciones.num) c.numFmt = PESOS;
  if (opciones.fill) c.fill = relleno(opciones.fill);
}

function colorMensajero(id: string, colores: Map<string, string>): string {
  if (id === 'local') return AZUL_LOCAL;
  if (!colores.has(id)) colores.set(id, PALETA_MENSAJEROS[colores.size % PALETA_MENSAJEROS.length]);
  return colores.get(id)!;
}

function hojaVendedor(ws: Worksheet, g: Grupo, colores: Map<string, string>): void {
  const pct = g.porcentaje;
  const esPct = pct !== null;

  // Columnas (las de margen agregan precio base y la comisión real del vendedor)
  const cols = esPct
    ? [
        { k: 'fecha', t: 'FECHA', w: 14 },
        { k: 'cantidad', t: 'CANT', w: 7 },
        { k: 'productos', t: 'PRODUCTO', w: 46 },
        { k: 'costo', t: 'COSTO', w: 12, num: true },
        { k: 'venta', t: 'VENTA', w: 12, num: true },
        { k: 'ganancia', t: 'GANANCIA', w: 12, num: true },
        { k: 'domicilio', t: 'DOMICILIOS', w: 12, num: true },
        { k: 'total', t: 'TOTAL', w: 12, num: true },
        { k: 'mensajero', t: 'MENSAJERO', w: 28 },
        { k: 'vendedor', t: 'VENDEDOR', w: 20 },
      ]
    : [
        { k: 'fecha', t: 'FECHA', w: 14 },
        { k: 'cantidad', t: 'CANT', w: 7 },
        { k: 'productos', t: 'PRODUCTO', w: 42 },
        { k: 'costo', t: 'COSTO', w: 12, num: true },
        { k: 'base', t: 'PRECIO BASE', w: 13, num: true },
        { k: 'venta', t: 'VENTA', w: 12, num: true },
        { k: 'gananciaTienda', t: 'GANANCIA TIENDA', w: 16, num: true },
        { k: 'comision', t: 'COMISIÓN VENDEDOR', w: 18, num: true },
        { k: 'domicilio', t: 'DOMICILIOS', w: 12, num: true },
        { k: 'total', t: 'TOTAL', w: 12, num: true },
        { k: 'mensajero', t: 'MENSAJERO', w: 28 },
        { k: 'vendedor', t: 'VENDEDOR', w: 20 },
      ];

  ws.columns = cols.map((c) => ({ key: c.k, width: c.w }));
  const letra = (k: string) => ws.getColumn(k).letter;
  const colGanancia = esPct ? 'ganancia' : 'gananciaTienda';

  // Encabezado
  const enc = ws.getRow(1);
  cols.forEach((c, i) => {
    const cel = enc.getCell(i + 1);
    cel.value = c.t;
    estilarCelda(cel, { fill: ROSA_ENCABEZADO, bold: true });
  });
  enc.height = 18;

  // Filas
  g.filas.forEach((f, idx) => {
    const r = ws.getRow(idx + 2);
    const valores: Record<string, string | number | null> = {
      fecha: f.fecha,
      cantidad: f.cantidad,
      productos: f.productos,
      costo: f.costo,
      base: f.base,
      venta: f.venta,
      ganancia: f.ganancia,
      gananciaTienda: f.base - f.costo,
      comision: f.comision,
      domicilio: f.domicilio || null,
      total: f.total,
      mensajero: f.mensajero,
      vendedor: f.vendedor,
    };
    const colorM = colorMensajero(f.mensajeroId, colores);
    cols.forEach((c, i) => {
      const cel = r.getCell(i + 1);
      cel.value = valores[c.k] ?? null;
      estilarCelda(cel, {
        num: c.num,
        izquierda: c.k === 'productos',
        fill: c.k === colGanancia ? ROSA_GANANCIA : c.k === 'total' || c.k === 'mensajero' ? colorM : undefined,
      });
    });
    if (f.sinCosto) {
      r.getCell(letra('costo')).note = 'Algún producto no tiene costo registrado: se usó su precio base.';
    }
  });

  // Totales
  const ultima = g.filas.length + 1;
  const filaTotal = ultima + 1;
  const rt = ws.getRow(filaTotal);
  rt.height = 30;
  const colG = letra(colGanancia);
  const indiceG = ws.getColumn(colGanancia).number;

  ws.mergeCells(filaTotal, 1, filaTotal, indiceG - 1);
  const etiqueta = rt.getCell(1);
  etiqueta.value = 'TOTAL';
  for (let i = 1; i < indiceG; i++) estilarCelda(rt.getCell(i), { fill: ROSA_ENCABEZADO, bold: true });

  const totalG = rt.getCell(indiceG);
  totalG.value = { formula: `SUM(${colG}2:${colG}${ultima})`, result: g.filas.reduce((s, f) => s + (esPct ? f.ganancia : f.base - f.costo), 0) };
  estilarCelda(totalG, { fill: ROSA_ENCABEZADO, bold: true, num: true });
  totalG.font = { name: 'Calibri', size: 12, bold: true };
  totalG.border = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } };

  if (!esPct) {
    const colC = letra('comision');
    const totalC = rt.getCell(ws.getColumn('comision').number);
    totalC.value = { formula: `SUM(${colC}2:${colC}${ultima})`, result: g.filas.reduce((s, f) => s + f.comision, 0) };
    estilarCelda(totalC, { fill: ROSA_ENCABEZADO, bold: true, num: true });
  }

  // Cajas de comisión, alineadas con MENSAJERO y VENDEDOR como en la planilla
  const cM = ws.getColumn('mensajero').number;
  const cV = ws.getColumn('vendedor').number;
  const nombreCorto = g.vendedor.split(' ')[0];
  const cajas = esPct
    ? [
        { col: cM, titulo: `COMISIÓN ${nombreCorto}\n${pct}%`, formula: `ROUND(${colG}${filaTotal}*${pct}/100,0)` },
        { col: cV, titulo: `COMISIÓN ALS\n${100 - pct!}%`, formula: `${colG}${filaTotal}-${ws.getColumn('mensajero').letter}${filaTotal + 1}` },
      ]
    : [
        { col: cM, titulo: `COMISIÓN ${nombreCorto}`, formula: `${letra('comision')}${filaTotal}` },
        { col: cV, titulo: 'GANANCIA ALS', formula: `${colG}${filaTotal}` },
      ];
  const totalBase = g.filas.reduce((s, f) => s + (esPct ? f.ganancia : f.base - f.costo), 0);
  const resultados = esPct
    ? [Math.round((totalBase * pct!) / 100), totalBase - Math.round((totalBase * pct!) / 100)]
    : [g.filas.reduce((s, f) => s + f.comision, 0), totalBase];

  cajas.forEach((caja, i) => {
    const t = rt.getCell(caja.col);
    t.value = caja.titulo;
    estilarCelda(t, { bold: true });
    t.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    t.border = { top: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' }, bottom: { style: 'thin' } };

    const v = ws.getRow(filaTotal + 1).getCell(caja.col);
    v.value = { formula: caja.formula, result: resultados[i] };
    estilarCelda(v, { fill: AZUL_COMISION, bold: true, num: true });
    v.border = { left: { style: 'medium' }, right: { style: 'medium' }, bottom: { style: 'medium' }, top: { style: 'thin' } };
  });

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ultima, column: cols.length } };
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

function hojaResumen(ws: Worksheet, grupos: Grupo[]): void {
  const enc = ['VENDEDOR', 'TIPO DE COMISIÓN', 'PEDIDOS', 'VENTA', 'GANANCIA TOTAL', 'COMISIÓN VENDEDOR', 'GANANCIA ALS'];
  ws.columns = [24, 22, 10, 14, 16, 18, 16].map((w) => ({ width: w }));
  enc.forEach((t, i) => {
    const c = ws.getRow(1).getCell(i + 1);
    c.value = t;
    estilarCelda(c, { fill: ROSA_ENCABEZADO, bold: true });
  });

  grupos.forEach((g, idx) => {
    const venta = g.filas.reduce((s, f) => s + f.venta, 0);
    const ganancia = g.filas.reduce((s, f) => s + f.ganancia, 0);
    const comision =
      g.porcentaje !== null
        ? Math.round((ganancia * g.porcentaje) / 100)
        : g.filas.reduce((s, f) => s + f.comision, 0);
    const fila = [
      g.vendedor,
      g.porcentaje !== null ? `${g.porcentaje}% de la ganancia` : 'Margen sobre precio base',
      g.filas.length,
      venta,
      ganancia,
      comision,
      ganancia - comision,
    ];
    fila.forEach((v, i) => {
      const c = ws.getRow(idx + 2).getCell(i + 1);
      c.value = v;
      estilarCelda(c, { num: i >= 3, izquierda: i <= 1, fill: i === 4 ? ROSA_GANANCIA : undefined });
    });
  });

  const n = grupos.length + 1;
  const rt = ws.getRow(n + 1);
  rt.getCell(1).value = 'TOTAL';
  for (let i = 1; i <= 7; i++) estilarCelda(rt.getCell(i), { fill: ROSA_ENCABEZADO, bold: true, num: i >= 3 });
  ['C', 'D', 'E', 'F', 'G'].forEach((col, i) => {
    // Se guarda también el resultado para que se vea aunque el programa no recalcule
    let suma = 0;
    for (let r = 2; r <= n; r++) suma += Number(ws.getRow(r).getCell(i + 3).value) || 0;
    rt.getCell(i + 3).value = { formula: `SUM(${col}2:${col}${n})`, result: suma };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ---------- Punto de entrada ----------
/** Genera y descarga el Excel. Devuelve cuántos pedidos incluyó. */
export async function descargarExcelVentas(db: SupabaseClient, o: OpcionesExcel): Promise<number> {
  const grupos = await cargarGrupos(db, o);
  if (!grupos.length) return 0;

  // exceljs pesa ~1 MB: se carga solo al descargar, no al abrir la app
  const ExcelJS = (await import('exceljs')).default;
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Home ALS';
  libro.created = new Date();
  // Excel recalcula todas las fórmulas al abrir (por si alguien edita filas)
  libro.calcProperties.fullCalcOnLoad = true;

  const usados = new Set<string>();
  if (grupos.length > 1) hojaResumen(libro.addWorksheet(nombreHoja('Resumen', usados)), grupos);

  const colores = new Map<string, string>(); // mismo color por mensajero en todas las hojas
  for (const g of grupos) {
    const titulo = g.porcentaje !== null ? `${g.vendedor} ${g.porcentaje}%` : g.vendedor;
    hojaVendedor(libro.addWorksheet(nombreHoja(titulo, usados)), g, colores);
  }

  const buffer = await libro.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ventas_${o.desde}_a_${o.hasta}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return grupos.reduce((s, g) => s + g.filas.length, 0);
}
