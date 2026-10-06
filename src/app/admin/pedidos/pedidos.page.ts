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
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { ImagenPreviewComponent } from '../../shared/imagen-preview/imagen-preview.component';
import { urlImagen } from '../../shared/imagenes/url-imagen';
import { cargarDatosNegocio, documentoRotulos, imprimirEnVentana, rotuloHtml } from '../../shared/rotulo/rotulo';

interface PedidoFila {
  id: string;
  numero: number;
  vendedor_id: string;
  cliente_nombre: string;
  cliente_telefono: string | null;
  direccion: string;
  barrio: string | null;
  observaciones: string | null;
  canal: 'domicilio' | 'local';
  estado: EstadoPedido;
  total: number;
  domiciliario_id: string | null;
  rotulo_impreso_at: string | null;
  created_at: string;
  productos: string;
  items: ItemPedido[];
}

interface ItemPedido {
  nombre: string;
  cantidad: number;
  imagen_url: string | null;
}

interface Domiciliario {
  id: string;
  nombre: string;
  avatar_url: string | null;
}

interface GrupoPedidos {
  estado: EstadoPedido;
  etiqueta: string;
  pedidos: PedidoFila[];
  subtotal: number;
}

type FiltroEstado = 'todos' | EstadoPedido;
type FiltroRotulo = 'todos' | 'pendiente' | 'impreso';
type FiltroCanal = 'domicilio' | 'local' | 'todos';

// Orden en que se muestran los grupos en la vista "Todos"
const ORDEN_ESTADOS: EstadoPedido[] = ['pendiente', 'en_ruta', 'entregado', 'cancelado'];

@Component({
  selector: 'app-pedidos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonIcon, EstadoIconComponent, AvatarComponent, ImagenPreviewComponent],
  templateUrl: './pedidos.page.html',
  styleUrls: ['./pedidos.page.scss'],
})
export class PedidosPage implements OnInit, OnDestroy {
  loading = true;
  pedidos: PedidoFila[] = [];
  domiciliarios: Domiciliario[] = [];
  nombresPorId = new Map<string, string>();

  busqueda = '';
  // Se abre en Pendientes: es lo que hay que atender primero
  filtroEstado: FiltroEstado = 'pendiente';
  /** Imagen de producto abierta en grande. */
  imagenAmpliada: string | null = null;
  filtroRotulo: FiltroRotulo = 'todos';
  /** Domicilios por defecto; las ventas del punto físico se ven aparte. */
  filtroCanal: FiltroCanal = 'domicilio';
  guardandoId: string | null = null;
  asignandoLote = false;
  seleccionados = new Set<string>();
  menuAbiertoId: string | null = null;
  imprimiendo = false;

  // Esta misma página la usan admin y despachador (ver despachador.routes.ts)
  readonly rutaNuevo: string;
  readonly rutaBase: string;
  readonly hoy = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  private canal: RealtimeChannel | null = null;
  // Control de recargas: nunca dos cargas a la vez, y los eventos de realtime
  // que llegan seguidos se agrupan en una sola recarga.
  private cargando = false;
  private recargaPendiente = false;
  private temporizadorRealtime: ReturnType<typeof setTimeout> | null = null;

  readonly estados: { valor: FiltroEstado; etiqueta: string }[] = [
    { valor: 'pendiente', etiqueta: 'Pendientes' },
    { valor: 'en_ruta', etiqueta: 'En ruta' },
    { valor: 'entregado', etiqueta: 'Entregados' },
    { valor: 'cancelado', etiqueta: 'Cancelados' },
    { valor: 'todos', etiqueta: 'Todos' },
  ];

  private readonly etiquetasGrupo: Record<EstadoPedido, string> = {
    pendiente: 'Pendientes',
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
    this.rutaBase = ruta.startsWith('despachador') ? '/despachador' : '/admin';
    this.rutaNuevo = this.rutaBase + '/pedidos/nuevo';
    addIcons({ add, searchOutline, ellipsisHorizontal, printOutline, close });
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.cargarPedidos(), this.cargarDomiciliarios()]);
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.temporizadorRealtime) clearTimeout(this.temporizadorRealtime);
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
        () => this.programarRecarga()
      )
      .subscribe();
  }

  private programarRecarga(): void {
    if (this.temporizadorRealtime) clearTimeout(this.temporizadorRealtime);
    this.temporizadorRealtime = setTimeout(() => {
      this.temporizadorRealtime = null;
      this.cargarPedidos();
    }, 250);
  }

  async cargarPedidos(): Promise<void> {
    if (this.cargando) {
      // Ya hay una carga en curso: se repite una vez cuando termine
      this.recargaPendiente = true;
      return;
    }
    this.cargando = true;
    try {
      await this.cargarPedidosAhora();
    } finally {
      this.cargando = false;
    }
    if (this.recargaPendiente) {
      this.recargaPendiente = false;
      await this.cargarPedidos();
    }
  }

  private async cargarPedidosAhora(): Promise<void> {
    // Solo mostramos el estado de carga la primera vez; las recargas por
    // realtime actualizan la lista sin parpadear.
    if (!this.pedidos.length) this.loading = true;

    const { data, error } = await this.supabase.client
      .from('pedidos')
      .select(
        'id, numero, vendedor_id, cliente_nombre, cliente_telefono, direccion, barrio, observaciones, canal, estado, total, domiciliario_id, rotulo_impreso_at, created_at'
      )
      .order('created_at', { ascending: false });

    let pedidos = (data as any[]) ?? [];

    if (!error && pedidos.length) {
      const { data: items } = await this.supabase.client
        .from('pedido_items')
        .select('pedido_id, cantidad, producto:productos(nombre, imagen_url)')
        .in(
          'pedido_id',
          pedidos.map((p) => p.id)
        );

      pedidos = pedidos.map((p) => {
        const propios: ItemPedido[] = (items ?? [])
          .filter((i: any) => i.pedido_id === p.id)
          .map((i: any) => ({
            nombre: i.producto?.nombre ?? 'Producto',
            cantidad: Number(i.cantidad) || 1,
            imagen_url: urlImagen(i.producto?.imagen_url),
          }));
        return {
          ...p,
          items: propios,
          productos: propios
            .map((i) => (i.cantidad > 1 ? `${i.nombre} ×${i.cantidad}` : i.nombre))
            .join(', '),
        };
      });
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
      // '*' para incluir avatar_url sin fallar si la columna aún no existe
      .select('*');

    if (!error && data) {
      this.nombresPorId = new Map(data.map((p: any) => [p.id, p.nombre]));
      this.domiciliarios = (data as any[])
        .filter((p) => p.role === 'domiciliario')
        .map((p) => ({ id: p.id, nombre: p.nombre, avatar_url: p.avatar_url ?? null }))
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

    if (this.filtroCanal !== 'todos') {
      lista = lista.filter((p) => (p.canal ?? 'domicilio') === this.filtroCanal);
    }

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
          (p.productos ?? '').toLowerCase().includes(q) ||
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

  /** Productos que se muestran con foto; el resto se resume como "+N más". */
  readonly maxProductosVisibles = 3;

  verImagen(url: string | null, evento: Event): void {
    evento.stopPropagation();
    if (url) this.imagenAmpliada = url;
  }

  inicial(nombre: string): string {
    return (nombre.trim()[0] ?? '?').toUpperCase();
  }

  trackPedido(_: number, p: PedidoFila): string {
    return p.id;
  }

  editable(p: PedidoFila): boolean {
    return p.estado !== 'entregado' && p.estado !== 'cancelado';
  }

  /** Solo se dispara cuando una persona elige una opción en el select. */
  onCambioDomiciliario(pedido: PedidoFila, evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    this.asignarDomiciliario(pedido, valor || null);
  }

  onAsignarLote(evento: Event): void {
    const select = evento.target as HTMLSelectElement;
    const valor = select.value;
    select.value = ''; // vuelve a mostrar "Asignar domiciliario"
    this.asignarSeleccionados(valor);
  }

  async asignarDomiciliario(pedido: PedidoFila, domiciliarioId: string | null): Promise<void> {
    // Sin cambio real, no se escribe nada. Esto evita además cualquier ciclo
    // escritura → realtime → recarga → escritura.
    if ((domiciliarioId || null) === (pedido.domiciliario_id || null)) return;
    if (this.guardandoId) return;

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
    if (!domiciliarioId || this.asignandoLote) return;
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

  /** Las ventas en local nacen entregadas: al verlas se muestran todas. */
  onCambioCanal(): void {
    if (this.filtroCanal === 'local') {
      this.filtroEstado = 'todos';
      this.filtroRotulo = 'todos';
    } else if (this.filtroEstado === 'todos') {
      this.filtroEstado = 'pendiente';
    }
    this.seleccionados.clear();
  }

  rutaEditar(p: PedidoFila): string {
    return `${this.rutaBase}/pedidos/${p.id}/editar`;
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

  fotoDomiciliario(id: string | null): string | null {
    if (!id) return null;
    return this.domiciliarios.find((d) => d.id === id)?.avatar_url ?? null;
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

    // La ventana se abre antes de cualquier await: si se abre después, el
    // navegador la trata como ventana emergente y la bloquea.
    const ventana = window.open('', '_blank');
    if (!ventana) {
      alert('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio.');
      return;
    }
    ventana.document.write('<p style="font-family:sans-serif;padding:24px">Preparando rótulos…</p>');

    this.imprimiendo = true;
    this.cdr.detectChanges();
    const ids = Array.from(this.seleccionados);

    // Productos de cada pedido y datos del negocio (de Configuración), en paralelo
    const [{ data: items, error }, negocio] = await Promise.all([
      this.supabase.client
        .from('pedido_items')
        .select('pedido_id, cantidad, producto:productos(nombre)')
        .in('pedido_id', ids),
      cargarDatosNegocio(this.supabase.client),
    ]);

    if (error) {
      ventana.close();
      this.imprimiendo = false;
      alert('No se pudieron preparar los rótulos. ' + error.message);
      this.cdr.detectChanges();
      return;
    }

    const rotulos = this.pedidos
      .filter((p) => this.seleccionados.has(p.id) && p.canal !== 'local')
      .map((p) =>
        rotuloHtml(
          {
            ...p,
            productos: (items ?? [])
              .filter((i: any) => i.pedido_id === p.id)
              .map((i: any) => `${i.producto?.nombre ?? 'Producto'} x${i.cantidad}`),
          },
          negocio
        )
      );

    // Imprime y cierra la ventana sola al terminar
    imprimirEnVentana(ventana, documentoRotulos(rotulos));

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
