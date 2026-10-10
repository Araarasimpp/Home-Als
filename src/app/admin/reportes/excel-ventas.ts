// src/app/admin/reportes/excel-ventas.ts
// Excel de ventas con el mismo formato de la planilla que usa la tienda:
// una fila por pedido, colores por mensajero y totales de comisión al final.
//
//  - Vendedores por porcentaje: FECHA, CANT, PRODUCTO, COSTO, VENTA, GANANCIA,
//    DOMICILIOS, TOTAL, MENSAJERO, VENDEDOR + "Comisión vendedor / Comisión ALS".
//  - Vendedores por margen: además PRECIO BASE, GANANCIA TIENDA y COMISIÓN
//    VENDEDOR (lo que cobró por encima del precio base).
//  - Columna ESTADO al final: la ganancia y las comisiones de abajo solo
//    suman los pedidos ENTREGADOS (los demás se listan tachados, sin sumar).
//
// Una hoja por vendedor (y por esquema, si se le cambió en el periodo) y una
// hoja "Resumen" cuando hay más de una. Necesita: npm install exceljs
//
// Con "Todos los vendedores" se arma en cambio la planilla "VENTA DIARIA": una
// hoja por día con todos los pedidos agrupados por vendedor (CANT, PRODUCTO,
// COSTO, VENTA, GANANCIA TIENDA, GANANCIA VENDEDOR, DOMICILIO, TOTAL RECOGIDA,
// MENSAJERO, VENDEDOR, ESTADO) y una hoja "Resumen" por día cuando hay varios
// días. Ahí se listan todos los pedidos, pero los totales solo suman los
// ENTREGADOS; los demás (pendientes, en ruta, cancelados) se ven tachados.
import type { Borders, Cell, Fill, Worksheet } from 'exceljs';
import { SupabaseClient } from '@supabase/supabase-js';
import { diaColombiaDe, finDiaColombia, inicioDiaColombia } from '../../shared/fecha-colombia';

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
  vendedorId: string;
  /** Día de la venta en Colombia (YYYY-MM-DD) y hora exacta, para ordenar. */
  dia: string;
  creado: string;
  estado: string;
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
async function cargarGrupos(db: SupabaseClient, o: OpcionesExcel, incluirCancelados = false): Promise<Grupo[]> {
  let q = db
    .from('pedidos')
    .select('*')
    .gte('created_at', inicioDiaColombia(o.desde).toISOString())
    .lte('created_at', finDiaColombia(o.hasta).toISOString())
    .order('created_at', { ascending: true });
  if (o.vendedorId !== 'todos') q = q.eq('vendedor_id', o.vendedorId);
  // Los cancelados nunca cuentan como venta (en la planilla general se listan, sin sumar)
  if (o.estado !== 'todos') q = q.eq('estado', o.estado);
  else if (!incluirCancelados) q = q.neq('estado', 'cancelado');

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
      vendedorId: p.vendedor_id,
      dia: diaColombiaDe(p.created_at),
      creado: p.created_at,
      estado: p.estado,
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
        { k: 'estado', t: 'ESTADO', w: 13 },
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
        { k: 'estado', t: 'ESTADO', w: 13 },
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
      estado: ETIQUETA_ESTADO[f.estado] ?? f.estado.toUpperCase(),
    };
    const colorM = colorMensajero(f.mensajeroId, colores);
    cols.forEach((c, i) => {
      const cel = r.getCell(i + 1);
      cel.value = valores[c.k] ?? null;
      estilarCelda(cel, {
        num: c.num,
        izquierda: c.k === 'productos',
        fill: c.k === colGanancia ? ROSA_GANANCIA : c.k === 'total' || c.k === 'mensajero' ? colorM : c.k === 'estado' ? COLOR_ESTADO[f.estado] : undefined,
      });
      if (c.k === 'estado') cel.font = { name: 'Calibri', size: 10, bold: true };
      else if (f.estado !== 'entregado') cel.font = { name: 'Calibri', size: 10, strike: true, color: { argb: 'FF8C8C8C' } };
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
  // Ganancia y comisión solo de pedidos entregados (pendientes y en ruta no suman)
  const rangoEstado = `${letra('estado')}2:${letra('estado')}${ultima}`;
  const sumaEntregados = (col: string) => `SUMIF(${rangoEstado},"ENTREGADO",${col}2:${col}${ultima})`;
  const entregadas = g.filas.filter((f) => f.estado === 'entregado');

  ws.mergeCells(filaTotal, 1, filaTotal, indiceG - 1);
  const etiqueta = rt.getCell(1);
  etiqueta.value = 'TOTAL';
  for (let i = 1; i < indiceG; i++) estilarCelda(rt.getCell(i), { fill: ROSA_ENCABEZADO, bold: true });

  const totalG = rt.getCell(indiceG);
  totalG.value = { formula: sumaEntregados(colG), result: entregadas.reduce((s, f) => s + (esPct ? f.ganancia : f.base - f.costo), 0) };
  estilarCelda(totalG, { fill: ROSA_ENCABEZADO, bold: true, num: true });
  totalG.font = { name: 'Calibri', size: 12, bold: true };
  totalG.border = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } };

  if (!esPct) {
    const colC = letra('comision');
    const totalC = rt.getCell(ws.getColumn('comision').number);
    totalC.value = { formula: sumaEntregados(colC), result: entregadas.reduce((s, f) => s + f.comision, 0) };
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
  const totalBase = entregadas.reduce((s, f) => s + (esPct ? f.ganancia : f.base - f.costo), 0);
  const resultados = esPct
    ? [Math.round((totalBase * pct!) / 100), totalBase - Math.round((totalBase * pct!) / 100)]
    : [entregadas.reduce((s, f) => s + f.comision, 0), totalBase];

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
  const enc = ['VENDEDOR', 'TIPO DE COMISIÓN', 'ENTREGADOS', 'VENTA', 'GANANCIA TOTAL', 'COMISIÓN VENDEDOR', 'GANANCIA ALS'];
  ws.columns = [24, 22, 10, 14, 16, 18, 16].map((w) => ({ width: w }));
  enc.forEach((t, i) => {
    const c = ws.getRow(1).getCell(i + 1);
    c.value = t;
    estilarCelda(c, { fill: ROSA_ENCABEZADO, bold: true });
  });

  grupos.forEach((g, idx) => {
    // Todo solo de pedidos entregados
    const ent = g.filas.filter((f) => f.estado === 'entregado');
    const venta = ent.reduce((s, f) => s + f.venta, 0);
    const ganancia = ent.reduce((s, f) => s + f.ganancia, 0);
    const comision =
      g.porcentaje !== null
        ? Math.round((ganancia * g.porcentaje) / 100)
        : ent.reduce((s, f) => s + f.comision, 0);
    const fila = [
      g.vendedor,
      g.porcentaje !== null ? `${g.porcentaje}% de la ganancia` : 'Margen sobre precio base',
      ent.length,
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

// ---------- Planilla general: VENTA DIARIA ----------
const COLS_DIARIA = [
  { k: 'cantidad', t: 'CANT', w: 7 },
  { k: 'productos', t: 'PRODUCTO', w: 46 },
  { k: 'costo', t: 'COSTO', w: 12, num: true },
  { k: 'venta', t: 'VENTA', w: 12, num: true },
  { k: 'gananciaTienda', t: 'GANANCIA TIENDA', w: 16, num: true },
  { k: 'gananciaVendedor', t: 'GANANCIA VENDEDOR', w: 18, num: true },
  { k: 'domicilio', t: 'DOMICILIO', w: 12, num: true },
  { k: 'total', t: 'TOTAL RECOGIDA', w: 16, num: true },
  { k: 'mensajero', t: 'MENSAJERO', w: 28 },
  { k: 'vendedor', t: 'VENDEDOR', w: 20 },
  { k: 'estado', t: 'ESTADO', w: 13 },
] as const;

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: 'PENDIENTE',
  en_ruta: 'EN RUTA',
  entregado: 'ENTREGADO',
  cancelado: 'CANCELADO',
};
const COLOR_ESTADO: Record<string, string> = {
  pendiente: 'FFEDEDED',
  en_ruta: 'FFFFE699',
  entregado: 'FFC6EFCE',
  cancelado: 'FFFFC7CE',
};
const vigente = (f: FilaPedido) => f.estado !== 'cancelado';
const entregado = (f: FilaPedido) => f.estado === 'entregado';

/** "JUEVES 8 DE OCTUBRE" a partir de YYYY-MM-DD (día de Colombia). */
function tituloDia(dia: string): string {
  const d = inicioDiaColombia(dia);
  const t = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });
  return sinTildes(t).replace(',', '').toUpperCase();
}

/** Nombre corto de hoja: "JUE 8 OCT". */
function hojaDiaNombre(dia: string): string {
  const d = inicioDiaColombia(dia);
  const t = d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Bogota' });
  return sinTildes(t).replace(/[.,]/g, '').toUpperCase();
}

const gananciaVendedorDe = (f: FilaPedido) => f.comision;
const gananciaTiendaDe = (f: FilaPedido) => f.venta - f.costo - f.comision;

function hojaDiaria(ws: Worksheet, dia: string, filas: FilaPedido[], colores: Map<string, string>): void {
  const n = COLS_DIARIA.length;
  ws.columns = COLS_DIARIA.map((c) => ({ key: c.k, width: c.w }));
  const letra = (k: string) => ws.getColumn(k).letter;
  const col = (k: string) => ws.getColumn(k).number;

  // Título: VENTA DIARIA + día
  ws.mergeCells(1, 1, 1, n);
  const titulo = ws.getRow(1).getCell(1);
  titulo.value = `VENTA DIARIA · ${tituloDia(dia)}`;
  estilarCelda(titulo, { fill: ROSA_ENCABEZADO, bold: true });
  titulo.font = { name: 'Calibri', size: 12, bold: true };
  ws.getRow(1).height = 20;

  const enc = ws.getRow(2);
  COLS_DIARIA.forEach((c, i) => {
    const cel = enc.getCell(i + 1);
    cel.value = c.t;
    estilarCelda(cel, { fill: ROSA_ENCABEZADO, bold: true });
  });
  enc.height = 18;

  // Agrupados por vendedor (como en la planilla) y por hora dentro de cada grupo
  const ordenadas = [...filas].sort(
    (a, b) => a.vendedor.localeCompare(b.vendedor) || a.creado.localeCompare(b.creado)
  );

  let r = 3;
  ordenadas.forEach((f, idx) => {
    const fila = ws.getRow(r);
    const valores: Record<string, string | number | null> = {
      cantidad: f.cantidad,
      productos: f.productos,
      costo: f.costo,
      venta: f.venta,
      gananciaTienda: gananciaTiendaDe(f),
      gananciaVendedor: gananciaVendedorDe(f),
      domicilio: f.domicilio || null,
      total: f.total,
      mensajero: f.mensajero,
      vendedor: f.vendedor,
      estado: ETIQUETA_ESTADO[f.estado] ?? f.estado.toUpperCase(),
    };
    const colorM = colorMensajero(f.mensajeroId, colores);
    const cancelado = !vigente(f);
    const noSuma = !entregado(f);
    COLS_DIARIA.forEach((c, i) => {
      const cel = fila.getCell(i + 1);
      cel.value = valores[c.k] ?? null;
      estilarCelda(cel, {
        num: 'num' in c && c.num,
        izquierda: c.k === 'productos',
        fill:
          c.k === 'gananciaTienda' ? ROSA_GANANCIA
          : c.k === 'gananciaVendedor' ? AZUL_COMISION
          : c.k === 'total' || c.k === 'mensajero' ? colorM
          : c.k === 'estado' ? COLOR_ESTADO[f.estado]
          : undefined,
      });
      // No entregado (pendiente, en ruta o cancelado): tachado y en gris, no entra en los totales
      if (noSuma && c.k !== 'estado') cel.font = { name: 'Calibri', size: 10, strike: true, color: { argb: 'FF8C8C8C' } };
      if (c.k === 'estado') cel.font = { name: 'Calibri', size: 10, bold: true, color: { argb: cancelado ? 'FF9C0006' : 'FF000000' } };
    });
    if (f.sinCosto) fila.getCell(col('costo')).note = 'Algún producto no tiene costo registrado: se usó su precio base.';

    // Línea doble al cambiar de vendedor (separa los grupos como en la planilla)
    const siguiente = ordenadas[idx + 1];
    if (siguiente && siguiente.vendedorId !== f.vendedorId) {
      for (let i = 1; i <= n; i++) {
        const c = fila.getCell(i);
        c.border = { ...BORDE, bottom: { style: 'double', color: { argb: 'FF7F3F98' } } };
      }
    }
    r++;
  });

  // Totales del día
  const primera = 3;
  const ultima = r - 1;
  const rt = ws.getRow(r);
  rt.height = 20;
  // Todos los totales suman solo los pedidos ENTREGADOS (los demás van tachados)
  const rangoEstado = `${letra('estado')}${primera}:${letra('estado')}${ultima}`;
  const suma = (k: string, valor: number) => ({
    formula: `SUMIF(${rangoEstado},"ENTREGADO",${letra(k)}${primera}:${letra(k)}${ultima})`,
    result: valor,
  });
  const tot = (fn: (f: FilaPedido) => number) => filas.filter(entregado).reduce((s, f) => s + fn(f), 0);
  const nEntregados = filas.filter(entregado).length;
  const nSinSumar = filas.length - nEntregados;
  const totales: Record<string, unknown> = {
    cantidad: suma('cantidad', tot((f) => f.cantidad)),
    productos: 'TOTAL',
    costo: suma('costo', tot((f) => f.costo)),
    venta: suma('venta', tot((f) => f.venta)),
    gananciaTienda: suma('gananciaTienda', tot(gananciaTiendaDe)),
    gananciaVendedor: suma('gananciaVendedor', tot(gananciaVendedorDe)),
    domicilio: suma('domicilio', tot((f) => f.domicilio)),
    total: suma('total', tot((f) => f.total)),
    mensajero: `${nEntregados} ${nEntregados === 1 ? 'ENTREGADO' : 'ENTREGADOS'}`,
    vendedor: null,
    estado: nSinSumar ? `${nSinSumar} SIN SUMAR` : null,
  };
  COLS_DIARIA.forEach((c, i) => {
    const celda = rt.getCell(i + 1);
    celda.value = totales[c.k] as any;
    estilarCelda(celda, { fill: ROSA_ENCABEZADO, bold: true, num: 'num' in c && c.num || c.k === 'cantidad' });
  });
  for (const k of ['gananciaTienda', 'gananciaVendedor']) {
    const c = rt.getCell(col(k));
    c.font = { name: 'Calibri', size: 11, bold: true };
    c.border = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } };
  }

  ws.views = [{ state: 'frozen', ySplit: 2 }];
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: Math.max(ultima, 2), column: n } };
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

/** Totales por día cuando el rango tiene varios días. */
function hojaResumenDias(ws: Worksheet, dias: [string, FilaPedido[]][]): void {
  const enc = ['DÍA', 'ENTREGADOS', 'CANT', 'VENTA', 'GANANCIA TIENDA', 'GANANCIA VENDEDOR', 'DOMICILIOS', 'TOTAL RECOGIDA'];
  ws.columns = [26, 10, 8, 14, 16, 18, 13, 16].map((w) => ({ width: w }));
  enc.forEach((t, i) => {
    const c = ws.getRow(1).getCell(i + 1);
    c.value = t;
    estilarCelda(c, { fill: ROSA_ENCABEZADO, bold: true });
  });
  dias.forEach(([dia, todas], idx) => {
    const filas = todas.filter(entregado);
    const tot = (fn: (f: FilaPedido) => number) => filas.reduce((s, f) => s + fn(f), 0);
    const valores = [
      tituloDia(dia),
      filas.length,
      tot((f) => f.cantidad),
      tot((f) => f.venta),
      tot(gananciaTiendaDe),
      tot(gananciaVendedorDe),
      tot((f) => f.domicilio),
      tot((f) => f.total),
    ];
    valores.forEach((v, i) => {
      const c = ws.getRow(idx + 2).getCell(i + 1);
      c.value = v;
      estilarCelda(c, { num: i >= 3, izquierda: i === 0, fill: i === 4 ? ROSA_GANANCIA : i === 5 ? AZUL_COMISION : undefined });
    });
  });
  const n = dias.length + 1;
  const rt = ws.getRow(n + 1);
  rt.getCell(1).value = 'TOTAL';
  ['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((letra, i) => {
    let suma = 0;
    for (let r = 2; r <= n; r++) suma += Number(ws.getRow(r).getCell(i + 2).value) || 0;
    rt.getCell(i + 2).value = { formula: `SUM(${letra}2:${letra}${n})`, result: suma };
  });
  for (let i = 1; i <= enc.length; i++) estilarCelda(rt.getCell(i), { fill: ROSA_ENCABEZADO, bold: true, num: i >= 4 });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

// ---------- Punto de entrada ----------
/** Genera y descarga el Excel. Devuelve cuántos pedidos incluyó. */
export async function descargarExcelVentas(db: SupabaseClient, o: OpcionesExcel): Promise<number> {
  const general = o.vendedorId === 'todos';
  const grupos = await cargarGrupos(db, o, general);
  if (!grupos.length) return 0;

  // exceljs pesa ~1 MB: se carga solo al descargar, no al abrir la app
  const ExcelJS = (await import('exceljs')).default;
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Home ALS';
  libro.created = new Date();
  // Excel recalcula todas las fórmulas al abrir (por si alguien edita filas)
  libro.calcProperties.fullCalcOnLoad = true;

  const usados = new Set<string>();
  const colores = new Map<string, string>(); // mismo color por mensajero en todas las hojas

  if (general) {
    // Planilla general: una hoja "VENTA DIARIA" por día
    const porDia = new Map<string, FilaPedido[]>();
    for (const f of grupos.flatMap((g) => g.filas)) {
      if (!porDia.has(f.dia)) porDia.set(f.dia, []);
      porDia.get(f.dia)!.push(f);
    }
    const dias = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (dias.length > 1) hojaResumenDias(libro.addWorksheet(nombreHoja('Resumen', usados)), dias);
    for (const [dia, filas] of dias) {
      hojaDiaria(libro.addWorksheet(nombreHoja(hojaDiaNombre(dia), usados)), dia, filas, colores);
    }
  } else {
    if (grupos.length > 1) hojaResumen(libro.addWorksheet(nombreHoja('Resumen', usados)), grupos);
    for (const g of grupos) {
      const titulo = g.porcentaje !== null ? `${g.vendedor} ${g.porcentaje}%` : g.vendedor;
      hojaVendedor(libro.addWorksheet(nombreHoja(titulo, usados)), g, colores);
    }
  }

  const buffer = await libro.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = o.vendedorId === 'todos'
    ? `venta_diaria_${o.desde}${o.hasta !== o.desde ? '_a_' + o.hasta : ''}.xlsx`
    : `ventas_${o.desde}_a_${o.hasta}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return grupos.reduce((s, g) => s + g.filas.length, 0);
}
