import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { Cuadre, MetodoPago, efectivoDePedido, transferenciaDePedido } from '../../shared/models/models';
import { ImagenPreviewComponent } from '../../shared/imagen-preview/imagen-preview.component';
import { diaColombiaDe, formatoFechaCO, hoyColombiaISO } from '../../shared/fecha-colombia';

type FiltroCuadre = 'todos' | 'pendiente' | 'confirmado';

interface PedidoDelCuadre {
  id: string;
  numero: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  direccion: string;
  total: number;
  valor_domicilio: number;
  pago_domiciliario?: number;
  metodo_pago: MetodoPago | null;
  monto_efectivo?: number | null;
  monto_transferencia?: number | null;
  comprobante_url: string | null;
}

/** Entregas de un domiciliario en un día que todavía no están en ningún cuadre. */
interface SinCerrar {
  domiciliarioId: string;
  fecha: string;
  pedidos: number;
  efectivo: number;
  transferencia: number;
  pagoDomiciliario: number;
  aEntregar: number;
}

interface Domiciliario {
  id: string;
  nombre: string;
}

@Component({
  selector: 'app-admin-cuadres',
  standalone: true,
  imports: [CommonModule, FormsModule, ImagenPreviewComponent],
  templateUrl: './cuadres.page.html',
  styleUrls: ['./cuadres.page.scss', '../../shared/filtro-fecha.scss'],
})
export class AdminCuadresPage implements OnInit, OnDestroy {
  loading = true;
  cuadres: Cuadre[] = [];
  domiciliarios: Domiciliario[] = [];
  nombresPorId = new Map<string, string>();
  filtro: FiltroCuadre = 'pendiente';
  /** Fecha del filtro (YYYY-MM-DD). Por defecto hoy; vacía = todas las fechas. */
  fecha = hoyColombiaISO();
  readonly hoy = hoyColombiaISO();
  domiciliarioId = 'todos';
  confirmandoId: string | null = null;

  expandidoId: string | null = null;
  pedidosPorCuadre = new Map<string, PedidoDelCuadre[]>();
  cargandoDetalle = false;

  /** Lo que los domiciliarios llevan entregado y aún no han cerrado (en vivo). */
  sinCerrar: SinCerrar[] = [];
  /** Pedidos en ruta por domiciliario (todavía no entregados). */
  enRutaPorDom = new Map<string, number>();
  cerrandoClave: string | null = null;
  mensajeCierre = '';

  private canal: RealtimeChannel | null = null;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private supabase: SupabaseService,
    private cdr: ChangeDetectorRef,
    route: ActivatedRoute
  ) {
    // Permite abrir la página en una fecha concreta, ej. desde el dashboard:
    // /admin/cuadres?fecha=2026-09-30  o  /admin/cuadres?fecha=todas
    const param = route.snapshot.queryParamMap.get('fecha');
    if (param === 'todas') this.fecha = '';
    else if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) this.fecha = param;
  }

  async ngOnInit(): Promise<void> {
    await this.cargarTodo();
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('admin-cuadres-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuadres' }, () =>
        this.programarRecarga()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () =>
        this.programarRecarga()
      )
      .subscribe();
  }

  private programarRecarga(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      this.pedidosPorCuadre.clear();
      this.cargarTodo();
    }, 400);
  }

  async cargarTodo(): Promise<void> {
    if (!this.cuadres.length) this.loading = true;

    const [cuadresRes, perfilesRes, abiertosRes] = await Promise.all([
      this.supabase.client.from('cuadres').select('*').order('fecha', { ascending: false }),
      this.supabase.client.from('profiles').select('id, nombre, role, roles'),
      this.supabase.client
        .from('pedidos')
        .select('domiciliario_id, estado, entregado_at, total, metodo_pago, monto_efectivo, monto_transferencia, pago_domiciliario')
        .in('estado', ['entregado', 'en_ruta'])
        .is('cuadre_id', null)
        .not('domiciliario_id', 'is', null),
    ]);

    if (!abiertosRes.error && abiertosRes.data) {
      this.calcularSinCerrar(abiertosRes.data as any[]);
    }

    if (!cuadresRes.error && cuadresRes.data) {
      this.cuadres = cuadresRes.data as Cuadre[];
    }
    if (!perfilesRes.error && perfilesRes.data) {
      this.nombresPorId = new Map(perfilesRes.data.map((p: any) => [p.id, p.nombre]));
      this.domiciliarios = (perfilesRes.data as any[])
        .filter((p) => (p.roles ?? [p.role]).includes('domiciliario'))
        .map((p) => ({ id: p.id, nombre: p.nombre }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    }

    this.loading = false;
    this.cdr.detectChanges();
  }

  private calcularSinCerrar(filas: any[]): void {
    const grupos = new Map<string, SinCerrar>();
    const enRuta = new Map<string, number>();
    for (const p of filas) {
      if (p.estado === 'en_ruta') {
        enRuta.set(p.domiciliario_id, (enRuta.get(p.domiciliario_id) ?? 0) + 1);
        continue;
      }
      if (!p.entregado_at) continue;
      const fecha = diaColombiaDe(p.entregado_at);
      const clave = p.domiciliario_id + '|' + fecha;
      const g =
        grupos.get(clave) ??
        { domiciliarioId: p.domiciliario_id, fecha, pedidos: 0, efectivo: 0, transferencia: 0, pagoDomiciliario: 0, aEntregar: 0 };
      g.pedidos++;
      g.efectivo += efectivoDePedido(p);
      g.transferencia += transferenciaDePedido(p);
      g.pagoDomiciliario += Number(p.pago_domiciliario) || 0;
      g.aEntregar = g.efectivo - g.pagoDomiciliario;
      grupos.set(clave, g);
    }
    this.enRutaPorDom = enRuta;
    this.sinCerrar = Array.from(grupos.values()).sort(
      (a, b) => b.fecha.localeCompare(a.fecha) || this.nombreDomiciliario(a.domiciliarioId).localeCompare(this.nombreDomiciliario(b.domiciliarioId))
    );
  }

  get sinCerrarFiltrados(): SinCerrar[] {
    return this.sinCerrar.filter(
      (g) => this.domiciliarioId === 'todos' || g.domiciliarioId === this.domiciliarioId
    );
  }

  /** Cierra el cuadre en nombre del domiciliario (cuando él no lo hizo). */
  async cerrarPorDomiciliario(g: SinCerrar): Promise<void> {
    const nombre = this.nombreDomiciliario(g.domiciliarioId);
    const enRuta = g.fecha === this.hoy ? this.enRutaPorDom.get(g.domiciliarioId) ?? 0 : 0;
    const aviso = enRuta
      ? `\n\nOjo: todavía tiene ${enRuta} ${enRuta === 1 ? 'pedido' : 'pedidos'} en ruta; esos quedarán para otro cuadre.`
      : '';
    if (!confirm(`¿Cerrar el cuadre de ${nombre} del ${this.formatoFecha(g.fecha)}? Debe entregar ${this.formatoMoneda(g.aEntregar)}.${aviso}`)) {
      return;
    }
    const clave = g.domiciliarioId + '|' + g.fecha;
    this.cerrandoClave = clave;
    this.mensajeCierre = '';
    this.cdr.detectChanges();
    const { error } = await this.supabase.client.rpc('cerrar_cuadre', {
      p_fecha: g.fecha,
      p_domiciliario: g.domiciliarioId,
    });
    this.cerrandoClave = null;
    if (error) {
      this.mensajeCierre = error.message;
    } else {
      this.filtro = 'pendiente';
      this.fecha = g.fecha;
    }
    await this.cargarTodo();
  }

  claveDe(g: SinCerrar): string {
    return g.domiciliarioId + '|' + g.fecha;
  }

  /** Quién cerró el cuadre, si no fue el propio domiciliario. */
  cerradoPor(c: Cuadre): string | null {
    const por = c.cerrado_por;
    if (por === undefined || por === c.domiciliario_id) return null;
    if (por === null) return 'Cierre automático';
    return 'Cerró ' + (this.nombresPorId.get(por) ?? 'la oficina');
  }

  get filtrados(): Cuadre[] {
    return this.cuadres.filter((c) => {
      if (this.filtro !== 'todos' && c.estado !== this.filtro) return false;
      if (this.domiciliarioId !== 'todos' && c.domiciliario_id !== this.domiciliarioId) return false;
      if (this.fecha && c.fecha !== this.fecha) return false;
      return true;
    });
  }

  get pendientesCount(): number {
    return this.cuadres.filter((c) => c.estado === 'pendiente').length;
  }

  /** Cuadres pendientes que el filtro de fecha está ocultando. */
  get pendientesOtrosDias(): number {
    if (!this.fecha) return 0;
    return this.cuadres.filter(
      (c) =>
        c.estado === 'pendiente' &&
        c.fecha !== this.fecha &&
        (this.domiciliarioId === 'todos' || c.domiciliario_id === this.domiciliarioId)
    ).length;
  }

  irAHoy(): void {
    this.fecha = this.hoy;
  }

  verTodasLasFechas(): void {
    this.fecha = '';
  }

  verPendientesOtrosDias(): void {
    this.fecha = '';
    this.filtro = 'pendiente';
  }

  nombreDomiciliario(id: string): string {
    return this.nombresPorId.get(id) ?? 'Desconocido';
  }

  async toggleDetalle(cuadre: Cuadre): Promise<void> {
    if (this.expandidoId === cuadre.id) {
      this.expandidoId = null;
      return;
    }

    this.expandidoId = cuadre.id;

    if (!this.pedidosPorCuadre.has(cuadre.id)) {
      this.cargandoDetalle = true;
      this.cdr.detectChanges();

      const { data, error } = await this.supabase.client
        .from('pedidos')
        // '*' incluye monto_efectivo / monto_transferencia (pago mixto)
        .select('*')
        .eq('cuadre_id', cuadre.id)
        .order('numero');

      if (!error && data) {
        this.pedidosPorCuadre.set(cuadre.id, data as PedidoDelCuadre[]);
      }
      this.cargandoDetalle = false;
    }

    this.cdr.detectChanges();
  }

  pedidosDe(cuadreId: string): PedidoDelCuadre[] {
    return this.pedidosPorCuadre.get(cuadreId) ?? [];
  }

  efectivoDe(p: PedidoDelCuadre): number {
    return efectivoDePedido(p);
  }

  transferenciaDe(p: PedidoDelCuadre): number {
    return transferenciaDePedido(p);
  }

  previewUrl: string | null = null;

  async verComprobante(pedido: PedidoDelCuadre): Promise<void> {
    if (!pedido.comprobante_url) return;

    const { data, error } = await this.supabase.client.storage
      .from('comprobantes')
      .createSignedUrl(pedido.comprobante_url, 60);

    if (!error && data?.signedUrl) {
      this.previewUrl = data.signedUrl;
      this.cdr.detectChanges();
    }
  }

  cerrarPreview(): void {
    this.previewUrl = null;
  }

  async confirmarCuadre(cuadre: Cuadre): Promise<void> {
    this.confirmandoId = cuadre.id;
    const user = await this.supabase.getCurrentUser();

    const { error } = await this.supabase.client
      .from('cuadres')
      .update({
        estado: 'confirmado',
        confirmado_at: new Date().toISOString(),
        confirmado_por: user?.id ?? null,
      })
      .eq('id', cuadre.id);

    this.confirmandoId = null;

    if (!error) {
      await this.cargarTodo();
    } else {
      this.cdr.detectChanges();
    }
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  formatoFecha(fecha: string): string {
    return formatoFechaCO(fecha + 'T00:00:00-05:00', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}
