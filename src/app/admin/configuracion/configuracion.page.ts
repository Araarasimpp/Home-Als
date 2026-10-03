import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, trashOutline, downloadOutline, checkmark } from 'ionicons/icons';
import * as XLSX from 'xlsx';
import { SupabaseService } from '../../core/services/supabase.service';
import { MfaConfigComponent } from '../../shared/seguridad/mfa-config.component';
import {
  documentoRotulos,
  PedidoRotulo,
  ROTULO_CSS_VISTA_PREVIA,
  rotuloHtml,
} from '../../shared/rotulo/rotulo';

interface Configuracion {
  nombre_negocio: string;
  telefonos: string | null;
  redes: string | null;
  texto_garantia: string | null;
  stock_bajo_umbral: number;
}

interface Zona {
  id: string;
  nombre: string;
  valor: number;
}

// Pedido de ejemplo solo para la vista previa
const PEDIDO_EJEMPLO: PedidoRotulo = {
  numero: 128,
  cliente_nombre: 'Luz Marina Rodríguez',
  cliente_telefono: '310 482 1937',
  direccion: 'Cra. 78 #38-21 sur',
  barrio: 'Kennedy',
  observaciones: 'Llamar al llegar',
  total: 86500,
  created_at: new Date().toISOString(),
  productos: ['Termo 1 L x2'],
};

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, MfaConfigComponent],
  templateUrl: './configuracion.page.html',
  styleUrls: ['./configuracion.page.scss'],
})
export class ConfiguracionPage implements OnInit {
  loading = true;
  guardando = false;
  guardadoOk = false;
  errorMsg = '';

  form: Configuracion = {
    nombre_negocio: '',
    telefonos: '',
    redes: '',
    texto_garantia: '',
    stock_bajo_umbral: 5,
  };
  private original = '';

  vistaPrevia: SafeHtml = '';

  zonas: Zona[] = [];
  nuevaZonaNombre = '';
  nuevaZonaValor: number | null = null;
  guardandoZona = false;
  errorZona = '';

  exportando = false;

  // Seguridad
  inactividadMinutos = 30;
  inactividadDisponible = true; // false si falta ejecutar actividad-y-seguridad.sql
  guardandoInactividad = false;
  readonly opcionesInactividad = [
    { valor: 15, etiqueta: '15 minutos' },
    { valor: 30, etiqueta: '30 minutos' },
    { valor: 60, etiqueta: '1 hora' },
    { valor: 240, etiqueta: '4 horas' },
    { valor: 0, etiqueta: 'Nunca' },
  ];

  constructor(
    private supabase: SupabaseService,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer
  ) {
    addIcons({ add, trashOutline, downloadOutline, checkmark });
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.cargar(), this.cargarZonas(), this.cargarInactividad()]);
  }

  private async cargarInactividad(): Promise<void> {
    const { data } = await this.supabase.client.from('configuracion').select('*').eq('id', true).single();
    const v = (data as any)?.inactividad_minutos;
    this.inactividadDisponible = v !== undefined;
    this.inactividadMinutos = Number(v ?? 30);
    this.cdr.detectChanges();
  }

  async guardarInactividad(valor: number): Promise<void> {
    this.guardandoInactividad = true;
    this.cdr.detectChanges();
    const { error } = await this.supabase.client
      .from('configuracion')
      .update({ inactividad_minutos: Number(valor) })
      .eq('id', true);
    this.guardandoInactividad = false;
    if (error) alert('No se pudo guardar. ' + error.message);
    else this.inactividadMinutos = Number(valor);
    this.cdr.detectChanges();
  }

  get hayCambios(): boolean {
    return JSON.stringify(this.form) !== this.original;
  }

  async cargar(): Promise<void> {
    this.loading = true;
    const { data, error } = await this.supabase.client
      .from('configuracion')
      .select('nombre_negocio, telefonos, redes, texto_garantia, stock_bajo_umbral')
      .eq('id', true)
      .single();

    if (!error && data) {
      this.form = data as Configuracion;
    }
    this.original = JSON.stringify(this.form);
    this.actualizarVistaPrevia();
    this.loading = false;
    this.cdr.detectChanges();
  }

  /** Se llama cada vez que cambia un campo del rótulo. */
  onCambio(): void {
    this.guardadoOk = false;
    this.actualizarVistaPrevia();
  }

  private actualizarVistaPrevia(): void {
    const html = documentoRotulos(
      [
        rotuloHtml(PEDIDO_EJEMPLO, {
          nombre_negocio: this.form.nombre_negocio || 'Home ALS',
          telefonos: this.form.telefonos?.trim() || null,
          redes: this.form.redes?.trim() || null,
          texto_garantia: this.form.texto_garantia?.trim() || null,
        }),
      ],
      'Vista previa',
      ROTULO_CSS_VISTA_PREVIA
    );
    // El HTML lo arma nuestro propio código y escapa cada dato que viene del formulario
    this.vistaPrevia = this.sanitizer.bypassSecurityTrustHtml(html);
  }

  async guardar(): Promise<void> {
    this.errorMsg = '';
    this.guardadoOk = false;

    if (!this.form.nombre_negocio?.trim()) {
      this.errorMsg = 'Escribe el nombre del negocio.';
      return;
    }
    if (this.form.stock_bajo_umbral == null || this.form.stock_bajo_umbral < 0) {
      this.errorMsg = 'El umbral de stock bajo debe ser 0 o más.';
      return;
    }

    this.guardando = true;
    this.cdr.detectChanges();
    const { error } = await this.supabase.client
      .from('configuracion')
      .update(this.form)
      .eq('id', true);

    this.guardando = false;

    if (error) {
      this.errorMsg = 'No se pudo guardar. ' + error.message;
    } else {
      this.original = JSON.stringify(this.form);
      this.guardadoOk = true;
    }
    this.cdr.detectChanges();
  }

  descartar(): void {
    this.form = JSON.parse(this.original);
    this.errorMsg = '';
    this.actualizarVistaPrevia();
  }

  // ---------- Zonas de domicilio ----------

  async cargarZonas(): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('zonas_domicilio')
      .select('id, nombre, valor')
      .order('nombre');

    if (!error && data) {
      this.zonas = data as Zona[];
    }
    this.cdr.detectChanges();
  }

  async agregarZona(): Promise<void> {
    this.errorZona = '';
    const nombre = this.nuevaZonaNombre.trim();
    if (!nombre || this.nuevaZonaValor == null) return;

    if (this.zonas.some((z) => z.nombre.trim().toLowerCase() === nombre.toLowerCase())) {
      this.errorZona = `Ya existe la zona "${nombre}".`;
      return;
    }

    this.guardandoZona = true;
    this.cdr.detectChanges();
    const { error } = await this.supabase.client.from('zonas_domicilio').insert({
      nombre,
      valor: this.nuevaZonaValor,
    });
    this.guardandoZona = false;

    if (!error) {
      this.nuevaZonaNombre = '';
      this.nuevaZonaValor = null;
      await this.cargarZonas();
    } else {
      this.errorZona = 'No se pudo agregar la zona. ' + error.message;
    }
    this.cdr.detectChanges();
  }

  async actualizarZona(zona: Zona): Promise<void> {
    this.errorZona = '';
    const { error } = await this.supabase.client
      .from('zonas_domicilio')
      .update({ nombre: zona.nombre, valor: zona.valor })
      .eq('id', zona.id);
    if (error) {
      this.errorZona = `No se pudo guardar "${zona.nombre}". ` + error.message;
      this.cdr.detectChanges();
    }
  }

  async eliminarZona(zona: Zona): Promise<void> {
    const confirmado = confirm(`¿Eliminar la zona "${zona.nombre}"?`);
    if (!confirmado) return;

    const { error } = await this.supabase.client
      .from('zonas_domicilio')
      .delete()
      .eq('id', zona.id);

    if (!error) {
      await this.cargarZonas();
    } else {
      this.errorZona = 'No se pudo eliminar la zona. ' + error.message;
      this.cdr.detectChanges();
    }
  }

  formatoMoneda(valor: number): string {
    return Number(valor || 0).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  // ---------- Exportar datos ----------

  async exportarDatos(): Promise<void> {
    this.exportando = true;
    this.cdr.detectChanges();

    const [pedidosRes, productosRes, cuadresRes] = await Promise.all([
      this.supabase.client
        .from('pedidos')
        .select(
          'numero, estado, cliente_nombre, cliente_telefono, direccion, barrio, total, valor_domicilio, comision, metodo_pago, created_at, entregado_at'
        )
        .order('created_at', { ascending: false }),
      this.supabase.client
        .from('productos')
        .select('nombre, sku, categoria, costo, precio_base, precio_sugerido, stock, activo')
        .order('nombre'),
      this.supabase.client
        .from('cuadres')
        .select('fecha, cantidad_pedidos, total_efectivo, total_transferencia, total_domicilios, total_a_entregar, estado')
        .order('fecha', { ascending: false }),
    ]);

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(pedidosRes.data ?? []), 'Pedidos');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(productosRes.data ?? []), 'Productos');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(cuadresRes.data ?? []), 'Cuadres');

    const hoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(libro, `respaldo_home_als_${hoy}.xlsx`);

    this.exportando = false;
    this.cdr.detectChanges();
  }
}
