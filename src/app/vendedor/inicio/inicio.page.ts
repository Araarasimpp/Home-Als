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
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { EstadoPedido } from '../../shared/models/models';
import { diaColombiaDe, hoyColombiaISO, inicioDiaColombia } from '../../shared/fecha-colombia';
import { EstadoIconComponent } from '../../shared/estado-icon/estado-icon.component';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

interface PedidoPropio {
  id: string;
  numero: number;
  cliente_nombre: string;
  barrio: string | null;
  total: number;
  comision: number;
  estado: EstadoPedido;
  created_at: string;
}

interface Dia {
  etiqueta: string;
  titulo: string;
  ventas: number;
  comision: number;
  pedidos: number;
  hoy: boolean;
}

type Metrica = 'ventas' | 'comision';
type Filtro = 'activos' | 'entregado' | 'todos';

const ETIQUETAS: Record<EstadoPedido, string> = {
  pendiente: 'Por asignar',
  en_ruta: 'En ruta',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

@Component({
  selector: 'app-inicio-vendedor',
  standalone: true,
  imports: [CommonModule, RouterLink, IonIcon, EstadoIconComponent],
  templateUrl: './inicio.page.html',
  styleUrls: ['../../shared/ui.scss', './inicio.page.scss'],
})
export class InicioPage implements OnInit, OnDestroy {
  loading = true;
  nombre = '';
  readonly hoyTexto = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Bogota',
  });

  ventasHoy = 0;
  comisionHoy = 0;
  pedidosHoy = 0;
  pedidosEnRuta = 0;
  porAsignar = 0;
  entregadosHoy = 0;

  dias: Dia[] = [];
  metrica: Metrica = 'comision';
  periodo: 7 | 30 = 7;
  totalPeriodo = { ventas: 0, comision: 0, pedidos: 0 };

  pedidos: PedidoPropio[] = [];
  filtro: Filtro = 'activos';

  @ViewChild('canvas') set canvasRef(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.canvas = ref?.nativeElement;
    if (this.canvas) queueMicrotask(() => this.dibujar());
  }
  private canvas?: HTMLCanvasElement;
  private grafica: Chart | null = null;
  private canal: RealtimeChannel | null = null;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private observadorTema: MutationObserver | null = null;
  private userId: string | null = null;
  private filasPeriodo: { total: number; comision: number; created_at: string }[] = [];

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {
    addIcons({ add });
  }

  async ngOnInit(): Promise<void> {
    const [user, perfil] = await Promise.all([
      this.supabase.getCurrentUser(),
      this.supabase.getCurrentProfile(),
    ]);
    this.userId = user?.id ?? null;
    this.nombre = (perfil?.nombre ?? '').split(' ')[0];
    await this.cargar();
    this.suscribirRealtime();
    this.observadorTema = new MutationObserver(() => this.dibujar(true));
    this.observadorTema.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  ngOnDestroy(): void {
    this.grafica?.destroy();
    this.observadorTema?.disconnect();
    if (this.temporizador) clearTimeout(this.temporizador);
    if (this.canal) this.supabase.client.removeChannel(this.canal);
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('vendedor-inicio-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        if (this.temporizador) clearTimeout(this.temporizador);
        this.temporizador = setTimeout(() => this.cargar(), 400);
      })
      .subscribe();
  }

  async cargar(): Promise<void> {
    if (!this.userId) {
      this.loading = false;
      this.cdr.detectChanges();
      return;
    }
    const db = this.supabase.client;
    const inicioHoy = inicioDiaColombia().toISOString();
    const inicioPeriodo = inicioDiaColombia();
    inicioPeriodo.setDate(inicioPeriodo.getDate() - 29); // siempre 30 días; 7 días es un recorte

    const [hoyRes, periodoRes, pedidosRes, entregadosRes] = await Promise.all([
      db
        .from('pedidos')
        .select('total, comision, estado')
        .eq('vendedor_id', this.userId)
        .gte('created_at', inicioHoy),
      db
        .from('pedidos')
        .select('total, comision, created_at')
        .eq('vendedor_id', this.userId)
        .gte('created_at', inicioPeriodo.toISOString())
        .in('estado', ['en_ruta', 'entregado']),
      db
        .from('pedidos')
        .select('id, numero, cliente_nombre, barrio, total, comision, estado, created_at')
        .eq('vendedor_id', this.userId)
        .order('created_at', { ascending: false })
        .limit(40),
      db
        .from('pedidos')
        .select('id', { count: 'exact', head: true })
        .eq('vendedor_id', this.userId)
        .eq('estado', 'entregado')
        .gte('entregado_at', inicioHoy),
    ]);

    const hoy = (hoyRes.data ?? []) as { total: number; comision: number; estado: EstadoPedido }[];
    const vendidos = hoy.filter((p) => p.estado === 'en_ruta' || p.estado === 'entregado');
    this.ventasHoy = vendidos.reduce((s, p) => s + Number(p.total || 0), 0);
    this.comisionHoy = vendidos.reduce((s, p) => s + Number(p.comision || 0), 0);
    this.pedidosHoy = hoy.filter((p) => p.estado !== 'cancelado').length;
    this.entregadosHoy = entregadosRes.count ?? 0;

    this.pedidos = (pedidosRes.data ?? []) as PedidoPropio[];
    this.pedidosEnRuta = this.pedidos.filter((p) => p.estado === 'en_ruta').length;
    this.porAsignar = this.pedidos.filter((p) => p.estado === 'pendiente').length;

    this.filasPeriodo = (periodoRes.data ?? []) as any[];
    this.armarDias();

    this.loading = false;
    this.cdr.detectChanges();
    this.dibujar();
  }

  // ---------- Gráfica ----------
  cambiarPeriodo(p: 7 | 30): void {
    this.periodo = p;
    this.armarDias();
    this.dibujar(true);
  }

  cambiarMetrica(m: Metrica): void {
    this.metrica = m;
    this.dibujar();
  }

  private armarDias(): void {
    const porDia = new Map<string, { ventas: number; comision: number; pedidos: number }>();
    for (const f of this.filasPeriodo) {
      const k = diaColombiaDe(f.created_at);
      const d = porDia.get(k) ?? { ventas: 0, comision: 0, pedidos: 0 };
      d.ventas += Number(f.total || 0);
      d.comision += Number(f.comision || 0);
      d.pedidos++;
      porDia.set(k, d);
    }
    const hoyIso = hoyColombiaISO();
    const fmt = (d: Date, o: Intl.DateTimeFormatOptions) =>
      d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', ...o });

    const dias: Dia[] = [];
    for (let i = this.periodo - 1; i >= 0; i--) {
      const d = new Date(`${hoyIso}T12:00:00-05:00`);
      d.setDate(d.getDate() - i);
      const k = d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      const v = porDia.get(k) ?? { ventas: 0, comision: 0, pedidos: 0 };
      dias.push({
        etiqueta: i === 0 ? 'Hoy' : this.periodo === 7 ? fmt(d, { weekday: 'short' }) : fmt(d, { day: 'numeric' }),
        titulo: i === 0 ? 'Hoy' : fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }),
        ...v,
        hoy: i === 0,
      });
    }
    this.dias = dias;
    this.totalPeriodo = dias.reduce(
      (t, d) => ({ ventas: t.ventas + d.ventas, comision: t.comision + d.comision, pedidos: t.pedidos + d.pedidos }),
      { ventas: 0, comision: 0, pedidos: 0 }
    );
  }

  private css(n: string): string {
    return getComputedStyle(document.body).getPropertyValue(n).trim();
  }

  private dibujar(recrear = false): void {
    if (!this.canvas || !this.dias.length) return;
    if (recrear && this.grafica) {
      this.grafica.destroy();
      this.grafica = null;
    }
    const accent = this.css('--accent');
    const neutro = this.css('--border-strong');
    const texto = this.css('--text-muted');
    const linea = this.css('--border-soft');
    const fuente = this.css('--ui-font');
    const valores = this.dias.map((d) => (this.metrica === 'ventas' ? d.ventas : d.comision));
    const colores = this.dias.map((d) => (d.hoy ? accent : neutro));

    if (this.grafica) {
      this.grafica.data.datasets[0].data = valores;
      this.grafica.update();
      return;
    }

    this.grafica = new Chart(this.canvas, {
      type: 'bar',
      data: {
        labels: this.dias.map((d) => d.etiqueta),
        datasets: [{ data: valores, backgroundColor: colores, borderRadius: 4, maxBarThickness: 32 }],
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
            titleFont: { family: fuente, weight: 600 },
            bodyFont: { family: fuente },
            callbacks: {
              title: (items) => this.dias[items[0].dataIndex]?.titulo ?? '',
              label: (item) => {
                const d = this.dias[item.dataIndex];
                return [
                  `Ventas: ${this.formatoMoneda(d.ventas)}`,
                  `Tu comisión: ${this.formatoMoneda(d.comision)}`,
                  `Pedidos: ${d.pedidos}`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: texto, font: { family: fuente, size: 11 }, maxRotation: 0, autoSkipPadding: 6 },
          },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: linea },
            ticks: {
              color: texto,
              font: { family: fuente, size: 11 },
              maxTicksLimit: 4,
              callback: (v) => this.monedaCorta(Number(v)),
            },
          },
        },
      },
    });
  }

  // ---------- Lista ----------
  get pedidosFiltrados(): PedidoPropio[] {
    if (this.filtro === 'activos') return this.pedidos.filter((p) => p.estado === 'pendiente' || p.estado === 'en_ruta');
    if (this.filtro === 'entregado') return this.pedidos.filter((p) => p.estado === 'entregado');
    return this.pedidos;
  }

  etiquetaEstado(e: EstadoPedido): string {
    return ETIQUETAS[e];
  }

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

  fechaCorta(iso: string): string {
    const esHoy = diaColombiaDe(iso) === hoyColombiaISO();
    return esHoy
      ? new Date(iso).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' })
      : new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short' });
  }
}
