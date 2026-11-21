// Recolector (como en jasta): recibe bases de dinero durante el día (las manda
// el admin y él las acepta, o las agrega él mismo diciendo de dónde vienen) y
// registra cada compra con valor, proveedor, producto y foto de la factura.
// Cada día cuadra solo: base − compras − lo que ya le entregó al admin.
// El admin ve una tarjeta por recolector y recibe la plata; el despachador
// solo mira.
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addCircleOutline,
  arrowDownCircleOutline,
  bagHandleOutline,
  cashOutline,
  checkmarkOutline,
  chevronBackOutline,
  chevronForwardOutline,
  closeOutline,
  cubeOutline,
  receiptOutline,
  refreshOutline,
  trashOutline,
  walletOutline,
} from 'ionicons/icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { AvatarComponent } from '../avatar/avatar.component';
import { BarraEstadoComponent } from '../graficas/barra-estado.component';
import { Segmento } from '../graficas/dona.component';
import { FotosInputComponent, urlsComprobantes } from '../comprobantes/fotos-input.component';
import { ImagenPreviewComponent } from '../imagen-preview/imagen-preview.component';
import { SobreTodoDirective } from '../sobre-todo.directive';
import { EsqueletoComponent } from '../esqueleto/esqueleto.component';
import { diaCorto, mensajeError, pesos, sumarDias } from '../formato';
import { diaColombiaDe, formatoFechaCO, formatoHoraCO, hoyColombiaISO } from '../fecha-colombia';

interface PendienteBase { id: string; monto: number; nombre: string; de: string | null; recolector: string; fecha: string }
interface PorRecolector { id: string; nombre: string; avatar_url: string | null; base: number; compras: number; entregado: number; pendientes: number; saldo: number }
interface Movimiento {
  tipo: 'base' | 'compra' | 'entrega';
  id: string;
  fecha: string;
  valor: number;
  nombre: string | null;
  estado: 'pendiente' | 'aceptada' | 'rechazada' | null;
  quien: string | null;
  recolector: string;
  proveedor: string | null;
  producto: string | null;
  facturas: string[] | null;
  dia: string | null;
}
interface Resumen {
  base: number;
  compras: number;
  entregado: number;
  saldo: number | null;
  dias_sin_entregar: { id: string; nombre: string; dia: string; falta: number }[];
  por_recolector: PorRecolector[];
  n_bases: number;
  n_compras: number;
  pendientes: PendienteBase[];
  movimientos: Movimiento[];
  recolectores: { id: string; nombre: string }[];
}
interface ProdCosto { id: string; nombre: string; sku: string | null; imagen_url: string | null; costo: number | null }

const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

@Component({
  selector: 'app-recolector',
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, AvatarComponent, BarraEstadoComponent, FotosInputComponent, ImagenPreviewComponent, SobreTodoDirective, EsqueletoComponent],
  templateUrl: './recolector.page.html',
  styleUrls: ['../hoja.scss', './recolector.page.scss'],
})
export class RecolectorPage implements OnInit, OnDestroy {
  private supabase = inject(SupabaseService);

  readonly pesos = pesos;

  rol = computed(() => this.supabase.perfil()?.role ?? null);
  admin = computed(() => this.rol() === 'admin');
  /** Admin y despachador ven a todos los recolectores */
  veTodos = computed(() => this.rol() === 'admin' || this.rol() === 'despachador');
  esRecolector = computed(() => this.rol() === 'recolector');
  soloLectura = computed(() => this.rol() === 'despachador');
  miId = computed(() => this.supabase.perfil()?.id ?? null);

  dia = signal(hoyColombiaISO());
  esHoy = computed(() => this.dia() === hoyColombiaISO());
  r = signal<Resumen | null>(null);
  cargando = signal(true);
  ocupado = signal(false);
  errorMsg = signal('');
  errorForm = signal('');
  fotos = signal<Record<string, string>>({});
  visor = signal<string | null>(null);
  filtroRec = signal<string | null>(null);

  /** Lo que quedó del día: base − compras (lo entregado se resta aparte) */
  cuadre = computed(() => Number(this.r()?.base ?? 0) - Number(this.r()?.compras ?? 0));
  vistaTodos = computed(() => this.veTodos() && !this.filtroRec() && (this.r()?.por_recolector?.length ?? 0) > 0);
  nombreFiltro = computed(() => this.r()?.recolectores.find((x) => x.id === this.filtroRec())?.nombre ?? '');

  /** Barra: en qué se fue la base del día */
  barraDia = computed<Segmento[]>(() => {
    const r = this.r();
    if (!r) return [];
    const base = Number(r.base);
    const compras = Number(r.compras);
    const entregado = Number(r.entregado);
    const queda = Math.max(0, base - compras - entregado);
    return [
      { etiqueta: 'Compras', valor: compras, color: 'var(--data-terracota)' },
      { etiqueta: 'Entregado', valor: entregado, color: 'var(--data-green)' },
      { etiqueta: 'En la mano', valor: queda, color: 'var(--data-orange)' },
    ];
  });

  // Base
  formBase = signal(false);
  baseMonto: number | null = null;
  baseNombre = '';
  baseRec: string | null = null;
  enviaBase = computed(() => this.admin());

  // Compra
  formCompra = signal(false);
  deInventario = signal(true);
  private prods = signal<ProdCosto[]>([]);
  buscaProd = signal('');
  prodSel = signal<ProdCosto | null>(null);
  compraCant = signal<number | null>(null);
  compraCosto = signal<number | null>(null);
  compraValor: number | null = null;
  compraProveedor = '';
  compraProducto = '';
  compraFacturas = signal<string[]>([]);
  totalInv = computed(() => (Number(this.compraCant()) || 0) * (Number(this.compraCosto()) || 0));
  sugerencias = computed(() => {
    const t = normal(this.buscaProd());
    if (t.length < 2) return [];
    return this.prods().filter((p) => normal(p.nombre).includes(t) || normal(p.sku ?? '').includes(t)).slice(0, 8);
  });
  carpeta = computed(() => `recoleccion/${this.miId() ?? 'x'}`);

  // Recibir
  recibirDe = signal<{ id: string; nombre: string; saldo: number } | null>(null);
  recibirValor: number | null = null;
  recibirNota = '';
  recibirDia = '';

  private canal: RealtimeChannel | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private consulta = 0;

  constructor() {
    addIcons({
      addCircleOutline,
      arrowDownCircleOutline,
      bagHandleOutline,
      cashOutline,
      checkmarkOutline,
      chevronBackOutline,
      chevronForwardOutline,
      closeOutline,
      cubeOutline,
      receiptOutline,
      refreshOutline,
      trashOutline,
      walletOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    if (!this.supabase.perfil()) await this.supabase.getCurrentProfile();
    await this.cargar();
    // Una base enviada o aceptada (o una compra) aparece sola
    const recargar = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.cargar(), 500);
    };
    this.canal = this.supabase.client
      .channel('recoleccion-' + Math.random().toString(36).slice(2, 8))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recoleccion_bases' }, recargar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recoleccion_compras' }, recargar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recoleccion_entregas' }, recargar)
      .subscribe();
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    if (this.canal) void this.supabase.client.removeChannel(this.canal);
  }

  async cargar(): Promise<void> {
    const n = ++this.consulta;
    const { data, error } = await this.supabase.client.rpc('recoleccion_resumen', {
      p_desde: this.dia(),
      p_hasta: this.dia(),
      p_recolector: this.veTodos() ? this.filtroRec() : null,
    });
    if (n !== this.consulta) return;
    this.cargando.set(false);
    if (error) {
      this.errorMsg.set(mensajeError(error));
      return;
    }
    this.errorMsg.set('');
    const r = data as Resumen;
    this.r.set(r);
    // Miniaturas de las facturas (privadas: enlace firmado)
    const faltan = r.movimientos.flatMap((m) => m.facturas ?? []).filter((f) => !this.fotos()[f]);
    if (faltan.length) {
      const urls = await urlsComprobantes(this.supabase.client, faltan);
      this.fotos.update((m) => ({ ...m, ...Object.fromEntries(faltan.map((f, i) => [f, urls[i]])) }));
    }
  }

  // ---------- Día ----------
  moverDia(n: number): void {
    const d = sumarDias(this.dia(), n);
    if (d > hoyColombiaISO()) return;
    this.dia.set(d);
    void this.cargar();
  }

  ponerDia(d: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > hoyColombiaISO()) return;
    this.dia.set(d);
    void this.cargar();
  }

  verRecolector(id: string | null): void {
    this.filtroRec.set(id);
    void this.cargar();
  }

  // ---------- Bases ----------
  abrirBase(): void {
    this.baseMonto = null;
    this.baseNombre = '';
    const lista = this.r()?.recolectores ?? [];
    this.baseRec = this.filtroRec() ?? lista[0]?.id ?? null;
    this.errorForm.set('');
    this.formBase.set(true);
  }

  async guardarBase(): Promise<void> {
    const monto = Math.round(Number(this.baseMonto) || 0);
    if (monto <= 0) return this.errorForm.set('Escribe el valor de la base.');
    if (!this.baseNombre.trim()) return this.errorForm.set('Ponle nombre a la base (de dónde viene).');
    if (this.admin() && !this.baseRec) return this.errorForm.set('Elige para quién es la base.');
    this.ocupado.set(true);
    const { error } = await this.supabase.client.rpc('recoleccion_agregar_base', {
      p_monto: monto,
      p_nombre: this.baseNombre.trim(),
      p_recolector: this.admin() ? this.baseRec : null,
    });
    this.ocupado.set(false);
    if (error) return this.errorForm.set(mensajeError(error));
    this.formBase.set(false);
    await this.cargar();
  }

  async responder(p: PendienteBase, aceptar: boolean): Promise<void> {
    if (!aceptar && !confirm(`¿Rechazar la base de ${pesos(p.monto)} (${p.nombre})?`)) return;
    this.ocupado.set(true);
    const { error } = await this.supabase.client.rpc('recoleccion_responder_base', { p_base: p.id, p_aceptar: aceptar });
    this.ocupado.set(false);
    if (error) {
      this.errorMsg.set(mensajeError(error));
      return;
    }
    await this.cargar();
  }

  // ---------- Compras ----------
  async abrirCompra(): Promise<void> {
    this.compraValor = null;
    this.compraProveedor = '';
    this.compraProducto = '';
    this.compraFacturas.set([]);
    this.deInventario.set(true);
    this.buscaProd.set('');
    this.prodSel.set(null);
    this.compraCant.set(null);
    this.compraCosto.set(null);
    this.errorForm.set('');
    this.formCompra.set(true);
    if (!this.prods().length) {
      const { data } = await this.supabase.client.from('productos').select('id, nombre, sku, imagen_url, costo').eq('activo', true).order('nombre');
      this.prods.set((data ?? []) as ProdCosto[]);
    }
  }

  elegirProd(p: ProdCosto): void {
    this.prodSel.set(p);
    this.buscaProd.set('');
    this.compraCant.set(1);
    this.compraCosto.set(p.costo ? Number(p.costo) : null);
    this.errorForm.set('');
  }

  async guardarCompra(): Promise<void> {
    let args: Record<string, unknown>;
    if (this.deInventario()) {
      const p = this.prodSel();
      if (!p) return this.errorForm.set('Busca y elige el producto que compraste.');
      const cant = Math.round(Number(this.compraCant()) || 0);
      const costo = Math.round(Number(this.compraCosto()) || 0);
      if (cant <= 0) return this.errorForm.set('Escribe cuántos compraste.');
      if (costo <= 0) return this.errorForm.set('Escribe cuánto te costó cada uno.');
      args = { p_valor: cant * costo, p_producto: `${cant} × ${p.nombre}`, p_producto_id: p.id, p_cantidad: cant, p_costo: costo };
    } else {
      const valor = Math.round(Number(this.compraValor) || 0);
      if (valor <= 0) return this.errorForm.set('Escribe el valor de la compra.');
      if (!this.compraProducto.trim()) return this.errorForm.set('Escribe qué compraste.');
      args = { p_valor: valor, p_producto: this.compraProducto.trim() };
    }
    if (!this.compraProveedor.trim()) return this.errorForm.set('Escribe el proveedor.');
    if (!this.compraFacturas().length) return this.errorForm.set('Sube la foto de la factura.');
    this.ocupado.set(true);
    const { error } = await this.supabase.client.rpc('recoleccion_registrar_compra', {
      ...args,
      p_proveedor: this.compraProveedor.trim(),
      p_facturas: this.compraFacturas(),
    });
    this.ocupado.set(false);
    if (error) return this.errorForm.set(mensajeError(error));
    const p = this.prodSel();
    if (p && this.deInventario()) this.prods.update((l) => l.map((x) => (x.id === p.id ? { ...x, costo: this.compraCosto() } : x)));
    this.formCompra.set(false);
    await this.cargar();
  }

  puedeQuitarCompra(): boolean {
    return this.admin() || (this.esRecolector() && this.esHoy());
  }

  async borrarCompra(m: Movimiento): Promise<void> {
    if (!confirm(`¿Quitar la compra "${m.producto}" de ${pesos(m.valor)}? La plata vuelve a contar en la base.`)) return;
    const { error } = await this.supabase.client.rpc('recoleccion_borrar_compra', { p_id: m.id });
    if (error) {
      this.errorMsg.set(mensajeError(error));
      return;
    }
    await this.cargar();
  }

  // ---------- Recibir (admin) ----------
  abrirRecibir(x: { id: string; nombre: string; saldo: number }, dia = this.dia()): void {
    this.recibirDia = dia;
    this.recibirValor = Number(x.saldo) > 0 ? Number(x.saldo) : null;
    this.recibirNota = '';
    this.errorForm.set('');
    this.recibirDe.set({ id: x.id, nombre: x.nombre, saldo: Number(x.saldo) });
  }

  abrirRecibirSel(): void {
    const id = this.filtroRec();
    if (!id) return;
    this.abrirRecibir({ id, nombre: this.nombreFiltro() || 'el recolector', saldo: Number(this.r()?.saldo ?? 0) });
  }

  async guardarRecibir(): Promise<void> {
    const x = this.recibirDe();
    const v = Math.round(Number(this.recibirValor) || 0);
    if (!x) return;
    if (v <= 0) return this.errorForm.set('Escribe cuánto recibiste.');
    this.ocupado.set(true);
    const { error } = await this.supabase.client.rpc('recoleccion_recibir', {
      p_recolector: x.id,
      p_valor: v,
      p_nota: this.recibirNota.trim(),
      p_dia: this.recibirDia || this.dia(),
    });
    this.ocupado.set(false);
    if (error) return this.errorForm.set(mensajeError(error));
    this.recibirDe.set(null);
    await this.cargar();
  }

  async borrarEntrega(m: Movimiento): Promise<void> {
    if (!confirm(`¿Borrar lo recibido de ${m.recolector} (${pesos(m.valor)})? Vuelve a contar como plata que debe tener.`)) return;
    const { error } = await this.supabase.client.rpc('recoleccion_borrar_entrega', { p_id: m.id });
    if (error) {
      this.errorMsg.set(mensajeError(error));
      return;
    }
    await this.cargar();
  }

  // ---------- Fotos ----------
  async verFactura(m: Movimiento): Promise<void> {
    const f = m.facturas?.[0];
    if (!f) return;
    const u = this.fotos()[f] || (await urlsComprobantes(this.supabase.client, [f]))[0];
    if (u) this.visor.set(u);
  }

  // ---------- Textos ----------
  diaTexto(d: string): string {
    if (!d) return '';
    const hoy = hoyColombiaISO();
    if (d === hoy) return 'hoy';
    if (d === sumarDias(hoy, -1)) return 'ayer';
    return new Date(d + 'T12:00:00Z').toLocaleDateString('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' }).replace('.', '');
  }

  mayus(t: string): string {
    return t ? t[0].toUpperCase() + t.slice(1) : t;
  }

  hora(iso: string): string {
    return formatoHoraCO(iso);
  }

  cuando(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' }).replace('.', '') + ' ' + formatoHoraCO(iso);
  }

  diaDe(iso: string): string {
    return diaColombiaDe(iso);
  }

  corto(d: string): string {
    return diaCorto(d);
  }

  hoy(): string {
    return hoyColombiaISO();
  }

  primerNombre(n: string): string {
    return (n ?? '').split(' ')[0];
  }
}
