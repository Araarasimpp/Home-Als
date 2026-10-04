import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { SupabaseService } from '../../core/services/supabase.service';
import { ProductoFormComponent } from './producto-form/producto-form.component';
import { Producto } from '../../shared/models/models';

type TabFiltro = 'activos' | 'todos';

@Component({
  selector: 'app-productos',
  standalone: true,
  imports: [CommonModule, FormsModule, ProductoFormComponent],
  templateUrl: './productos.page.html',
  styleUrls: ['./productos.page.scss', './productos-eliminar.scss'],
})
export class ProductosPage implements OnInit, OnDestroy {
  loading = true;
  productos: Producto[] = [];
  busqueda = '';
  tab: TabFiltro = 'activos';
  seleccionados = new Set<string>();

  paginaActual = 1;
  porPagina = 10;

  modalAbierto = false;
  productoEditando: Producto | null = null;
  menuAbiertoId: string | null = null;

  cargandoExcel = false;
  resumenCarga: { creados: number; errores: string[] } | null = null;

  /**
   * Productos que ya están en algún pedido. Esos no se pueden eliminar (solo
   * archivar), porque borrarlos dañaría el historial, los cuadres y los reportes.
   * Mientras no se sepa (null), no se muestra "Eliminar" en ninguno.
   */
  enUso: Set<string> | null = null;
  eliminandoId: string | null = null;

  private canal: RealtimeChannel | null = null;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  stockBajoUmbral = 5;

  async ngOnInit(): Promise<void> {
    const { data: config } = await this.supabase.client
      .from('configuracion')
      .select('stock_bajo_umbral')
      .eq('id', true)
      .single();
    this.stockBajoUmbral = config?.stock_bajo_umbral ?? 5;

    await this.cargarProductos();
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('productos-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'productos' },
        () => {
          this.cargarProductos();
        }
      )
      .subscribe();
  }

  async cargarProductos(): Promise<void> {
    if (!this.productos.length) this.loading = true;
    const [{ data, error }] = await Promise.all([
      this.supabase.client
        .from('productos')
        .select(
          'id, nombre, sku, descripcion, categoria, precio_base, precio_sugerido, costo, stock, imagen_url, activo'
        )
        .order('nombre'),
      this.cargarEnUso(),
    ]);

    if (!error && data) {
      this.productos = data as Producto[];
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  /** Ids de productos que aparecen en algún pedido. */
  private async cargarEnUso(): Promise<void> {
    const { data, error } = await this.supabase.client.rpc('productos_en_uso');
    if (!error && data) {
      // La función devuelve una lista de ids (o filas con un solo valor)
      this.enUso = new Set((data as any[]).map((d) => (typeof d === 'string' ? d : Object.values(d)[0] as string)));
      return;
    }
    // Si todavía no se ejecutó supabase/eliminar-productos.sql: no se ofrece
    // eliminar a nadie (nunca se arriesga a mostrarlo en un producto usado).
    this.enUso = null;
  }

  puedeEliminar(p: Producto): boolean {
    return this.enUso !== null && !this.enUso.has(p.id);
  }

  get filtrados(): Producto[] {
    let lista = this.productos;

    if (this.tab === 'activos') {
      lista = lista.filter((p) => p.activo);
    }

    if (this.busqueda.trim()) {
      const q = this.busqueda.trim().toLowerCase();
      lista = lista.filter(
        (p) => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      );
    }

    return lista;
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.filtrados.length / this.porPagina));
  }

  get paginados(): Producto[] {
    const inicio = (this.paginaActual - 1) * this.porPagina;
    return this.filtrados.slice(inicio, inicio + this.porPagina);
  }

  cambiarTab(tab: TabFiltro): void {
    this.tab = tab;
    this.paginaActual = 1;
  }

  irAPagina(delta: number): void {
    const next = this.paginaActual + delta;
    if (next >= 1 && next <= this.totalPaginas) {
      this.paginaActual = next;
    }
  }

  toggleSeleccion(id: string): void {
    if (this.seleccionados.has(id)) {
      this.seleccionados.delete(id);
    } else {
      this.seleccionados.add(id);
    }
  }

  toggleMenu(id: string): void {
    this.menuAbiertoId = this.menuAbiertoId === id ? null : id;
  }

  abrirNuevo(): void {
    this.productoEditando = null;
    this.modalAbierto = true;
  }

  abrirEditar(producto: Producto): void {
    this.productoEditando = producto;
    this.modalAbierto = true;
    this.menuAbiertoId = null;
  }

  cerrarModal(): void {
    this.modalAbierto = false;
  }

  async onGuardado(): Promise<void> {
    this.modalAbierto = false;
    await this.cargarProductos();
  }

  /** Oculta el producto del catálogo; sigue existiendo para pedidos anteriores. */
  async archivarProducto(producto: Producto): Promise<void> {
    this.menuAbiertoId = null;

    const confirmado = confirm(
      `¿Archivar "${producto.nombre}"? No aparecerá más en el catálogo, pero se conserva en pedidos anteriores. Puedes reactivarlo cuando quieras.`
    );
    if (!confirmado) return;

    const { error } = await this.supabase.client
      .from('productos')
      .update({ activo: false })
      .eq('id', producto.id);

    if (!error) {
      await this.cargarProductos();
    } else {
      alert('No se pudo archivar el producto. ' + error.message);
      this.cdr.detectChanges();
    }
  }

  /**
   * Borra el producto para siempre (y su foto). Solo para productos que nunca
   * se usaron en un pedido, por ejemplo uno que se subió mal.
   */
  async eliminarProducto(producto: Producto): Promise<void> {
    this.menuAbiertoId = null;
    if (!this.puedeEliminar(producto) || this.eliminandoId) return;

    const confirmado = confirm(
      `¿Eliminar "${producto.nombre}" (${producto.sku}) para siempre?\n\nSe borra el producto y su foto. Esta acción no se puede deshacer.`
    );
    if (!confirmado) return;

    this.eliminandoId = producto.id;
    this.cdr.detectChanges();

    // .select() devuelve lo que se borró: si viene vacío, no se borró nada
    // (por ejemplo, falta el permiso en Supabase).
    const { data, error } = await this.supabase.client
      .from('productos')
      .delete()
      .eq('id', producto.id)
      .select('id');

    this.eliminandoId = null;

    if (error) {
      // P0001 = el seguro de la base de datos: el producto ya está en un pedido
      alert(
        error.code === 'P0001' || error.code === '23503'
          ? `"${producto.nombre}" ya está en algún pedido, así que no se puede eliminar. Puedes archivarlo.`
          : 'No se pudo eliminar el producto. ' + error.message
      );
      await this.cargarProductos();
      return;
    }

    if (!data?.length) {
      alert('No se pudo eliminar: falta ejecutar supabase/eliminar-productos.sql en Supabase (permiso de borrado).');
      return;
    }

    await this.borrarFoto(producto.imagen_url);
    this.seleccionados.delete(producto.id);
    this.productos = this.productos.filter((p) => p.id !== producto.id);
    if (this.paginaActual > this.totalPaginas) this.paginaActual = this.totalPaginas;
    this.cdr.detectChanges();
  }

  /** Borra la foto del bucket "productos" si es una imagen subida desde la app. */
  private async borrarFoto(url: string | null): Promise<void> {
    const marca = '/storage/v1/object/public/productos/';
    if (!url || !url.includes(marca)) return; // imágenes externas (ej. desde Excel) no se tocan
    const ruta = decodeURIComponent(url.split(marca)[1].split('?')[0]);
    // Si falla, solo queda un archivo huérfano en Storage; el producto ya se borró
    await this.supabase.client.storage.from('productos').remove([ruta]);
  }

  async reactivarProducto(producto: Producto): Promise<void> {
    this.menuAbiertoId = null;

    const { error } = await this.supabase.client
      .from('productos')
      .update({ activo: true })
      .eq('id', producto.id);

    if (!error) {
      await this.cargarProductos();
    } else {
      this.cdr.detectChanges();
    }
  }

  estadoStock(stock: number): { texto: string; clase: string } {
    if (stock === 0) return { texto: 'Agotado', clase: 'estado-agotado' };
    if (stock < this.stockBajoUmbral) return { texto: 'Stock bajo', clase: 'estado-bajo' };
    return { texto: 'Disponible', clase: 'estado-ok' };
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  async onArchivoExcel(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.cargandoExcel = true;
    this.resumenCarga = null;
    this.cdr.detectChanges();

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const hoja = workbook.Sheets[workbook.SheetNames[0]];
      const filas: any[] = XLSX.utils.sheet_to_json(hoja, { defval: null });

      const errores: string[] = [];
      const productosValidos: any[] = [];
      const filasDeProducto: number[] = [];

      filas.forEach((fila, i) => {
        const numFila = i + 2; // +2 porque la fila 1 es el encabezado
        const nombre = String(fila.nombre ?? '').trim();
        const sku = String(fila.sku ?? '').trim();
        const precioSugerido = Number(fila.precio_sugerido);
        const precioBase =
          fila.precio_base != null && fila.precio_base !== '' ? Number(fila.precio_base) : precioSugerido;

        if (!nombre || !sku || !fila.precio_sugerido || isNaN(precioSugerido)) {
          errores.push(`Fila ${numFila}: falta nombre, sku o precio_sugerido válido — se omitió.`);
          return;
        }

        filasDeProducto.push(numFila);
        productosValidos.push({
          nombre,
          sku,
          categoria: fila.categoria ? String(fila.categoria).trim() : null,
          descripcion: fila.descripcion ? String(fila.descripcion).trim() : null,
          precio_base: precioBase,
          precio_sugerido: precioSugerido,
          costo: fila.costo != null && fila.costo !== '' ? Number(fila.costo) : null,
          stock: fila.stock != null && fila.stock !== '' ? Number(fila.stock) : 0,
          imagen_url: fila.imagen_url ? String(fila.imagen_url).trim() : null,
          activo: true,
        });
      });

      // El mismo SKU en varias filas hace fallar TODA la carga en Postgres
      // ("ON CONFLICT DO UPDATE command cannot affect row a second time").
      // Se deja la última fila de cada SKU y se avisa cuáles se repetían.
      const porSku = new Map<string, { fila: number; producto: any }>();
      const repetidos = new Map<string, number[]>();
      productosValidos.forEach((prod, i) => {
        const fila = filasDeProducto[i];
        const previo = porSku.get(prod.sku);
        if (previo) {
          repetidos.set(prod.sku, [...(repetidos.get(prod.sku) ?? [previo.fila]), fila]);
        }
        porSku.set(prod.sku, { fila, producto: prod });
      });
      repetidos.forEach((filas, sku) => {
        errores.push(
          `SKU "${sku}" repetido en las filas ${filas.join(', ')}: se usó la fila ${filas[filas.length - 1]}.`
        );
      });
      const unicos = [...porSku.values()].map((v) => v.producto);

      // Se envía en grupos: si uno falla, los demás igual se guardan
      let guardados = 0;
      const TAMANO_GRUPO = 200;
      for (let i = 0; i < unicos.length; i += TAMANO_GRUPO) {
        const grupo = unicos.slice(i, i + TAMANO_GRUPO);
        // upsert por sku: si el SKU ya existe, actualiza ese producto en vez
        // de crear uno duplicado — así se puede resubir el mismo Excel corregido.
        const { error } = await this.supabase.client.from('productos').upsert(grupo, { onConflict: 'sku' });
        if (error) {
          errores.push(
            `No se guardaron los productos de las filas ${porSku.get(grupo[0].sku)?.fila} a ${porSku.get(grupo[grupo.length - 1].sku)?.fila}: ${error.message}`
          );
        } else {
          guardados += grupo.length;
        }
      }

      this.resumenCarga = { creados: guardados, errores };

      await this.cargarProductos();
    } catch (err) {
      this.resumenCarga = { creados: 0, errores: ['No se pudo leer el archivo. ¿Es un .xlsx válido?'] };
    }

    this.cargandoExcel = false;
    input.value = '';
    this.cdr.detectChanges();
  }

  inicial(nombre: string): string {
    return nombre.charAt(0).toUpperCase();
  }
}
