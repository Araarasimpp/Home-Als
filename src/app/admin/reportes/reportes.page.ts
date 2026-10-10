import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { descargarExcelVentas } from './excel-ventas';
import { SupabaseService } from '../../core/services/supabase.service';
import { EstadoPedido } from '../../shared/models/models';
import { hoyColombiaISO, inicioDiaColombia, finDiaColombia, formatoFechaCO } from '../../shared/fecha-colombia';
import { EsqueletoComponent } from '../../shared/esqueleto/esqueleto.component';

interface FilaReporte {
  pedidoId: string;
  numero: number;
  estado: EstadoPedido;
  created_at: string;
  vendedorNombre: string;
  /** "Margen" o "50% de la ganancia" */
  esquema: string;
  total: number;
  valorDomicilio: number;
  pagoDomiciliario: number;
  canal: 'domicilio' | 'local';
  comision: number;
  productoNombre: string;
  costo: number | null;
  precioVenta: number;
  cantidad: number;
  gananciaItem: number;
}

interface Vendedor {
  id: string;
  nombre: string;
}

type FiltroEstado = 'todos' | EstadoPedido;

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [EsqueletoComponent, CommonModule, FormsModule],
  templateUrl: './reportes.page.html',
  styleUrls: ['./reportes.page.scss', './reportes-esquema.scss'],
})
export class ReportesPage implements OnInit {
  loading = true;
  descargando = false;

  desde = '';
  hasta = '';
  vendedorId = 'todos';
  estado: FiltroEstado = 'todos';

  vendedores: Vendedor[] = [];
  filas: FilaReporte[] = [];

  // Totales a nivel de PEDIDO (no se duplican aunque el pedido tenga varias filas de producto)
  private pedidosUnicos: { total: number; valorDomicilio: number; pagoDomiciliario: number; comision: number; cancelado: boolean; entregado: boolean }[] = [];

  readonly estados: { valor: FiltroEstado; etiqueta: string }[] = [
    { valor: 'todos', etiqueta: 'Todos' },
    { valor: 'pendiente', etiqueta: 'Pendiente' },
    { valor: 'en_ruta', etiqueta: 'En ruta' },
    { valor: 'entregado', etiqueta: 'Entregado' },
    { valor: 'cancelado', etiqueta: 'Cancelado' },
  ];

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    const hoy = hoyColombiaISO();
    const [anio, mes] = hoy.split('-');
    this.desde = `${anio}-${mes}-01`;
    this.hasta = hoy;

    await this.cargarVendedores();
    await this.cargarReporte();
  }

  async cargarVendedores(): Promise<void> {
    // Incluye a los vendedores por margen y por porcentaje (ambos tienen rol "vendedor")
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, nombre')
      .contains('roles', ['vendedor'])
      .order('nombre');

    if (!error && data) {
      this.vendedores = data as Vendedor[];
    }
  }

  irEsteMes(): void {
    const hoy = hoyColombiaISO();
    const [anio, mes] = hoy.split('-');
    this.desde = `${anio}-${mes}-01`;
    this.hasta = hoy;
    this.cargarReporte();
  }

  irMesAnterior(): void {
    const hoy = new Date(hoyColombiaISO() + 'T00:00:00-05:00');
    const primerDiaMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ultimoDiaMesAnterior = new Date(primerDiaMesActual.getTime() - 86400000);
    const primerDiaMesAnterior = new Date(
      ultimoDiaMesAnterior.getFullYear(),
      ultimoDiaMesAnterior.getMonth(),
      1
    );

    this.desde = primerDiaMesAnterior.toISOString().slice(0, 10);
    this.hasta = ultimoDiaMesAnterior.toISOString().slice(0, 10);
    this.cargarReporte();
  }

  async cargarReporte(): Promise<void> {
    if (!this.desde || !this.hasta) return;
    this.loading = true;

    const inicio = inicioDiaColombia(this.desde);
    const fin = finDiaColombia(this.hasta);

    let query = this.supabase.client
      .from('pedidos')
      // '*' para incluir comision_tipo y comision_porcentaje sin fallar si aún no existen
      .select('*')
      .gte('created_at', inicio.toISOString())
      .lte('created_at', fin.toISOString())
      .order('created_at', { ascending: false });

    if (this.vendedorId !== 'todos') {
      query = query.eq('vendedor_id', this.vendedorId);
    }
    if (this.estado !== 'todos') {
      query = query.eq('estado', this.estado);
    }

    const [pedidosRes, perfilesRes] = await Promise.all([
      query,
      this.supabase.client.from('profiles').select('id, nombre'),
    ]);

    const pedidos = (pedidosRes.data ?? []) as any[];
    const nombresPorId = new Map((perfilesRes.data ?? []).map((p: any) => [p.id, p.nombre]));

    this.pedidosUnicos = pedidos.map((p) => ({
      total: Number(p.total ?? 0),
      valorDomicilio: Number(p.valor_domicilio ?? 0),
      pagoDomiciliario: Number(p.pago_domiciliario ?? p.valor_domicilio ?? 0),
      comision: Number(p.comision ?? 0),
      cancelado: p.estado === 'cancelado',
      entregado: p.estado === 'entregado',
    }));

    const filasNuevas: FilaReporte[] = [];

    if (pedidos.length) {
      const { data: items } = await this.supabase.client
        .from('pedido_items')
        .select('pedido_id, cantidad, precio_unitario, precio_base, producto:productos(nombre, costo)')
        .in(
          'pedido_id',
          pedidos.map((p) => p.id)
        );

      const pedidosPorId = new Map(pedidos.map((p) => [p.id, p]));

      for (const item of items ?? []) {
        const p = pedidosPorId.get((item as any).pedido_id);
        if (!p) continue;

        const costo = (item as any).producto?.costo ?? null;
        const precioVenta = Number((item as any).precio_unitario);
        const precioBase = Number((item as any).precio_base);
        const cantidad = Number((item as any).cantidad);
        const costoEfectivo = costo != null ? Number(costo) : precioBase;

        const porPorcentaje = p.comision_tipo === 'porcentaje';
        const pct = Number(p.comision_porcentaje ?? 0);

        // Ganancia de la TIENDA en este producto, ya descontada la parte del vendedor:
        //  - Por margen: precio base − costo (lo que cobre por encima del base es del vendedor).
        //  - Por porcentaje: (precio de venta − costo) menos el % que se lleva el vendedor.
        const gananciaItem = porPorcentaje
          ? Math.round(cantidad * (precioVenta - costoEfectivo) * (1 - pct / 100))
          : cantidad * (precioBase - costoEfectivo);

        filasNuevas.push({
          pedidoId: p.id,
          numero: p.numero,
          estado: p.estado,
          created_at: p.created_at,
          vendedorNombre: (nombresPorId.get(p.vendedor_id) as string) ?? 'Vendedor',
          esquema: porPorcentaje ? `${pct}% de la ganancia` : 'Margen',
          total: Number(p.total ?? 0),
          valorDomicilio: Number(p.valor_domicilio ?? 0),
          pagoDomiciliario: Number(p.pago_domiciliario ?? p.valor_domicilio ?? 0),
          canal: p.canal ?? 'domicilio',
          comision: Number(p.comision ?? 0),
          productoNombre: (item as any).producto?.nombre ?? 'Producto',
          costo,
          precioVenta,
          cantidad,
          gananciaItem,
        });
      }
    }

    this.filas = filasNuevas;
    this.loading = false;
    this.cdr.detectChanges();
  }

  // Todos los totales cuentan solo pedidos ENTREGADOS; los demás se ven tachados en la tabla
  private get entregados() {
    return this.pedidosUnicos.filter((p) => p.entregado);
  }

  noSuma(f: FilaReporte): boolean {
    return f.estado !== 'entregado';
  }

  get hayNoSumados(): boolean {
    return this.filas.some((f) => this.noSuma(f));
  }

  get totalPedido(): number {
    return this.entregados.reduce((s, p) => s + p.total, 0);
  }

  get totalDomicilio(): number {
    return this.entregados.reduce((s, p) => s + p.valorDomicilio, 0);
  }

  get totalPagoDomiciliario(): number {
    return this.entregados.reduce((s, p) => s + p.pagoDomiciliario, 0);
  }

  /** Lo que la tienda pone de su bolsillo en envíos (pago al domiciliario − cobro al cliente), solo entregados. */
  get totalEnvioAsumido(): number {
    return this.pedidosUnicos
      .filter((p) => p.entregado)
      .reduce((s, p) => s + (p.pagoDomiciliario - p.valorDomicilio), 0);
  }

  // Las ganancias solo cuentan pedidos entregados (pendientes, en ruta y cancelados no suman)
  get totalComision(): number {
    return this.pedidosUnicos.filter((p) => p.entregado).reduce((s, p) => s + p.comision, 0);
  }

  get totalGananciaTienda(): number {
    return this.filas.filter((f) => f.estado === 'entregado').reduce((s, f) => s + f.gananciaItem, 0);
  }

  get totalCantidad(): number {
    return this.filas.filter((f) => !this.noSuma(f)).reduce((s, f) => s + f.cantidad, 0);
  }

  /**
   * Excel con el formato de la planilla de la tienda. Con "Todos los
   * vendedores" es la "VENTA DIARIA" (una hoja por día, todos los pedidos);
   * con un vendedor, su hoja con las comisiones al final. Respeta los filtros
   * de fechas, vendedor y estado; con "Todos" deja por fuera los cancelados.
   */
  async descargarExcel(): Promise<void> {
    if (this.descargando) return;
    this.descargando = true;
    this.cdr.detectChanges();
    try {
      const pedidos = await descargarExcelVentas(this.supabase.client, {
        desde: this.desde,
        hasta: this.hasta,
        vendedorId: this.vendedorId,
        estado: this.estado,
      });
      if (!pedidos) alert('No hay ventas para descargar con estos filtros.');
    } catch (err: any) {
      alert('No se pudo generar el Excel. ' + (err?.message ?? ''));
    } finally {
      this.descargando = false;
      this.cdr.detectChanges();
    }
  }

  etiquetaEstado(estado: EstadoPedido): string {
    return this.estados.find((e) => e.valor === estado)?.etiqueta ?? estado;
  }

  claseEstado(estado: EstadoPedido): string {
    const clases: Record<EstadoPedido, string> = {
      pendiente: 'badge-bajo',
      en_ruta: 'badge-info',
      entregado: 'badge-ok',
      cancelado: 'badge-coral',
    };
    return clases[estado];
  }

  formatoFecha(fecha: string): string {
    return formatoFechaCO(fecha, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}
