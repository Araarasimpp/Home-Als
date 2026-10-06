import { ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, remove, searchOutline, chevronBackOutline, trashOutline, checkmark, close, cashOutline, phonePortraitOutline, swapHorizontalOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { MetodoPago, Producto } from '../../shared/models/models';
import { urlImagen } from '../../shared/imagenes/url-imagen';

interface ItemCarrito {
  producto: Producto;
  cantidad: number;
  // Precio al que se vende ESTE pedido. Arranca en precio_sugerido, pero el
  // vendedor lo puede subir si vende más caro — ahí su comisión sube también.
  precioUnitario: number;
}

interface Zona {
  id: string;
  nombre: string;
  valor: number;
  pago_domiciliario?: number;
}

/** Datos del pedido que se está editando (modo edición). */
interface PedidoEditado {
  id: string;
  numero: number;
  canal: 'domicilio' | 'local';
  estado: string;
  cuadre_id: string | null;
}

@Component({
  selector: 'app-nuevo-pedido',
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon],
  templateUrl: './nuevo-pedido.page.html',
  styleUrls: ['../../shared/ui.scss', './nuevo-pedido.page.scss'],
})
export class NuevoPedidoPage implements OnInit {
  loadingProductos = true;
  productos: Producto[] = [];
  busquedaProducto = '';

  carrito: ItemCarrito[] = [];

  clienteNombre = '';
  clienteTelefono = '';
  direccion = '';
  barrio = '';
  zonas: Zona[] = [];
  valorDomicilio: number = 0;
  observaciones = '';

  guardando = false;
  errorMsg = '';
  /** Se activa al intentar crear: desde ahí se marcan los campos obligatorios vacíos. */
  intentoEnviar = false;
  /** Número del pedido recién creado (muestra la confirmación). */
  creado: number | null = null;

  mostrarSugerenciasBarrio = false;

  /**
   * Venta en punto físico (ruta con data.canal = 'local'): sin dirección,
   * barrio ni domicilio; se registra entregada y con el método de pago.
   */
  esLocal: boolean;

  /** Modo edición (ruta pedidos/:id/editar, solo admin y despachador). */
  readonly pedidoId: string | null;
  pedidoEditado: PedidoEditado | null = null;
  cargandoPedido = false;
  /** Lo que se le paga al domiciliario (solo se edita en modo edición). */
  pagoDomiciliario = 0;
  /** Cantidades originales del pedido: se suman al stock disponible al editar. */
  private cantidadesOriginales = new Map<string, number>();
  metodoPago: MetodoPago | null = null;
  montoEfectivo: number | null = null;

  /** Fotos que no cargaron (se muestra la inicial en su lugar). */
  private fotosRotas = new Set<string>();
  /** Foto ampliada en el visor. */
  fotoAbierta: { src: string; nombre: string; precio: string } | null = null;

  /** Cliente que ya compró antes con este teléfono (base de clientes). */
  clienteEncontrado: { nombre: string; direccion: string | null; barrio: string | null; pedidos: number; ultima_compra: string | null } | null = null;
  datosClienteUsados = false;
  private temporizadorTelefono: ReturnType<typeof setTimeout> | null = null;
  private ultimoTelefonoBuscado = '';

  /**
   * Porcentaje de la ganancia si quien crea el pedido es "vendedor por
   * porcentaje"; null si cobra por margen (lo que venda sobre el precio base).
   * Es solo una vista previa: la comisión real la calcula la base de datos.
   */
  porcentajeComision: number | null = null;

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {
    this.esLocal = this.route.snapshot.data['canal'] === 'local';
    this.pedidoId = this.route.snapshot.paramMap.get('id');
    addIcons({ add, remove, searchOutline, chevronBackOutline, trashOutline, checkmark, close, cashOutline, phonePortraitOutline, swapHorizontalOutline });
  }

  async ngOnInit(): Promise<void> {
    const [perfil] = await Promise.all([
      this.supabase.getCurrentProfile(),
      this.cargarProductos(),
      this.cargarZonas(),
    ]);
    if (perfil?.role === 'vendedor' && perfil.comision_tipo === 'porcentaje') {
      this.porcentajeComision = Number(perfil.comision_porcentaje ?? 50);
    }
    if (this.pedidoId) {
      await this.cargarPedidoEditado(this.pedidoId);
    }
    this.cdr.detectChanges();
  }

  async cargarZonas(): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('zonas_domicilio')
      .select('*')
      .order('nombre');

    if (!error && data) {
      this.zonas = data;
    }
    this.cdr.detectChanges();
  }

  get esEdicion(): boolean {
    return !!this.pedidoId;
  }

  get titulo(): string {
    if (this.pedidoEditado) {
      return (this.esLocal ? 'Editar venta #' : 'Editar pedido #') + this.pedidoEditado.numero;
    }
    if (this.esEdicion) return 'Editar pedido';
    return this.esLocal ? 'Venta en local' : 'Nuevo pedido';
  }

  /** El método de pago se pide en ventas de local y al editar un pedido ya entregado. */
  get pidePago(): boolean {
    return this.esLocal || this.pedidoEditado?.estado === 'entregado';
  }

  /** Carga el pedido a editar y llena el formulario con sus datos. */
  private async cargarPedidoEditado(id: string): Promise<void> {
    this.cargandoPedido = true;
    const { data: p, error } = await this.supabase.client
      .from('pedidos')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !p) {
      this.errorMsg = 'No se encontró el pedido.';
      this.cargandoPedido = false;
      return;
    }
    const { data: items } = await this.supabase.client
      .from('pedido_items')
      .select(
        'cantidad, precio_unitario, producto:productos(id, nombre, sku, descripcion, categoria, precio_base, precio_sugerido, costo, stock, imagen_url, activo)'
      )
      .eq('pedido_id', id);

    this.pedidoEditado = {
      id: p.id,
      numero: p.numero,
      canal: p.canal ?? 'domicilio',
      estado: p.estado,
      cuadre_id: p.cuadre_id,
    };
    this.esLocal = this.pedidoEditado.canal === 'local';
    this.clienteNombre = this.esLocal && p.cliente_nombre === 'Cliente en local' ? '' : p.cliente_nombre ?? '';
    this.clienteTelefono = p.cliente_telefono ?? '';
    this.ultimoTelefonoBuscado = (p.cliente_telefono ?? '').replace(/\D/g, '');
    this.direccion = this.esLocal ? '' : p.direccion ?? '';
    this.barrio = p.barrio ?? '';
    this.valorDomicilio = Number(p.valor_domicilio) || 0;
    this.pagoDomiciliario = Number(p.pago_domiciliario) || 0;
    this.observaciones = p.observaciones ?? '';
    this.metodoPago = p.metodo_pago ?? null;
    this.montoEfectivo = p.metodo_pago === 'mixto' ? Number(p.monto_efectivo) : null;

    // Lo que ya está en el pedido vuelve a estar disponible mientras se edita
    this.cantidadesOriginales.clear();
    for (const it of (items ?? []) as any[]) {
      if (!it.producto) continue;
      const pid = it.producto.id as string;
      this.cantidadesOriginales.set(pid, (this.cantidadesOriginales.get(pid) ?? 0) + Number(it.cantidad));
      if (!this.productos.some((x) => x.id === pid)) {
        this.productos.push({ ...(it.producto as Producto) });
      }
    }
    this.ajustarStockOriginal();
    this.carrito = ((items ?? []) as any[])
      .filter((it) => it.producto)
      .map((it) => ({
        producto: this.productos.find((x) => x.id === it.producto.id)!,
        cantidad: Number(it.cantidad),
        precioUnitario: Number(it.precio_unitario),
      }));
    this.productos.sort((a, b) => a.nombre.localeCompare(b.nombre));
    this.cargandoPedido = false;
  }

  /** Suma al stock de cada producto lo que ya tenía reservado este pedido. */
  private ajustarStockOriginal(): void {
    for (const prod of this.productos) {
      const extra = this.cantidadesOriginales.get(prod.id);
      if (extra) prod.stock = Number(prod.stock) + extra;
    }
  }

  /** Al escribir el teléfono, busca si el cliente ya existe. */
  onTelefono(valor: string): void {
    this.clienteTelefono = valor;
    if (this.esEdicion) return;
    if (this.temporizadorTelefono) clearTimeout(this.temporizadorTelefono);
    const digitos = valor.replace(/\D/g, '');
    if (digitos.length < 7) {
      this.clienteEncontrado = null;
      return;
    }
    this.temporizadorTelefono = setTimeout(() => this.buscarCliente(digitos), 400);
  }

  private async buscarCliente(digitos: string): Promise<void> {
    if (digitos === this.ultimoTelefonoBuscado) return;
    this.ultimoTelefonoBuscado = digitos;
    const { data, error } = await this.supabase.client.rpc('buscar_cliente', { p_telefono: digitos });
    // Si el SQL de clientes aún no se ejecutó, simplemente no se sugiere nada
    const c = !error && Array.isArray(data) && data.length ? data[0] : null;
    this.clienteEncontrado = c ? { ...c, pedidos: Number(c.pedidos || 0) } : null;
    this.datosClienteUsados = false;
    // Si los campos están vacíos, se llenan solos
    if (this.clienteEncontrado && !this.clienteNombre.trim() && (this.esLocal || !this.direccion.trim())) {
      this.usarDatosCliente();
    }
    this.cdr.detectChanges();
  }

  usarDatosCliente(): void {
    const c = this.clienteEncontrado;
    if (!c) return;
    this.clienteNombre = c.nombre;
    if (this.esLocal) {
      this.datosClienteUsados = true;
      return;
    }
    this.direccion = c.direccion ?? this.direccion;
    if (c.barrio) {
      this.barrio = c.barrio;
      const zona = this.zonas.find((z) => z.nombre.trim().toLowerCase() === c.barrio!.trim().toLowerCase());
      if (zona) this.valorDomicilio = zona.valor;
    }
    this.datosClienteUsados = true;
  }

  fechaCorta(iso: string | null): string {
    return iso
      ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' })
      : '';
  }

  get sugerenciasBarrio(): Zona[] {
    const q = this.barrio.trim().toLowerCase();
    if (!q) return this.zonas;
    return this.zonas.filter((z) => z.nombre.toLowerCase().includes(q));
  }

  seleccionarZona(zona: Zona): void {
    this.barrio = zona.nombre;
    this.valorDomicilio = zona.valor;
    if (this.esEdicion && zona.pago_domiciliario != null) {
      this.pagoDomiciliario = Number(zona.pago_domiciliario);
    }
    this.mostrarSugerenciasBarrio = false;
  }

  cerrarSugerenciasBarrio(): void {
    // pequeño retraso para que el (mousedown) de la opción alcance a
    // dispararse antes de que el blur del input cierre la lista
    setTimeout(() => (this.mostrarSugerenciasBarrio = false), 150);
  }

  volver(): void {
    const volverA = (this.route.snapshot.data['volverA'] as string) ?? '/vendedor';
    this.router.navigateByUrl(volverA);
  }

  async cargarProductos(): Promise<void> {
    this.loadingProductos = true;
    const { data, error } = await this.supabase.client
      .from('productos')
      .select(
        'id, nombre, sku, descripcion, categoria, precio_base, precio_sugerido, costo, stock, imagen_url, activo'
      )
      .eq('activo', true)
      .gt('stock', 0)
      .order('nombre');

    if (!error && data) {
      this.productos = data as Producto[];
    }
    this.loadingProductos = false;
    this.cdr.detectChanges();
  }

  get productosFiltrados(): Producto[] {
    if (!this.busquedaProducto.trim()) return this.productos;
    const q = this.busquedaProducto.trim().toLowerCase();
    return this.productos.filter(
      (p) => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }

  // Cuánto de un producto ya está en el carrito (para no dejar agregar más del stock disponible)
  cantidadEnCarrito(productoId: string): number {
    return this.carrito.find((i) => i.producto.id === productoId)?.cantidad ?? 0;
  }

  agregarProducto(producto: Producto): void {
    const existente = this.carrito.find((i) => i.producto.id === producto.id);

    if (existente) {
      if (existente.cantidad < producto.stock) {
        existente.cantidad++;
      }
    } else {
      this.carrito.push({ producto, cantidad: 1, precioUnitario: producto.precio_sugerido });
    }
    this.errorMsg = '';
  }

  incrementar(item: ItemCarrito): void {
    if (item.cantidad < item.producto.stock) {
      item.cantidad++;
    }
  }

  decrementar(item: ItemCarrito): void {
    item.cantidad--;
    if (item.cantidad <= 0) {
      this.quitarDelCarrito(item);
    }
  }

  quitarDelCarrito(item: ItemCarrito): void {
    this.carrito = this.carrito.filter((i) => i.producto.id !== item.producto.id);
  }

  /** Ganancia de la tienda en este item: venta − costo (sin costo, se usa el precio base). */
  gananciaDe(item: ItemCarrito): number {
    const costo = item.producto.costo ?? item.producto.precio_base;
    return item.cantidad * (Number(item.precioUnitario) - costo);
  }

  // Comisión que deja ESTE item con el precio actual.
  //  - Por margen: lo que se cobre por encima del precio base.
  //  - Por porcentaje: ese porcentaje de la ganancia de la tienda.
  comisionDe(item: ItemCarrito): number {
    if (this.porcentajeComision !== null) {
      return Math.round((this.gananciaDe(item) * this.porcentajeComision) / 100);
    }
    return item.cantidad * (item.precioUnitario - item.producto.precio_base);
  }

  get productosSinCosto(): number {
    return this.carrito.filter((i) => i.producto.costo == null).length;
  }

  get unidades(): number {
    return this.carrito.reduce((s, i) => s + i.cantidad, 0);
  }

  get subtotal(): number {
    return this.carrito.reduce((sum, i) => sum + i.cantidad * i.precioUnitario, 0);
  }

  get comisionTotal(): number {
    const total = this.carrito.reduce((sum, i) => sum + this.comisionDe(i), 0);
    // Por porcentaje, si el pedido deja pérdida la comisión es 0 (igual que en la base de datos)
    return this.porcentajeComision !== null ? Math.max(0, total) : total;
  }

  get total(): number {
    return this.subtotal + (this.esLocal ? 0 : Number(this.valorDomicilio) || 0);
  }

  get montoTransferencia(): number {
    return Math.max(0, this.total - (Number(this.montoEfectivo) || 0));
  }

  elegirMetodo(m: MetodoPago): void {
    this.metodoPago = m;
    if (m !== 'mixto') this.montoEfectivo = null;
  }

  get textoBoton(): string {
    if (this.esEdicion) return this.guardando ? 'Guardando…' : 'Guardar cambios';
    if (this.guardando) return this.esLocal ? 'Registrando…' : 'Creando…';
    return this.esLocal ? 'Registrar venta' : 'Crear pedido';
  }

  async onCrearPedido(): Promise<void> {
    if (this.guardando) return;
    this.errorMsg = '';
    this.intentoEnviar = true;

    if (this.carrito.length === 0) {
      this.errorMsg = 'Agrega al menos un producto al pedido.';
      return;
    }

    if (!this.esLocal && (!this.clienteNombre.trim() || !this.direccion.trim())) {
      this.errorMsg = 'Falta el nombre del cliente o la dirección.';
      return;
    }

    if (this.pidePago) {
      if (!this.metodoPago) {
        this.errorMsg = 'Indica cómo pagó el cliente.';
        return;
      }
      const efectivo = Number(this.montoEfectivo);
      if (this.metodoPago === 'mixto' && !(efectivo >= 0 && efectivo <= this.total && this.montoEfectivo !== null)) {
        this.errorMsg = 'En pago mixto, escribe cuánto fue en efectivo (entre $0 y el total).';
        return;
      }
    }

    if (this.carrito.some((i) => !(Number(i.precioUnitario) > 0))) {
      this.errorMsg = 'Revisa los precios: ningún producto puede quedar en $0.';
      return;
    }

    this.guardando = true;
    this.cdr.detectChanges();

    if (this.esEdicion) {
      await this.guardarEdicion();
      return;
    }

    const items = this.carrito.map((i) => ({
      producto_id: i.producto.id,
      cantidad: i.cantidad,
      precio_unitario: Number(i.precioUnitario),
    }));

    const { data, error } = await this.supabase.client.rpc('crear_pedido', {
      p_cliente_nombre: this.clienteNombre.trim() || null,
      p_cliente_telefono: this.clienteTelefono.trim() || null,
      p_direccion: this.esLocal ? null : this.direccion.trim(),
      p_barrio: this.esLocal ? null : this.barrio.trim() || null,
      p_valor_domicilio: this.esLocal ? 0 : Number(this.valorDomicilio) || 0,
      p_observaciones: this.observaciones.trim() || null,
      p_items: items,
      p_canal: this.esLocal ? 'local' : 'domicilio',
      p_metodo_pago: this.esLocal ? this.metodoPago : null,
      p_monto_efectivo: this.esLocal && this.metodoPago === 'mixto' ? Number(this.montoEfectivo) : null,
    });

    this.guardando = false;

    if (error) {
      // error.message trae el texto exacto del raise exception en Postgres,
      // por ejemplo "Stock insuficiente para el producto ...: disponible 2, solicitado 5"
      this.errorMsg = error.message;
      this.cdr.detectChanges();
      return;
    }

    this.creado = data as number;
    this.cdr.detectChanges();
  }

  private async guardarEdicion(): Promise<void> {
    const datos: Record<string, unknown> = {
      cliente_nombre: this.clienteNombre.trim(),
      cliente_telefono: this.clienteTelefono.trim(),
      observaciones: this.observaciones.trim(),
    };
    if (!this.esLocal) {
      datos['direccion'] = this.direccion.trim();
      datos['barrio'] = this.barrio.trim();
      datos['valor_domicilio'] = Number(this.valorDomicilio) || 0;
      datos['pago_domiciliario'] = Number(this.pagoDomiciliario) || 0;
    }
    if (this.pidePago) {
      datos['metodo_pago'] = this.metodoPago;
      if (this.metodoPago === 'mixto') datos['monto_efectivo'] = Number(this.montoEfectivo) || 0;
    }
    const items = this.carrito.map((i) => ({
      producto_id: i.producto.id,
      cantidad: i.cantidad,
      precio_unitario: Number(i.precioUnitario),
    }));

    const { error } = await this.supabase.client.rpc('editar_pedido', {
      p_pedido_id: this.pedidoId,
      p_datos: datos,
      p_items: items,
    });
    this.guardando = false;
    if (error) {
      this.errorMsg = error.message;
      this.cdr.detectChanges();
      return;
    }
    this.volver();
  }

  /** Limpia todo para crear otro pedido (y recarga el stock). */
  async otroPedido(): Promise<void> {
    this.carrito = [];
    this.clienteNombre = '';
    this.clienteTelefono = '';
    this.direccion = '';
    this.barrio = '';
    this.valorDomicilio = 0;
    this.observaciones = '';
    this.metodoPago = null;
    this.montoEfectivo = null;
    this.busquedaProducto = '';
    this.intentoEnviar = false;
    this.errorMsg = '';
    this.creado = null;
    this.clienteEncontrado = null;
    this.datosClienteUsados = false;
    this.ultimoTelefonoBuscado = '';
    await this.cargarProductos();
  }

  formatoMoneda(valor: number): string {
    return (Number(valor) || 0).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  foto(p: Producto, ancho = 160): string | null {
    if (this.fotosRotas.has(p.id)) return null;
    return urlImagen(p.imagen_url, ancho);
  }

  marcarFotoRota(p: Producto) {
    this.fotosRotas.add(p.id);
    this.cdr.detectChanges();
  }

  inicial(nombre: string): string {
    return (nombre || '?').trim().charAt(0).toUpperCase();
  }

  verFoto(p: Producto) {
    const src = this.foto(p, 1000);
    if (!src) return;
    this.fotoAbierta = { src, nombre: p.nombre, precio: this.formatoMoneda(p.precio_sugerido) };
    this.cdr.detectChanges();
  }

  cerrarFoto() {
    this.fotoAbierta = null;
    this.cdr.detectChanges();
  }

  @HostListener('document:keydown.escape')
  alPresionarEscape() {
    if (this.fotoAbierta) this.cerrarFoto();
  }
}
