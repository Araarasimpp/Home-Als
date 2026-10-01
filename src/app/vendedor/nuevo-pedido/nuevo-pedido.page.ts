import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, remove, searchOutline, chevronBackOutline, trashOutline, checkmark } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { Producto } from '../../shared/models/models';

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
    addIcons({ add, remove, searchOutline, chevronBackOutline, trashOutline, checkmark });
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
    this.cdr.detectChanges();
  }

  async cargarZonas(): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('zonas_domicilio')
      .select('id, nombre, valor')
      .order('nombre');

    if (!error && data) {
      this.zonas = data;
    }
    this.cdr.detectChanges();
  }

  get sugerenciasBarrio(): Zona[] {
    const q = this.barrio.trim().toLowerCase();
    if (!q) return this.zonas;
    return this.zonas.filter((z) => z.nombre.toLowerCase().includes(q));
  }

  seleccionarZona(zona: { nombre: string; valor: number }): void {
    this.barrio = zona.nombre;
    this.valorDomicilio = zona.valor;
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
    return this.subtotal + (Number(this.valorDomicilio) || 0);
  }

  async onCrearPedido(): Promise<void> {
    if (this.guardando) return;
    this.errorMsg = '';
    this.intentoEnviar = true;

    if (this.carrito.length === 0) {
      this.errorMsg = 'Agrega al menos un producto al pedido.';
      return;
    }

    if (!this.clienteNombre.trim() || !this.direccion.trim()) {
      this.errorMsg = 'Falta el nombre del cliente o la dirección.';
      return;
    }

    if (this.carrito.some((i) => !(Number(i.precioUnitario) > 0))) {
      this.errorMsg = 'Revisa los precios: ningún producto puede quedar en $0.';
      return;
    }

    this.guardando = true;
    this.cdr.detectChanges();

    const items = this.carrito.map((i) => ({
      producto_id: i.producto.id,
      cantidad: i.cantidad,
      precio_unitario: Number(i.precioUnitario),
      precio_base: i.producto.precio_base,
    }));

    const { data, error } = await this.supabase.client.rpc('crear_pedido', {
      p_cliente_nombre: this.clienteNombre.trim(),
      p_cliente_telefono: this.clienteTelefono.trim() || null,
      p_direccion: this.direccion.trim(),
      p_barrio: this.barrio.trim() || null,
      p_valor_domicilio: Number(this.valorDomicilio) || 0,
      p_observaciones: this.observaciones.trim() || null,
      p_items: items,
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

  /** Limpia todo para crear otro pedido (y recarga el stock). */
  async otroPedido(): Promise<void> {
    this.carrito = [];
    this.clienteNombre = '';
    this.clienteTelefono = '';
    this.direccion = '';
    this.barrio = '';
    this.valorDomicilio = 0;
    this.observaciones = '';
    this.busquedaProducto = '';
    this.intentoEnviar = false;
    this.errorMsg = '';
    this.creado = null;
    await this.cargarProductos();
  }

  formatoMoneda(valor: number): string {
    return (Number(valor) || 0).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}
