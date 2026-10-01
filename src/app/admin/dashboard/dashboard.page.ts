import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { SupabaseService } from '../../core/services/supabase.service';
import { diaColombiaDe, hoyColombiaISO, inicioDiaColombia } from '../../shared/fecha-colombia';
import { EstadoIconComponent } from '../../shared/estado-icon/estado-icon.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { EstadoPedido } from '../../shared/models/models';

// Solo lo que usamos de Chart.js, para no cargar la librería entera
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, DoughnutController, ArcElement);

type Periodo = 7 | 30 | 90;
type Metrica = 'ventas' | 'pedidos';

interface PedidoResumen {
  id: string;
  numero: number;
  cliente_nombre: string;
  total: number;
  estado: EstadoPedido;
  created_at: string;
}

interface Tarea {
  tipo: 'cuadre' | 'asignar' | 'stock';
  titulo: string;
  detalle: string;
  monto: number | null;
  accion: string;
  ruta: string;
  query?: Record<string, string>;
}

interface DomiciliarioActivo {
  id: string;
  nombre: string;
  avatar_url: string | null;
  cantidad: number;
  valor: number;
}

interface Bucket {
  etiqueta: string; // eje X
  titulo: string; // tooltip
  ventas: number;
  pedidos: number;
  actual: boolean; // hoy o la semana en curso
}

const ESTADOS_VENTA = ['en_ruta', 'entregado'];
const ORDEN_ESTADOS: EstadoPedido[] = ['entregado', 'en_ruta', 'pendiente', 'cancelado'];
const ETIQUETAS: Record<EstadoPedido, string> = {
  pendiente: 'Por asignar',
  en_ruta: 'En ruta',
  entregado: 'Entregados',
  cancelado: 'Cancelados',
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, EstadoIconComponent, AvatarComponent],
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
})
export class DashboardPage implements OnInit, OnDestroy {
  loading = true;
  readonly hoy = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Bogota',
  });

  // Resumen
  ventasHoy = 0;
  gananciaHoy = 0;
  pedidosHoy = 0;
  entregadosHoy = 0;
  pedidosEnRuta = 0;
  porCobrarCuadres = 0;
  cuadresPendientes = 0;

  tareas: Tarea[] = [];
  domiciliarios: DomiciliarioActivo[] = [];
  recientes: PedidoResumen[] = [];

  // Gráfica de ventas
  periodo: Periodo = 7;
  metrica: Metrica = 'ventas';
  readonly periodos: { valor: Periodo; etiqueta: string }[] = [
    { valor: 7, etiqueta: '7 días' },
    { valor: 30, etiqueta: '30 días' },
    { valor: 90, etiqueta: '3 meses' },
  ];
  buckets: Bucket[] = [];
  totalPeriodo = 0;
  pedidosPeriodo = 0;
  variacion: number | null = null; // % contra el periodo anterior
  cargandoGrafica = false;

  // Gráfica de estados de hoy
  estadosHoy: { estado: EstadoPedido; etiqueta: string; cantidad: number; pct: number }[] = [];
  pctEntregado = 0;

  @ViewChild('canvasVentas') set canvasVentas(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.refVentas = ref;
    if (ref) queueMicrotask(() => this.dibujarVentas());
  }
  @ViewChild('canvasEstados') set canvasEstados(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.refEstados = ref;
    if (ref) queueMicrotask(() => this.dibujarEstados());
  }
  private refVentas?: ElementRef<HTMLCanvasElement>;
  private refEstados?: ElementRef<HTMLCanvasElement>;
  private graficaVentas: Chart | null = null;
  private graficaEstados: Chart | null = null;

  private canal: RealtimeChannel | null = null;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private observadorTema: MutationObserver | null = null;
  private cargando = false;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    await this.cargarTodo();
    this.suscribirRealtime();
    // Redibuja las gráficas con los colores correctos al cambiar a modo oscuro/claro
    this.observadorTema = new MutationObserver(() => {
      this.dibujarVentas();
      this.dibujarEstados();
    });
    this.observadorTema.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  ngOnDestroy(): void {
    this.graficaVentas?.destroy();
    this.graficaEstados?.destroy();
    this.observadorTema?.disconnect();
    if (this.temporizador) clearTimeout(this.temporizador);
    if (this.canal) this.supabase.client.removeChannel(this.canal);
  }

  private suscribirRealtime(): void {
    const recargar = () => {
      if (this.temporizador) clearTimeout(this.temporizador);
      this.temporizador = setTimeout(() => this.cargarTodo(), 400);
    };
    this.canal = this.supabase.client
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, recargar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuadres' }, recargar)
      .subscribe();
  }

  async cargarTodo(): Promise<void> {
    if (this.cargando) return;
    this.cargando = true;
    try {
      await Promise.all([this.cargarResumen(), this.cargarVentas()]);
    } finally {
      this.cargando = false;
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  // ---------------------------------------------------------------- Resumen
  private async cargarResumen(): Promise<void> {
    const inicioHoy = inicioDiaColombia().toISOString();
    const db = this.supabase.client;

    const { data: config } = await db
      .from('configuracion')
      .select('stock_bajo_umbral')
      .eq('id', true)
      .single();
    const umbral = config?.stock_bajo_umbral ?? 5;

    const [hoyRes, gananciaRes, sinAsignarRes, cuadresRes, stockRes, enRutaRes, recientesRes, perfilesRes] =
      await Promise.all([
        db.from('pedidos').select('total, estado').gte('created_at', inicioHoy),
        db.rpc('ganancias_hoy'),
        db
          .from('pedidos')
          .select('total, created_at')
          .eq('estado', 'pendiente')
          .order('created_at', { ascending: true }),
        db
          .from('cuadres')
          .select('id, domiciliario_id, total_a_entregar, cantidad_pedidos, cerrado_at, fecha')
          .eq('estado', 'pendiente')
          .order('fecha', { ascending: true }),
        db
          .from('productos')
          .select('id, nombre, stock')
          .eq('activo', true)
          .lt('stock', umbral)
          .order('stock', { ascending: true })
          .limit(5),
        db.from('pedidos').select('domiciliario_id, total').eq('estado', 'en_ruta'),
        db
          .from('pedidos')
          .select('id, numero, cliente_nombre, total, estado, created_at')
          .order('created_at', { ascending: false })
          .limit(6),
        db.from('profiles').select('*'),
      ]);

    const perfiles = new Map<string, any>((perfilesRes.data ?? []).map((p: any) => [p.id, p]));
    const nombre = (id: string) => perfiles.get(id)?.nombre ?? 'Domiciliario';

    // Hoy
    const hoy = (hoyRes.data ?? []) as { total: number; estado: EstadoPedido }[];
    this.ventasHoy = hoy
      .filter((p) => ESTADOS_VENTA.includes(p.estado))
      .reduce((s, p) => s + Number(p.total || 0), 0);
    this.gananciaHoy = Number(gananciaRes.data ?? 0);
    this.pedidosHoy = hoy.filter((p) => p.estado !== 'cancelado').length;
    this.entregadosHoy = hoy.filter((p) => p.estado === 'entregado').length;

    const total = hoy.length;
    this.estadosHoy = ORDEN_ESTADOS.map((estado) => {
      const cantidad = hoy.filter((p) => p.estado === estado).length;
      return { estado, etiqueta: ETIQUETAS[estado], cantidad, pct: total ? Math.round((cantidad / total) * 100) : 0 };
    });
    this.pctEntregado = total ? Math.round((this.entregadosHoy / total) * 100) : 0;

    // En ruta
    const enRuta = (enRutaRes.data ?? []) as { domiciliario_id: string | null; total: number }[];
    this.pedidosEnRuta = enRuta.length;
    const porDom = new Map<string, DomiciliarioActivo>();
    for (const p of enRuta) {
      if (!p.domiciliario_id) continue;
      const d = porDom.get(p.domiciliario_id) ?? {
        id: p.domiciliario_id,
        nombre: nombre(p.domiciliario_id),
        avatar_url: perfiles.get(p.domiciliario_id)?.avatar_url ?? null,
        cantidad: 0,
        valor: 0,
      };
      d.cantidad++;
      d.valor += Number(p.total || 0);
      porDom.set(p.domiciliario_id, d);
    }
    this.domiciliarios = [...porDom.values()].sort((a, b) => b.cantidad - a.cantidad);

    // Cuadres
    const cuadres = (cuadresRes.data ?? []) as any[];
    this.cuadresPendientes = cuadres.length;
    this.porCobrarCuadres = cuadres.reduce((s, c) => s + Number(c.total_a_entregar || 0), 0);

    // Necesita atención: lo más urgente primero
    const tareas: Tarea[] = cuadres.map((c) => ({
      tipo: 'cuadre',
      titulo: `Cuadre de ${nombre(c.domiciliario_id)}`,
      detalle: `Cerrado ${this.fechaCorta(c.cerrado_at ?? c.fecha)}, ${c.cantidad_pedidos ?? 0} pedidos`,
      monto: Number(c.total_a_entregar || 0),
      accion: 'Revisar',
      ruta: '/admin/cuadres',
      // Abre Cuadres en el día de ese cuadre (por defecto la página muestra hoy)
      query: { fecha: c.fecha },
    }));

    const sinAsignar = (sinAsignarRes.data ?? []) as { total: number; created_at: string }[];
    if (sinAsignar.length) {
      tareas.push({
        tipo: 'asignar',
        titulo:
          sinAsignar.length === 1 ? '1 pedido sin domiciliario' : `${sinAsignar.length} pedidos sin domiciliario`,
        detalle: `El más antiguo entró ${this.fechaCorta(sinAsignar[0].created_at)}`,
        monto: sinAsignar.reduce((s, p) => s + Number(p.total || 0), 0),
        accion: 'Asignar',
        ruta: '/admin/pedidos',
      });
    }

    for (const prod of (stockRes.data ?? []) as any[]) {
      tareas.push({
        tipo: 'stock',
        titulo: prod.nombre,
        detalle: prod.stock <= 0 ? 'Agotado' : prod.stock === 1 ? 'Queda 1 unidad' : `Quedan ${prod.stock} unidades`,
        monto: null,
        accion: 'Ver producto',
        ruta: '/admin/productos',
      });
    }
    this.tareas = tareas;

    this.recientes = (recientesRes.data ?? []) as PedidoResumen[];
    this.dibujarEstados();
  }

  // ----------------------------------------------------------------- Ventas
  async cambiarPeriodo(p: Periodo): Promise<void> {
    if (p === this.periodo) return;
    this.periodo = p;
    this.cargandoGrafica = true;
    this.cdr.detectChanges();
    await this.cargarVentas();
    this.cargandoGrafica = false;
    this.cdr.detectChanges();
  }

  cambiarMetrica(m: Metrica): void {
    this.metrica = m;
    this.dibujarVentas();
  }

  private async cargarVentas(): Promise<void> {
    const dias = this.periodo;
    const hoyIso = hoyColombiaISO();
    // Se trae el periodo actual y el anterior para poder comparar
    const inicio = inicioDiaColombia(hoyIso);
    inicio.setDate(inicio.getDate() - (dias * 2 - 1));

    const { data } = await this.supabase.client
      .from('pedidos')
      .select('total, created_at')
      .gte('created_at', inicio.toISOString())
      .in('estado', ESTADOS_VENTA);

    // Totales por día (en hora de Colombia)
    const porDia = new Map<string, { ventas: number; pedidos: number }>();
    for (const f of (data ?? []) as { total: number; created_at: string }[]) {
      const k = diaColombiaDe(f.created_at);
      const d = porDia.get(k) ?? { ventas: 0, pedidos: 0 };
      d.ventas += Number(f.total || 0);
      d.pedidos++;
      porDia.set(k, d);
    }

    const dia = (offset: number) => {
      const d = new Date(`${hoyIso}T12:00:00-05:00`);
      d.setDate(d.getDate() - offset);
      return d;
    };
    const clave = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const sumar = (desde: number, hasta: number) => {
      let ventas = 0;
      let pedidos = 0;
      for (let i = desde; i <= hasta; i++) {
        const v = porDia.get(clave(dia(i)));
        if (v) {
          ventas += v.ventas;
          pedidos += v.pedidos;
        }
      }
      return { ventas, pedidos };
    };

    const actual = sumar(0, dias - 1);
    const anterior = sumar(dias, dias * 2 - 1);
    this.totalPeriodo = actual.ventas;
    this.pedidosPeriodo = actual.pedidos;
    this.variacion = anterior.ventas > 0 ? Math.round(((actual.ventas - anterior.ventas) / anterior.ventas) * 100) : null;

    const fmt = (d: Date, o: Intl.DateTimeFormatOptions) =>
      d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', ...o });

    const buckets: Bucket[] = [];
    if (dias <= 30) {
      // Una barra por día
      for (let i = dias - 1; i >= 0; i--) {
        const d = dia(i);
        const v = porDia.get(clave(d)) ?? { ventas: 0, pedidos: 0 };
        buckets.push({
          etiqueta: i === 0 ? 'Hoy' : dias === 7 ? fmt(d, { weekday: 'short' }) : fmt(d, { day: 'numeric' }),
          titulo: i === 0 ? 'Hoy' : fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }),
          ...v,
          actual: i === 0,
        });
      }
    } else {
      // Una barra por semana (13 semanas ≈ 3 meses)
      for (let s = Math.ceil(dias / 7) - 1; s >= 0; s--) {
        const desde = s * 7 + 6;
        const hasta = s * 7;
        const v = sumar(hasta, desde);
        const ini = dia(desde);
        const fin = dia(hasta);
        buckets.push({
          etiqueta: fmt(ini, { day: 'numeric', month: 'short' }),
          titulo: `Del ${fmt(ini, { day: 'numeric', month: 'short' })} al ${fmt(fin, { day: 'numeric', month: 'short' })}`,
          ...v,
          actual: s === 0,
        });
      }
    }
    this.buckets = buckets;
    this.dibujarVentas();
  }

  // ---------------------------------------------------------------- Gráficas
  private css(nombre: string): string {
    return getComputedStyle(document.body).getPropertyValue(nombre).trim();
  }

  private dibujarVentas(): void {
    const canvas = this.refVentas?.nativeElement;
    if (!canvas || !this.buckets.length) return;

    const accent = this.css('--accent');
    const neutro = this.css('--border-strong');
    const texto = this.css('--text-muted');
    const linea = this.css('--border-soft');
    const esVentas = this.metrica === 'ventas';
    const valores = this.buckets.map((b) => (esVentas ? b.ventas : b.pedidos));
    const colores = this.buckets.map((b) => (b.actual ? accent : neutro));

    if (this.graficaVentas) {
      // Actualiza en sitio para que la transición sea suave
      const g = this.graficaVentas;
      g.data.labels = this.buckets.map((b) => b.etiqueta);
      g.data.datasets[0].data = valores;
      (g.data.datasets[0] as any).backgroundColor = colores;
      (g.data.datasets[0] as any).hoverBackgroundColor = colores.map((c) => (c === accent ? this.css('--accent-hover') : texto));
      (g.options.scales as any).x.ticks.color = texto;
      (g.options.scales as any).y.ticks.color = texto;
      (g.options.scales as any).y.grid.color = linea;
      g.update();
      return;
    }

    this.graficaVentas = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: this.buckets.map((b) => b.etiqueta),
        datasets: [
          {
            data: valores,
            backgroundColor: colores,
            hoverBackgroundColor: colores.map((c) => (c === accent ? this.css('--accent-hover') : texto)),
            borderRadius: 4,
            borderSkipped: 'bottom',
            maxBarThickness: 36,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            padding: 10,
            titleFont: { family: this.css('--ui-font'), weight: 600 },
            bodyFont: { family: this.css('--ui-font') },
            callbacks: {
              title: (items) => this.buckets[items[0].dataIndex]?.titulo ?? '',
              label: (item) => {
                const b = this.buckets[item.dataIndex];
                return [
                  `Ventas: ${this.formatoMoneda(b.ventas)}`,
                  `Pedidos: ${b.pedidos}`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: texto,
              font: { family: this.css('--ui-font'), size: 11 },
              maxRotation: 0,
              autoSkip: true,
              autoSkipPadding: 8,
            },
          },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: linea },
            ticks: {
              color: texto,
              font: { family: this.css('--ui-font'), size: 11 },
              maxTicksLimit: 5,
              precision: 0,
              callback: (v) => (this.metrica === 'ventas' ? this.monedaCorta(Number(v)) : String(v)),
            },
          },
        },
      },
    });
  }

  private dibujarEstados(): void {
    const canvas = this.refEstados?.nativeElement;
    if (!canvas) return;

    const colores: Record<EstadoPedido, string> = {
      entregado: this.css('--st-entregado'),
      en_ruta: this.css('--st-ruta'),
      pendiente: this.css('--border-strong'),
      cancelado: this.css('--st-cancelado'),
    };
    const conDatos = this.estadosHoy.filter((e) => e.cantidad > 0);
    const data = conDatos.length ? conDatos.map((e) => e.cantidad) : [1];
    const bg = conDatos.length ? conDatos.map((e) => colores[e.estado]) : [this.css('--surface-2')];
    const labels = conDatos.length ? conDatos.map((e) => e.etiqueta) : ['Sin pedidos'];

    if (this.graficaEstados) {
      const g = this.graficaEstados;
      g.data.labels = labels;
      g.data.datasets[0].data = data;
      (g.data.datasets[0] as any).backgroundColor = bg;
      (g.options.plugins as any).tooltip.enabled = conDatos.length > 0;
      g.update();
      return;
    }

    this.graficaEstados = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: bg, borderWidth: 0, hoverOffset: 4 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        animation: { duration: 250 },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: conDatos.length > 0,
            displayColors: false,
            bodyFont: { family: this.css('--ui-font') },
            callbacks: {
              label: (item) => {
                const total = (item.dataset.data as number[]).reduce((s, v) => s + v, 0);
                const pct = total ? Math.round((Number(item.raw) / total) * 100) : 0;
                return `${item.label}: ${item.raw} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------- Formatos
  formatoMoneda(valor: number): string {
    return Number(valor || 0).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  private monedaCorta(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
    if (v >= 1_000) return `$${Math.round(v / 1_000)} mil`;
    return `$${v}`;
  }

  private fechaCorta(iso: string): string {
    const k = diaColombiaDe(iso);
    const hoy = hoyColombiaISO();
    const ayer = new Date(`${hoy}T12:00:00-05:00`);
    ayer.setDate(ayer.getDate() - 1);
    const hora = new Date(iso).toLocaleTimeString('es-CO', {
      timeZone: 'America/Bogota',
      hour: 'numeric',
      minute: '2-digit',
    });
    if (k === hoy) return `hoy a las ${hora}`;
    if (k === ayer.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })) return `ayer a las ${hora}`;
    return 'el ' + new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short' });
  }

  formatoHora(iso: string): string {
    return new Date(iso).toLocaleTimeString('es-CO', {
      timeZone: 'America/Bogota',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  etiquetaEstado(e: EstadoPedido): string {
    return ETIQUETAS[e];
  }
}
