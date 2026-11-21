import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DonaComponent, Segmento } from '../../shared/graficas/dona.component';
import { BarraEstadoComponent } from '../../shared/graficas/barra-estado.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { inicioDiaColombia } from '../../shared/fecha-colombia';
import { EsqueletoComponent } from '../../shared/esqueleto/esqueleto.component';

interface PedidoResumen {
  id: string;
  numero: number;
  cliente_nombre: string;
  total: number;
  estado: string;
  created_at: string;
}

interface CuadrePendiente {
  id: string;
  domiciliario_id: string;
  total_a_entregar: number;
}

@Component({
  selector: 'app-inicio-despachador',
  standalone: true,
  imports: [EsqueletoComponent, CommonModule, RouterLink, DonaComponent, BarraEstadoComponent, AvatarComponent],
  templateUrl: './inicio.page.html',
  styleUrls: ['./inicio.page.scss'],
})
export class InicioDespachadorPage implements OnInit {
  loading = true;

  ventasHoy = 0;
  pedidosPendientes = 0;
  pedidosEnRuta = 0;
  entregadosHoy = 0;

  pedidosRecientes: PedidoResumen[] = [];
  cuadresPendientes: CuadrePendiente[] = [];
  nombresPorId = new Map<string, string>();
  fotosPorId = new Map<string, string | null>();
  /** Avance de cada domiciliario hoy (entregados y en ruta) */
  avance: { id: string; entregados: number; enRuta: number }[] = [];

  get donaDia(): Segmento[] {
    return [
      { etiqueta: 'Entregados hoy', valor: this.entregadosHoy, color: 'var(--data-green)' },
      { etiqueta: 'En ruta', valor: this.pedidosEnRuta, color: 'var(--data-orange)' },
      { etiqueta: 'Pendientes', valor: this.pedidosPendientes, color: 'var(--data-green-soft)' },
    ];
  }

  get totalDia(): number {
    return this.entregadosHoy + this.pedidosEnRuta + this.pedidosPendientes;
  }

  segmentos(a: { entregados: number; enRuta: number }): Segmento[] {
    return [
      { etiqueta: 'Entregados', valor: a.entregados, color: 'var(--data-green)' },
      { etiqueta: 'En ruta', valor: a.enRuta, color: 'var(--data-orange)' },
    ];
  }

  /** "Buenos días, Carlos" según la hora de Colombia */
  get saludo(): string {
    const hora = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Bogota' }));
    const parte = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
    const nombre = (this.supabase.perfil()?.nombre ?? '').split(' ')[0];
    return nombre ? parte + ', ' + nombre : parte;
  }

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading = true;
    const inicioHoy = inicioDiaColombia();

    const [ventasRes, pendientesRes, enRutaRes, entregadosRes, recientesRes, cuadresRes, perfilesRes, avanceRes] =
      await Promise.all([
        this.supabase.client
          .from('pedidos')
          .select('total')
          .gte('created_at', inicioHoy.toISOString())
          .in('estado', ['en_ruta', 'entregado']),
        this.supabase.client
          .from('pedidos')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'pendiente'),
        this.supabase.client
          .from('pedidos')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'en_ruta'),
        this.supabase.client
          .from('pedidos')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'entregado')
          .gte('entregado_at', inicioHoy.toISOString()),
        this.supabase.client
          .from('pedidos')
          .select('id, numero, cliente_nombre, total, estado, created_at')
          .order('created_at', { ascending: false })
          .limit(6),
        this.supabase.client
          .from('cuadres')
          .select('id, domiciliario_id, total_a_entregar')
          .eq('estado', 'pendiente')
          .order('fecha', { ascending: true }),
        this.supabase.client.from('profiles').select('id, nombre, avatar_url'),
        this.supabase.client
          .from('pedidos')
          .select('domiciliario_id, estado, entregado_at')
          .not('domiciliario_id', 'is', null)
          .or(`estado.eq.en_ruta,and(estado.eq.entregado,entregado_at.gte.${inicioHoy.toISOString()})`),
      ]);

    this.ventasHoy = (ventasRes.data ?? []).reduce((s, p) => s + Number(p.total ?? 0), 0);
    this.pedidosPendientes = pendientesRes.count ?? 0;
    this.pedidosEnRuta = enRutaRes.count ?? 0;
    this.entregadosHoy = entregadosRes.count ?? 0;
    this.pedidosRecientes = (recientesRes.data as PedidoResumen[]) ?? [];
    this.cuadresPendientes = (cuadresRes.data as CuadrePendiente[]) ?? [];

    if (perfilesRes.data) {
      this.nombresPorId = new Map(perfilesRes.data.map((p: any) => [p.id, p.nombre]));
      this.fotosPorId = new Map(perfilesRes.data.map((p: any) => [p.id, p.avatar_url ?? null]));
    }
    const por = new Map<string, { id: string; entregados: number; enRuta: number }>();
    for (const p of (avanceRes.data ?? []) as any[]) {
      const f = por.get(p.domiciliario_id) ?? { id: p.domiciliario_id, entregados: 0, enRuta: 0 };
      if (p.estado === 'entregado') f.entregados++;
      else f.enRuta++;
      por.set(p.domiciliario_id, f);
    }
    this.avance = [...por.values()].sort((a, b) => b.entregados + b.enRuta - (a.entregados + a.enRuta));

    this.loading = false;
    this.cdr.detectChanges();
  }

  nombreDomiciliario(id: string): string {
    return this.nombresPorId.get(id) ?? 'Domiciliario';
  }

  etiquetaEstado(estado: string): string {
    const etiquetas: Record<string, string> = {
      pendiente: 'Pendiente',
      en_ruta: 'En ruta',
      entregado: 'Entregado',
      cancelado: 'Cancelado',
    };
    return etiquetas[estado] ?? estado;
  }

  claseEstado(estado: string): string {
    const clases: Record<string, string> = {
      pendiente: 'badge-bajo',
      en_ruta: 'badge-info',
      entregado: 'badge-ok',
      cancelado: 'badge-coral',
    };
    return clases[estado] ?? '';
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}