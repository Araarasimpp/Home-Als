import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { finDiaColombia, hoyColombiaISO, inicioDiaColombia } from '../../shared/fecha-colombia';
import { EsqueletoComponent } from '../../shared/esqueleto/esqueleto.component';

interface Registro {
  id: number;
  created_at: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  usuario_rol: string | null;
  entidad: string;
  accion: string;
  descripcion: string;
}

const ENTIDADES = [
  { valor: 'todas', etiqueta: 'Todo' },
  { valor: 'pedido', etiqueta: 'Pedidos' },
  { valor: 'producto', etiqueta: 'Productos' },
  { valor: 'cuadre', etiqueta: 'Cuadres' },
  { valor: 'usuario', etiqueta: 'Usuarios' },
  { valor: 'configuracion', etiqueta: 'Configuración' },
];

@Component({
  selector: 'app-actividad',
  standalone: true,
  imports: [EsqueletoComponent, CommonModule, FormsModule],
  templateUrl: './actividad.page.html',
  styleUrls: ['../../shared/ui.scss', '../clientes/clientes.page.scss', '../../shared/filtro-fecha.scss', './actividad.page.scss'],
})
export class ActividadPage implements OnInit {
  loading = true;
  errorMsg = '';
  registros: Registro[] = [];
  readonly hoy = hoyColombiaISO();
  fecha = this.hoy;
  entidad = 'todas';
  usuario = 'todos';
  busqueda = '';
  readonly entidades = ENTIDADES;
  readonly LIMITE = 500;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading = true;
    this.cdr.detectChanges();
    let q = this.supabase.client
      .from('actividad')
      .select('id, created_at, usuario_id, usuario_nombre, usuario_rol, entidad, accion, descripcion')
      .order('created_at', { ascending: false })
      .limit(this.LIMITE);
    if (this.fecha) {
      q = q
        .gte('created_at', inicioDiaColombia(this.fecha).toISOString())
        .lte('created_at', finDiaColombia(this.fecha).toISOString());
    }
    const { data, error } = await q;
    if (error) {
      this.errorMsg = /actividad/.test(error.message)
        ? 'Falta ejecutar el archivo supabase/mejoras-clientes-avisos-actividad.sql en Supabase.'
        : 'No se pudo cargar la actividad. ' + error.message;
    } else {
      this.errorMsg = '';
      this.registros = (data ?? []) as Registro[];
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  get usuarios(): { id: string; nombre: string }[] {
    const m = new Map<string, string>();
    this.registros.forEach((r) => m.set(r.usuario_id ?? 'sistema', r.usuario_nombre ?? 'Sistema'));
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  get filtrados(): Registro[] {
    const q = this.busqueda.trim().toLowerCase();
    return this.registros.filter(
      (r) =>
        (this.entidad === 'todas' || r.entidad === this.entidad) &&
        (this.usuario === 'todos' || (r.usuario_id ?? 'sistema') === this.usuario) &&
        (!q || r.descripcion.toLowerCase().includes(q))
    );
  }

  cambiarFecha(f: string): void {
    this.fecha = f;
    this.cargar();
  }

  hora(iso: string): string {
    const d = new Date(iso);
    const opciones: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' };
    if (!this.fecha) Object.assign(opciones, { day: 'numeric', month: 'short' });
    return d.toLocaleString('es-CO', opciones);
  }

  iniciales(n: string | null): string {
    return (n ?? 'S')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
  }

  rol(r: string | null): string {
    return r === 'admin' ? 'Admin' : r === 'despachador' ? 'Despachador' : r === 'vendedor' ? 'Vendedor' : r === 'domiciliario' ? 'Domiciliario' : 'Sistema';
  }
}
