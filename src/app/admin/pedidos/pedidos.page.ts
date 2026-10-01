import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, searchOutline, ellipsisHorizontal, printOutline, close } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { EstadoPedido } from '../../shared/models/models';
import { EstadoIconComponent } from '../../shared/estado-icon/estado-icon.component';
import { ROTULO_LOGO_BASE64 } from '../rotulo-logo';

// Datos del negocio para el rótulo. Edítalos aquí, o si más adelante quieres
// cambiarlos desde la app sin tocar código, se puede mover a una tabla
// "configuracion" con una sola fila.
const NEGOCIO = {
  nombre: 'Variedades JYB',
  telefonos: '318 8156960 - 310 7425663',
  redes: '@variedadesjyb',
  garantia:
    'Todos nuestros productos cuentan con garantía. Guarda este documento ya que es el soporte para la garantía.',
};

interface PedidoFila {
  id: string;
  numero: number;
  vendedor_id: string;
  cliente_nombre: string;
  cliente_telefono: string | null;
  direccion: string;
  barrio: string | null;
  observaciones: string | null;
  estado: EstadoPedido;
  total: number;
  domiciliario_id: string | null;
  rotulo_impreso_at: string | null;
  created_at: string;
  productos: string;
}

interface Domiciliario {
  id: string;
  nombre: string;
}

interface GrupoPedidos {
  estado: EstadoPedido;
  etiqueta: string;
  pedidos: PedidoFila[];
  subtotal: number;
}

type FiltroEstado = 'todos' | EstadoPedido;
type FiltroRotulo = 'todos' | 'pendiente' | 'impreso';

// Orden en que se muestran los grupos en la vista "Todos"
const ORDEN_ESTADOS: EstadoPedido[] = ['pendiente', 'en_ruta', 'entregado', 'cancelado'];

@Component({
  selector: 'app-pedidos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonIcon, EstadoIconComponent],
  templateUrl: './pedidos.page.html',
  styleUrls: ['./pedidos.page.scss'],
})
export class PedidosPage implements OnInit, OnDestroy {
  loading = true;
  pedidos: PedidoFila[] = [];
  domiciliarios: Domiciliario[] = [];
  nombresPorId = new Map<string, string>();

  busqueda = '';
  filtroEstado: FiltroEstado = 'todos';
  filtroRotulo: FiltroRotulo = 'todos';
  guardandoId: string | null = null;
  asignandoLote = false;
  seleccionados = new Set<string>();
  menuAbiertoId: string | null = null;
  imprimiendo = false;

  // Esta misma página la usan admin y despachador (ver despachador.routes.ts)
  readonly rutaNuevo: string;
  readonly hoy = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  private canal: RealtimeChannel | null = null;

  readonly estados: { valor: FiltroEstado; etiqueta: string }[] = [
    { valor: 'todos', etiqueta: 'Todos' },
    { valor: 'pendiente', etiqueta: 'Por asignar' },
    { valor: 'en_ruta', etiqueta: 'En ruta' },
    { valor: 'entregado', etiqueta: 'Entregados' },
    { valor: 'cancelado', etiqueta: 'Cancelados' },
  ];

  private readonly etiquetasGrupo: Record<EstadoPedido, string> = {
    pendiente: 'Por asignar',
    en_ruta: 'En ruta',
    entregado: 'Entregados',
    cancelado: 'Cancelados',
  };

  constructor(
    private supabase: SupabaseService,
    private cdr: ChangeDetectorRef,
    route: ActivatedRoute
  ) {
    // Se lee de la ruta activa (no de router.url, que durante la navegación
    // todavía tiene la URL anterior)
    const ruta = route.snapshot.pathFromRoot
      .map((r) => r.url.map((s) => s.path).join('/'))
      .filter(Boolean)
      .join('/');
    this.rutaNuevo = ruta.startsWith('despachador')
      ? '/despachador/pedidos/nuevo'
      : '/admin/pedidos/nuevo';
    addIcons({ add, searchOutline, ellipsisHorizontal, printOutline, close });
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.cargarPedidos(), this.cargarDomiciliarios()]);
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('pedidos-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pedidos' },
        () => this.cargarPedidos()
      )
      .subscribe();
  }

  async cargarPedidos(): Promise<void> {
    // Solo mostramos el estado de carga la primera vez; las recargas por
    // realtime actualizan la lista sin parpadear.
    if (!this.pedidos.length) this.loading = true;

    const { data, error } = await this.supabase.client
      .from('pedidos')
      .select(
        'id, numero, vendedor_id, cliente_nombre, cliente_telefono, direccion, barrio, observaciones, estado, total, domiciliario_id, rotulo_impreso_at, created_at'
      )
      .order('created_at', { ascending: false });

    let pedidos = (data as any[]) ?? [];

    if (!error && pedidos.length) {
      const { data: items } = await this.supabase.client
        .from('pedido_items')
        .select('pedido_id, cantidad, producto:productos(nombre)')
        .in(
          'pedido_id',
          pedidos.map((p) => p.id)
        );

      pedidos = pedidos.map((p) => ({
        ...p,
        productos: (items ?? [])
          .filter((i: any) => i.pedido_id === p.id)
          .map((i: any) =>
            i.cantidad > 1
              ? `${i.producto?.nombre ?? 'Producto'} ×${i.cantidad}`
              : `${i.producto?.nombre ?? 'Producto'}`
          )
          .join(', '),
      }));
    }

    this.pedidos = pedidos as PedidoFila[];
    // Quita de la selección pedidos que ya no existen
    const ids = new Set(this.pedidos.map((p) => p.id));
    this.seleccionados.forEach((id) => !ids.has(id) && this.seleccionados.delete(id));

    this.loading = false;
    this.cdr.detectChanges();
  }

  async cargarDomiciliarios(): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, nombre, role');

    if (!error && data) {
      this.nombresPorId = new Map(data.map((p: any) => [p.id, p.nombre]));
      this.domiciliarios = (data as any[])
        .filter((p) => p.role === 'domiciliario')
        .map((p) => ({ id: p.id, nombre: p.nombre }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    }
    this.cdr.detectChanges();
  }

  nombreVendedor(id: string): string {
    return this.nombresPorId.get(id) ?? 'Desconocido';
  }

  /** Pedidos después de aplicar búsqueda y filtro de rótulo (sin el de estado). */
  private get base(): PedidoFila[] {
    let lista = this.pedidos;

    if (this.filtroRotulo === 'pendiente') {
      lista = lista.filter((p) => !p.rotulo_impreso_at);
    } else if (this.filtroRotulo === 'impreso') {
      lista = lista.filter((p) => !!p.rotulo_impreso_at);
    }

    const q = this.busqueda.trim().toLowerCase().replace(/^#/, '');
    if (q) {
      lista = lista.filter(
        (p) =>
          p.cliente_nombre.toLowerCase().includes(q) ||
          (p.barrio ?? '').toLowerCase().includes(q) ||
          String(p.numero).includes(q)
      );
    }
    return lista;
  }

  get filtrados(): PedidoFila[] {
    const base = this.base;
    return this.filtroEstado === 'todos' ? base : base.filter((p) => p.estado === this.filtroEstado);
  }

  conteo(valor: FiltroEstado): number {
    const base = this.base;
    return valor === 'todos' ? base.length : base.filter((p) => p.estado === valor).length;
  }

  get grupos(): GrupoPedidos[] {
    const lista = this.filtrados;
    return ORDEN_ESTADOS.map((estado) => {
      const pedidos = lista.filter((p) => p.estado === estado);
      return {
        estado,
        etiqueta: this.etiquetasGrupo[estado],
        pedidos,
        subtotal: pedidos.reduce((s, p) => s + Number(p.total || 0), 0),
      };
    }).filter((g) => g.pedidos.length);
  }

  trackPedido(_: number, p: PedidoFila): string {
    return p.id;
  }

  editable(p: PedidoFila): boolean {
    return p.estado !== 'entregado' && p.estado !== 'cancelado';
  }

  async asignarDomiciliario(pedido: PedidoFila, domiciliarioId: string | null): Promise<void> {
    // Un pedido ya entregado (o cancelado) no se puede reasignar: eso
    // rompería el cuadre y el historial de quién lo entregó de verdad.
    if (!this.editable(pedido)) {
      await this.cargarPedidos();
      return;
    }

    this.guardandoId = pedido.id;
    this.cdr.detectChanges();
    const { error } = await this.supabase.client
      .from('pedidos')
      .update({
        domiciliario_id: domiciliarioId || null,
        // Quitar el domiciliario devuelve el pedido a "por asignar"
        estado: domiciliarioId ? 'en_ruta' : 'pendiente',
      })
      .eq('id', pedido.id);

    this.guardandoId = null;

    if (!error) {
      await this.cargarPedidos();
    } else {
      alert('No se pudo asignar el domiciliario. ' + error.message);
      this.cdr.detectChanges();
    }
  }

  /** Asigna el mismo domiciliario a todos los pedidos seleccionados que aún se puedan asignar. */
  async asignarSeleccionados(domiciliarioId: string): Promise<void> {
    if (!domiciliarioId) return;
    const ids = this.pedidos
      .filter((p) => this.seleccionados.has(p.id) && this.editable(p))
      .map((p) => p.id);
    if (!ids.length) {
      alert('Los pedidos seleccionados ya están entregados o cancelados.');
      return;
    }

    this.asignandoLote = true;
    this.cdr.detectChanges();
    const { error } = await this.supabase.client
      .from('pedidos')
      .update({ domiciliario_id: domiciliarioId, estado: 'en_ruta' })
      .in('id', ids);
    this.asignandoLote = false;

    if (error) {
      alert('No se pudo asignar el domiciliario. ' + error.message);
      this.cdr.detectChanges();
      return;
    }
    this.seleccionados.clear();
    await this.cargarPedidos();
  }

  toggleMenu(id: string): void {
    this.menuAbiertoId = this.menuAbiertoId === id ? null : id;
  }

  async cancelarPedido(pedido: PedidoFila): Promise<void> {
    this.menuAbiertoId = null;
    if (!this.editable(pedido)) return;

    const confirmado = confirm(
      `¿Cancelar el pedido #${pedido.numero} de ${pedido.cliente_nombre}? Se devolverá el stock de los productos.`
    );
    if (!confirmado) return;

    const { error } = await this.supabase.client.rpc('cancelar_pedido', {
      p_pedido_id: pedido.id,
    });

    if (!error) {
      await this.cargarPedidos();
    } else {
      alert(error.message);
      this.cdr.detectChanges();
    }
  }

  async eliminarPedido(pedido: PedidoFila): Promise<void> {
    this.menuAbiertoId = null;
    if (pedido.estado === 'entregado') return;

    const confirmado = confirm(
      `¿Eliminar el pedido #${pedido.numero} de ${pedido.cliente_nombre}? Se devolverá el stock de los productos. Esta acción no se puede deshacer.`
    );
    if (!confirmado) return;

    const { error } = await this.supabase.client.rpc('eliminar_pedido', {
      p_pedido_id: pedido.id,
    });

    if (!error) {
      await this.cargarPedidos();
    } else {
      alert(error.message);
      this.cdr.detectChanges();
    }
  }

  nombreDomiciliario(id: string | null): string {
    if (!id) return 'Sin asignar';
    return this.domiciliarios.find((d) => d.id === id)?.nombre ?? this.nombresPorId.get(id) ?? 'Sin asignar';
  }

  iniciales(nombre: string | null | undefined): string {
    if (!nombre) return '';
    return nombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
  }

  etiquetaEstado(estado: EstadoPedido): string {
    return this.etiquetasGrupo[estado] ?? estado;
  }

  // --- Selección ---
  toggleSeleccion(id: string): void {
    if (this.seleccionados.has(id)) {
      this.seleccionados.delete(id);
    } else {
      this.seleccionados.add(id);
    }
  }

  get todosSeleccionados(): boolean {
    const lista = this.filtrados;
    return lista.length > 0 && lista.every((p) => this.seleccionados.has(p.id));
  }

  toggleSeleccionarTodos(): void {
    if (this.todosSeleccionados) {
      this.seleccionados.clear();
    } else {
      this.filtrados.forEach((p) => this.seleccionados.add(p.id));
    }
  }

  grupoSeleccionado(g: GrupoPedidos): boolean {
    return g.pedidos.every((p) => this.seleccionados.has(p.id));
  }

  toggleGrupo(g: GrupoPedidos): void {
    const todos = this.grupoSeleccionado(g);
    g.pedidos.forEach((p) => (todos ? this.seleccionados.delete(p.id) : this.seleccionados.add(p.id)));
  }

  limpiarSeleccion(): void {
    this.seleccionados.clear();
  }

  // --- Rótulos ---
  async imprimirRotulos(): Promise<void> {
    if (this.seleccionados.size === 0) return;

    this.imprimiendo = true;
    this.cdr.detectChanges();
    const ids = Array.from(this.seleccionados);

    // Traemos los items de cada pedido con el nombre del producto para el rótulo
    const { data: items, error } = await this.supabase.client
      .from('pedido_items')
      .select('pedido_id, cantidad, producto:productos(nombre)')
      .in('pedido_id', ids);

    if (error) {
      this.imprimiendo = false;
      alert('No se pudieron preparar los rótulos. ' + error.message);
      this.cdr.detectChanges();
      return;
    }

    const pedidosSeleccionados = this.pedidos.filter((p) => this.seleccionados.has(p.id));
    const html = this.construirHtmlRotulos(pedidosSeleccionados, items ?? []);

    const ventana = window.open('', '_blank');
    if (ventana) {
      ventana.document.write(html);
      ventana.document.close();
      ventana.focus();
      setTimeout(() => ventana.print(), 300);
    }

    // Se marca como impreso apenas se abre la ventana de impresión
    // (no hay forma confiable de detectar si el usuario canceló el diálogo)
    await this.supabase.client
      .from('pedidos')
      .update({ rotulo_impreso_at: new Date().toISOString() })
      .in('id', ids);

    this.seleccionados.clear();
    this.imprimiendo = false;
    await this.cargarPedidos();
  }

  private construirHtmlRotulos(pedidos: PedidoFila[], items: any[]): string {
    const rotulos = pedidos
      .map((p) => {
        const productos = items
          .filter((i) => i.pedido_id === p.id)
          .map((i) => `${i.producto?.nombre ?? 'Producto'} x${i.cantidad}`)
          .join('<br>');

        const fecha = new Date(p.created_at);
        const fechaStr = `${String(fecha.getDate()).padStart(2, '0')} / ${String(
          fecha.getMonth() + 1
        ).padStart(2, '0')} / ${fecha.getFullYear()}`;

        return `
        <div class="rotulo">
          <div class="rotulo-header">
            <img class="marca-logo" src="${ROTULO_LOGO_BASE64}" alt="${NEGOCIO.nombre}" />
            <div class="contacto">
              <div>${NEGOCIO.telefonos}</div>
              <div>${NEGOCIO.redes}</div>
            </div>
            <div class="fecha-box">${fechaStr}</div>
          </div>
          <div class="valor-cobrar">
            <span>VALOR A COBRAR:</span>
            <strong>${this.formatoMoneda(p.total)}</strong>
          </div>
          <table class="datos">
            <tr><td>Pedido:</td><td>#${p.numero}</td></tr>
            <tr><td>Nombre:</td><td>${p.cliente_nombre}</td></tr>
            <tr><td>Dirección:</td><td>${p.direccion}</td></tr>
            <tr><td>Barrio:</td><td>${p.barrio ?? '—'}</td></tr>
            <tr><td>Producto:</td><td>${productos || '—'}</td></tr>
            <tr><td>Celular:</td><td>${p.cliente_telefono ?? '—'}</td></tr>
            <tr><td>Observación:</td><td>${p.observaciones ?? '—'}</td></tr>
          </table>
          <p class="garantia">${NEGOCIO.garantia}</p>
        </div>
      `;
      })
      .join('');

    return `
      <html>
        <head>
          <title>Rótulos</title>
          <style>
            body { font-family: Arial, sans-serif; }
            .rotulo {
              width: 320px;
              border: 2px solid #000;
              border-radius: 14px;
              padding: 16px;
              margin: 0 auto 24px;
              page-break-after: always;
            }
            .rotulo-header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px; }
            .marca-logo { width: 64px; height: 64px; object-fit: contain; }
            .contacto { font-size: 11px; text-align: right; }
            .fecha-box { border: 1px solid #000; padding: 4px 8px; font-size: 11px; }
            .valor-cobrar { border: 1px solid #000; padding: 8px; margin-bottom: 10px; font-size: 14px; display: flex; justify-content: space-between; }
            .datos { width: 100%; font-size: 13px; border-collapse: collapse; }
            .datos td { padding: 3px 0; vertical-align: top; }
            .datos td:first-child { font-weight: bold; width: 90px; }
            .garantia { font-size: 10px; text-align: center; margin-top: 12px; border-top: 1px dashed #000; padding-top: 8px; }
          </style>
        </head>
        <body>${rotulos}</body>
      </html>
    `;
  }

  // --- Formatos ---
  formatoMoneda(valor: number): string {
    return Number(valor || 0).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  /** Hora si el pedido es de hoy; si no, día y mes. */
  formatoFecha(fecha: string): string {
    const d = new Date(fecha);
    const esHoy = d.toDateString() === new Date().toDateString();
    return esHoy
      ? d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }

  formatoFechaCompleta(fecha: string): string {
    return new Date(fecha).toLocaleString('es-CO', {
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}
