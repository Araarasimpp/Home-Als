import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, receiptOutline, cashOutline, phonePortraitOutline, swapHorizontalOutline, alertCircleOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { EstadoPedido, MetodoPago, efectivoDePedido, etiquetaMetodo, transferenciaDePedido } from '../../shared/models/models';
import { finDiaColombia, formatoFechaCO, formatoHoraCO, hoyColombiaISO, inicioDiaColombia } from '../../shared/fecha-colombia';
import { ImagenPreviewComponent } from '../../shared/imagen-preview/imagen-preview.component';

interface VentaLocal {
  id: string;
  numero: number;
  vendedor_id: string;
  cliente_nombre: string;
  estado: EstadoPedido;
  total: number;
  metodo_pago: MetodoPago | null;
  monto_efectivo: number | null;
  monto_transferencia: number | null;
  comprobante_url: string | null;
  observaciones: string | null;
  created_at: string;
  productos: string;
}

type FiltroMetodo = 'todos' | MetodoPago;

/**
 * Registro de las ventas del punto físico: qué se vendió, quién lo vendió,
 * a qué hora, cómo pagó el cliente y su comprobante (transferencia o mixto).
 * La usan admin, despachador y vendedor (cada uno con su ruta).
 */
@Component({
  selector: 'app-ventas-local',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonIcon, ImagenPreviewComponent],
  templateUrl: './ventas-local.page.html',
  styleUrls: ['../../shared/ui.scss', './ventas-local.page.scss'],
})
export class VentasLocalPage implements OnInit, OnDestroy {
  loading = true;
  errorMsg = '';
  ventas: VentaLocal[] = [];
  nombresPorId = new Map<string, string>();
  miId: string | null = null;

  fecha = hoyColombiaISO();
  filtroMetodo: FiltroMetodo = 'todos';
  readonly rutaNueva: string;

  previewUrl: string | null = null;
  abriendoId: string | null = null;

  private canal: RealtimeChannel | null = null;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef, route: ActivatedRoute) {
    this.rutaNueva = (route.snapshot.data['rutaNueva'] as string) ?? '../venta-local';
    addIcons({ add, receiptOutline, cashOutline, phonePortraitOutline, swapHorizontalOutline, alertCircleOutline });
  }

  async ngOnInit(): Promise<void> {
    const user = await this.supabase.getCurrentUser();
    this.miId = user?.id ?? null;
    await Promise.all([this.cargarNombres(), this.cargar()]);
    this.canal = this.supabase.client
      .channel('ventas-local-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        if (this.temporizador) clearTimeout(this.temporizador);
        this.temporizador = setTimeout(() => this.cargar(), 300);
      })
      .subscribe();
  }

  ngOnDestroy(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    if (this.canal) this.supabase.client.removeChannel(this.canal);
  }

  private async cargarNombres(): Promise<void> {
    const { data } = await this.supabase.client.from('profiles').select('id, nombre');
    this.nombresPorId = new Map((data ?? []).map((p: any) => [p.id, p.nombre]));
  }

  async cargar(): Promise<void> {
    if (!this.ventas.length) this.loading = true;
    this.errorMsg = '';
    const { data, error } = await this.supabase.client
      .from('pedidos')
      .select(
        'id, numero, vendedor_id, cliente_nombre, estado, total, metodo_pago, monto_efectivo, monto_transferencia, comprobante_url, observaciones, created_at, items:pedido_items(cantidad, producto:productos(nombre))'
      )
      .eq('canal', 'local')
      .gte('created_at', inicioDiaColombia(this.fecha).toISOString())
      .lte('created_at', finDiaColombia(this.fecha).toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      this.errorMsg = 'No se pudieron cargar las ventas. Revisa tu conexión.';
    } else {
      this.ventas = ((data ?? []) as any[]).map((v) => ({
        ...v,
        productos: ((v.items ?? []) as any[])
          .map((i) => {
            const nombre = i.producto?.nombre ?? 'Producto';
            return Number(i.cantidad) > 1 ? `${nombre} ×${i.cantidad}` : nombre;
          })
          .join(', '),
      }));
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  cambiarFecha(valor: string): void {
    this.fecha = valor || hoyColombiaISO();
    this.ventas = [];
    this.cargar();
  }

  irAHoy(): void {
    this.cambiarFecha(hoyColombiaISO());
  }

  get esHoy(): boolean {
    return this.fecha === hoyColombiaISO();
  }

  get fechaTexto(): string {
    return formatoFechaCO(inicioDiaColombia(this.fecha).toISOString(), { weekday: 'long', day: 'numeric', month: 'long' });
  }

  /** Las canceladas se listan pero no suman. */
  private get vigentes(): VentaLocal[] {
    return this.ventas.filter((v) => v.estado !== 'cancelado');
  }

  get filtradas(): VentaLocal[] {
    return this.filtroMetodo === 'todos' ? this.ventas : this.ventas.filter((v) => v.metodo_pago === this.filtroMetodo);
  }

  get totalVendido(): number {
    return this.vigentes.reduce((s, v) => s + Number(v.total), 0);
  }

  get totalEfectivo(): number {
    return this.vigentes.reduce((s, v) => s + efectivoDePedido(v), 0);
  }

  get totalTransferencia(): number {
    return this.vigentes.reduce((s, v) => s + transferenciaDePedido(v), 0);
  }

  get sinComprobante(): number {
    return this.vigentes.filter((v) => this.pideComprobante(v) && !v.comprobante_url).length;
  }

  conteo(m: FiltroMetodo): number {
    return m === 'todos' ? this.ventas.length : this.ventas.filter((v) => v.metodo_pago === m).length;
  }

  pideComprobante(v: VentaLocal): boolean {
    return v.metodo_pago === 'transferencia' || v.metodo_pago === 'mixto';
  }

  vendedor(id: string): string {
    if (id === this.miId) return 'Tú';
    return this.nombresPorId.get(id) ?? '—';
  }

  hora(iso: string): string {
    return formatoHoraCO(iso);
  }

  metodo(m: MetodoPago | null): string {
    return etiquetaMetodo(m);
  }

  icono(m: MetodoPago | null): string {
    return m === 'transferencia' ? 'phone-portrait-outline' : m === 'mixto' ? 'swap-horizontal-outline' : 'cash-outline';
  }

  efectivo(v: VentaLocal): number {
    return efectivoDePedido(v);
  }

  transferencia(v: VentaLocal): number {
    return transferenciaDePedido(v);
  }

  async verComprobante(v: VentaLocal): Promise<void> {
    if (!v.comprobante_url || this.abriendoId) return;
    this.abriendoId = v.id;
    const { data, error } = await this.supabase.client.storage
      .from('comprobantes')
      .createSignedUrl(v.comprobante_url, 60);
    this.abriendoId = null;
    if (!error && data?.signedUrl) {
      this.previewUrl = data.signedUrl;
    } else {
      this.errorMsg = 'No se pudo abrir el comprobante.';
    }
    this.cdr.detectChanges();
  }

  formatoMoneda(valor: number): string {
    return (Number(valor) || 0).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  trackVenta(_: number, v: VentaLocal): string {
    return v.id;
  }
}
