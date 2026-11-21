// Pagos de comisiones (como en jasta). El admin ve lo que se le debe a cada
// vendedor por los pedidos CREADOS en la semana (sábado a viernes) que ya se
// entregaron, registra el pago con su comprobante y ve el historial. El
// vendedor ve lo que tiene por cobrar y los pagos que le han hecho.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  cardOutline,
  cashOutline,
  checkmarkCircleOutline,
  chevronBackOutline,
  chevronDownOutline,
  chevronForwardOutline,
  chevronUpOutline,
  closeOutline,
  documentTextOutline,
  ellipsisHorizontalCircleOutline,
  refreshOutline,
  walletOutline,
} from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { AvatarComponent } from '../avatar/avatar.component';
import { DonaComponent, Segmento } from '../graficas/dona.component';
import { FotosInputComponent, urlsComprobantes } from '../comprobantes/fotos-input.component';
import { ImagenPreviewComponent } from '../imagen-preview/imagen-preview.component';
import { SobreTodoDirective } from '../sobre-todo.directive';
import { EsqueletoComponent } from '../esqueleto/esqueleto.component';
import { diaCorto, mensajeError, pesos, pesosCorto, sumarDias } from '../formato';
import { finDiaColombia, formatoFechaCO, formatoHoraCO, hoyColombiaISO, inicioDiaColombia } from '../fecha-colombia';

type Metodo = 'transferencia' | 'efectivo' | 'otro';

interface Pendiente {
  vendedor_id: string;
  nombre: string;
  avatar_url: string | null;
  pedidos: number;
  total: number;
  anteriores: number;
  desde: string | null;
  hasta: string | null;
}

interface PedidoComision {
  id: string;
  numero: number;
  dia: string;
  cliente_nombre: string;
  total: number;
  comision: number;
}

interface Pago {
  id: string;
  numero: number;
  vendedor_id: string;
  vendedor: { nombre: string; avatar_url: string | null } | null;
  desde: string;
  hasta: string;
  cantidad_pedidos: number;
  total: number;
  metodo: Metodo;
  comprobantes: string[];
  nota: string | null;
  pagado_at: string;
  pagado_por_nombre: string | null;
  anulado: boolean;
}

const METODOS: { id: Metodo; label: string; icon: string }[] = [
  { id: 'transferencia', label: 'Transferencia', icon: 'card-outline' },
  { id: 'efectivo', label: 'Efectivo', icon: 'cash-outline' },
  { id: 'otro', label: 'Otro', icon: 'ellipsis-horizontal-circle-outline' },
];

const COLORES = ['var(--data-green)', 'var(--data-orange)', 'var(--data-terracota)', 'var(--data-slate)', 'var(--data-green-soft)'];

/** Última semana completa de sábado a viernes (así se pagan las comisiones) */
function semanaPasada(): { desde: string; hasta: string } {
  const hoy = hoyColombiaISO();
  const dow = new Date(hoy + 'T12:00:00Z').getUTCDay(); // 0 domingo … 5 viernes, 6 sábado
  const hasta = sumarDias(hoy, -(((dow - 5 + 7) % 7) || 7));
  return { desde: sumarDias(hasta, -6), hasta };
}

type Historial = 'mes' | 'anterior' | 'todo';

@Component({
  selector: 'app-pagos',
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, AvatarComponent, DonaComponent, FotosInputComponent, ImagenPreviewComponent, SobreTodoDirective, EsqueletoComponent],
  templateUrl: './pagos.page.html',
  styleUrls: ['../hoja.scss', './pagos.page.scss'],
})
export class PagosPage implements OnInit {
  private supabase = inject(SupabaseService);
  private ruta = inject(ActivatedRoute);
  private router = inject(Router);

  readonly pesos = pesos;
  readonly pesosCorto = pesosCorto;
  readonly metodos = METODOS;

  esAdmin = computed(() => this.supabase.perfil()?.role === 'admin');
  miId = computed(() => this.supabase.perfil()?.id ?? null);

  // Periodo (semana de sábado a viernes)
  desdeP = signal(semanaPasada().desde);
  hastaP = signal(semanaPasada().hasta);
  esSemanaPasada = computed(() => this.desdeP() === semanaPasada().desde && this.hastaP() === semanaPasada().hasta);

  pendientes = signal<Pendiente[]>([]);
  cargando = signal(true);
  errorMsg = signal('');
  mio = computed(() => this.pendientes().find((p) => p.vendedor_id === this.miId()) ?? null);
  totalPeriodo = computed(() => this.pendientes().reduce((s, p) => s + Number(p.total), 0));
  totalAnteriores = computed(() => this.pendientes().reduce((s, p) => s + Number(p.anteriores), 0));
  pedidosPeriodo = computed(() => this.pendientes().reduce((s, p) => s + Number(p.pedidos), 0));
  conDeuda = computed(() => this.pendientes().filter((p) => Number(p.total) > 0));

  /** Dona: cuánto se le debe a cada vendedor en el periodo */
  dona = computed<Segmento[]>(() => {
    const lista = this.conDeuda()
      .map((p) => ({ etiqueta: p.nombre.split(' ').slice(0, 2).join(' '), valor: Number(p.total) }))
      .sort((a, b) => b.valor - a.valor);
    const top = lista.slice(0, 4).map((x, i) => ({ ...x, color: COLORES[i] }));
    const resto = lista.slice(4).reduce((s, x) => s + x.valor, 0);
    return resto ? [...top, { etiqueta: 'Otros', valor: resto, color: COLORES[4] }] : top;
  });

  // "Se cuentan desde"
  desdeGuardado = signal('');
  contarDesde = '';

  // Pedidos de un vendedor (desplegados)
  abiertoV = signal<string | null>(null);
  pedidosV = signal<PedidoComision[]>([]);
  cargandoPedidos = signal(false);

  // Historial
  historial = signal<Pago[]>([]);
  tipoHistorial = signal<Historial>('mes');
  fotos = signal<Record<string, string>>({});
  pagadoHistorial = computed(() => this.historial().filter((l) => !l.anulado).reduce((s, l) => s + Number(l.total), 0));

  // Registrar pago
  pagando = signal<Pendiente | null>(null);
  pedidosPago = signal<PedidoComision[]>([]);
  pagoMetodo = signal<Metodo>('transferencia');
  pagoSoportes = signal<string[]>([]);
  pagoNota = '';
  ocupado = signal(false);
  errorHoja = signal('');
  aPagar = computed(() => ({ n: this.pedidosPago().length, total: this.pedidosPago().reduce((s, p) => s + Number(p.comision), 0) }));

  // Detalle y soporte
  detalle = signal<Pago | null>(null);
  pedidosDet = signal<PedidoComision[]>([]);
  soporteDe = signal<Pago | null>(null);
  soporteFotos = signal<string[]>([]);
  visor = signal<string | null>(null);

  constructor() {
    addIcons({
      alertCircleOutline,
      cardOutline,
      cashOutline,
      checkmarkCircleOutline,
      chevronBackOutline,
      chevronDownOutline,
      chevronForwardOutline,
      chevronUpOutline,
      closeOutline,
      documentTextOutline,
      ellipsisHorizontalCircleOutline,
      refreshOutline,
      walletOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    if (!this.supabase.perfil()) await this.supabase.getCurrentProfile();
    void this.cargarPendientes();
    void this.cargarHistorial();
    if (this.esAdmin()) {
      const { data } = await this.supabase.client.from('configuracion').select('comisiones_desde').limit(1).maybeSingle();
      this.contarDesde = (data as any)?.comisiones_desde ?? '';
      this.desdeGuardado.set(this.contarDesde);
    }
    // Desde el aviso "Te pagaron…" se abre ese pago
    const pago = this.ruta.snapshot.queryParamMap.get('pago');
    if (pago) void this.abrirPagoPorId(pago);
  }

  async actualizar(): Promise<void> {
    await Promise.all([this.cargarPendientes(), this.cargarHistorial()]);
  }

  // ---------- Periodo ----------
  cambiarPeriodo(campo: 'desde' | 'hasta', v: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    if (campo === 'desde') {
      this.desdeP.set(v);
      if (v > this.hastaP()) this.hastaP.set(v);
    } else {
      this.hastaP.set(v);
      if (v < this.desdeP()) this.desdeP.set(v);
    }
    void this.cargarPendientes();
  }

  moverSemana(dias: number): void {
    this.desdeP.set(sumarDias(this.desdeP(), dias));
    this.hastaP.set(sumarDias(this.hastaP(), dias));
    void this.cargarPendientes();
  }

  irSemanaPasada(): void {
    this.desdeP.set(semanaPasada().desde);
    this.hastaP.set(semanaPasada().hasta);
    void this.cargarPendientes();
  }

  private consulta = 0;

  private async cargarPendientes(): Promise<void> {
    const n = ++this.consulta;
    this.errorMsg.set('');
    const { data, error } = await this.supabase.client.rpc('comisiones_periodo', { p_desde: this.desdeP(), p_hasta: this.hastaP() });
    if (n !== this.consulta) return;
    this.cargando.set(false);
    if (error) {
      this.errorMsg.set(mensajeError(error));
      return;
    }
    this.pendientes.set(((data ?? []) as Pendiente[]).map((p) => ({ ...p, total: Number(p.total), anteriores: Number(p.anteriores), pedidos: Number(p.pedidos) })));
    // El vendedor ve de una vez sus pedidos por cobrar
    const yo = this.miId();
    if (!this.esAdmin() && yo && this.mio()) this.pedidosV.set(await this.pedidosDe(yo));
    else if (this.abiertoV()) this.pedidosV.set(await this.pedidosDe(this.abiertoV()!));
  }

  private async pedidosDe(vendedor: string, pago: string | null = null): Promise<PedidoComision[]> {
    const args = pago
      ? { p_vendedor: vendedor, p_pago: pago }
      : { p_vendedor: vendedor, p_desde: this.desdeP(), p_hasta: this.hastaP() };
    const { data, error } = await this.supabase.client.rpc('comision_pedidos', args);
    if (error) {
      this.errorMsg.set(mensajeError(error));
      return [];
    }
    return (data ?? []) as PedidoComision[];
  }

  async verPedidos(id: string): Promise<void> {
    if (this.abiertoV() === id) {
      this.abiertoV.set(null);
      return;
    }
    this.pedidosV.set([]);
    this.abiertoV.set(id);
    this.cargandoPedidos.set(true);
    this.pedidosV.set(await this.pedidosDe(id));
    this.cargandoPedidos.set(false);
  }

  async guardarDesde(): Promise<void> {
    if (!this.contarDesde) return;
    if (!confirm(`¿Contar comisiones de los pedidos creados desde el ${diaCorto(this.contarDesde)}? Lo de antes se toma como ya pagado.`)) return;
    const { error } = await this.supabase.client.rpc('guardar_comisiones_desde', { p_dia: this.contarDesde });
    if (error) {
      alert(mensajeError(error));
      return;
    }
    this.desdeGuardado.set(this.contarDesde);
    await this.cargarPendientes();
  }

  // ---------- Historial ----------
  cambiarHistorial(t: Historial): void {
    this.tipoHistorial.set(t);
    void this.cargarHistorial();
  }

  private async cargarHistorial(): Promise<void> {
    const hoy = hoyColombiaISO();
    const inicioMes = hoy.slice(0, 8) + '01';
    let q = this.supabase.client
      .from('pagos_comision')
      .select('*, vendedor:profiles!pagos_comision_vendedor_id_fkey(nombre, avatar_url)')
      .order('pagado_at', { ascending: false })
      .limit(200);
    const t = this.tipoHistorial();
    if (t === 'mes') q = q.gte('pagado_at', inicioDiaColombia(inicioMes).toISOString());
    if (t === 'anterior') {
      const finAnterior = sumarDias(inicioMes, -1);
      q = q.gte('pagado_at', inicioDiaColombia(finAnterior.slice(0, 8) + '01').toISOString()).lte('pagado_at', finDiaColombia(finAnterior).toISOString());
    }
    const { data, error } = await q;
    if (error) {
      this.errorMsg.set(mensajeError(error));
      return;
    }
    const lista = (data ?? []) as unknown as Pago[];
    this.historial.set(lista);
    await this.cargarFotos(lista.flatMap((l) => l.comprobantes.slice(0, 1)));
  }

  private async cargarFotos(rutas: string[]): Promise<void> {
    const faltan = rutas.filter((f) => !this.fotos()[f]);
    if (!faltan.length) return;
    const urls = await urlsComprobantes(this.supabase.client, faltan);
    this.fotos.update((m) => ({ ...m, ...Object.fromEntries(faltan.map((f, i) => [f, urls[i]])) }));
  }

  // ---------- Registrar pago ----------
  async abrirPago(c: Pendiente): Promise<void> {
    this.pagoMetodo.set('transferencia');
    this.pagoSoportes.set([]);
    this.pagoNota = `Semana del ${diaCorto(this.desdeP())} al ${diaCorto(this.hastaP())}`;
    this.errorHoja.set('');
    this.pedidosPago.set([]);
    this.pagando.set(c);
    this.pedidosPago.set(await this.pedidosDe(c.vendedor_id));
  }

  cerrarPago(): void {
    this.pagando.set(null);
  }

  async pagar(): Promise<void> {
    const c = this.pagando();
    if (!c) return;
    const { n, total } = this.aPagar();
    if (!n) return this.errorHoja.set('No hay pedidos por pagar en estas fechas.');
    if (this.pagoMetodo() === 'transferencia' && !this.pagoSoportes().length) return this.errorHoja.set('Sube el comprobante de la transferencia.');
    if (!confirm(`¿Registrar el pago de ${pesos(total)} a ${c.nombre}? (${n} ${n === 1 ? 'pedido' : 'pedidos'})`)) return;
    this.ocupado.set(true);
    const { error } = await this.supabase.client.rpc('pagar_comisiones', {
      p_vendedor: c.vendedor_id,
      p_desde: this.desdeP(),
      p_hasta: this.hastaP(),
      p_metodo: this.pagoMetodo(),
      p_comprobantes: this.pagoSoportes(),
      p_nota: this.pagoNota.trim(),
    });
    this.ocupado.set(false);
    if (error) return this.errorHoja.set(mensajeError(error));
    this.pagando.set(null);
    this.abiertoV.set(null);
    await this.actualizar();
  }

  async anular(l: Pago): Promise<void> {
    if (!confirm(`¿Anular el pago de ${pesos(l.total)} a ${l.vendedor?.nombre ?? 'el vendedor'}? Sus ${l.cantidad_pedidos} pedidos vuelven a quedar por pagar.`)) return;
    const { error } = await this.supabase.client.rpc('anular_pago_comision', { p_id: l.id });
    if (error) {
      alert(mensajeError(error));
      return;
    }
    this.detalle.set(null);
    await this.actualizar();
  }

  // ---------- Detalle ----------
  async verDetalle(l: Pago): Promise<void> {
    this.pedidosDet.set([]);
    this.detalle.set(l);
    void this.cargarFotos(l.comprobantes);
    this.pedidosDet.set(await this.pedidosDe(l.vendedor_id, l.id));
  }

  cerrarDetalle(): void {
    this.detalle.set(null);
    if (this.ruta.snapshot.queryParamMap.has('pago')) void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  private async abrirPagoPorId(id: string): Promise<void> {
    const { data } = await this.supabase.client
      .from('pagos_comision')
      .select('*, vendedor:profiles!pagos_comision_vendedor_id_fkey(nombre, avatar_url)')
      .eq('id', id)
      .maybeSingle();
    if (data) await this.verDetalle(data as unknown as Pago);
  }

  abrirSoporte(l: Pago): void {
    this.soporteFotos.set([]);
    this.errorHoja.set('');
    this.soporteDe.set(l);
  }

  async guardarSoporte(): Promise<void> {
    const l = this.soporteDe();
    if (!l) return;
    this.ocupado.set(true);
    const { error } = await this.supabase.client.rpc('agregar_soporte_pago', { p_id: l.id, p_comprobantes: this.soporteFotos() });
    this.ocupado.set(false);
    if (error) return this.errorHoja.set(mensajeError(error));
    this.soporteDe.set(null);
    await this.cargarHistorial();
    const d = this.detalle();
    if (d?.id === l.id) this.detalle.set(this.historial().find((x) => x.id === l.id) ?? d);
  }

  async verFoto(ruta: string): Promise<void> {
    const u = this.fotos()[ruta] || (await urlsComprobantes(this.supabase.client, [ruta]))[0];
    if (u) this.visor.set(u);
  }

  // ---------- Textos ----------
  periodo(desde: string | null, hasta: string | null): string {
    if (!desde) return '—';
    return !hasta || hasta === desde ? diaCorto(desde) : `${diaCorto(desde)} – ${diaCorto(hasta)}`;
  }

  dia(d: string): string {
    return diaCorto(d);
  }

  metodo(m: string): string {
    return METODOS.find((x) => x.id === m)?.label ?? m;
  }

  iconoMetodo(m: string): string {
    return METODOS.find((x) => x.id === m)?.icon ?? 'wallet-outline';
  }

  cuando(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' }).replace('.', '') + ' · ' + formatoHoraCO(iso);
  }

  numero(n: number): string {
    return 'CE-' + String(n).padStart(4, '0');
  }

  primerNombre(n: string): string {
    return (n ?? '').split(' ')[0];
  }
}
