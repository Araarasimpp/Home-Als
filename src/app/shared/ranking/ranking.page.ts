import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { trophyOutline, flagOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { AvatarComponent } from '../avatar/avatar.component';
import { EsqueletoComponent } from '../esqueleto/esqueleto.component';
import { hoyColombiaISO } from '../fecha-colombia';

export type TipoRanking = 'vendedor' | 'domiciliario';
export type Periodo = 'hoy' | 'semana' | 'mes';

export interface FilaRanking {
  usuario_id: string;
  nombre: string;
  avatar_url: string | null;
  tipo: TipoRanking;
  pedidos: number;
  /** null cuando quien mira no puede ver pesos (vendedores y domiciliarios) */
  ventas: number | null;
  entregas: number;
  meta: number | null;
  /** Puesto que calcula la base (así se ordena aunque no se vean los pesos) */
  orden?: number | null;
  /** % de la meta del mes; a quien no ve pesos solo le llega el suyo */
  avance?: number | null;
}

/** Rango de fechas (Colombia) de cada periodo. La semana empieza el lunes. */
export function rangoPeriodo(p: Periodo): { desde: string; hasta: string } {
  const hoy = hoyColombiaISO();
  if (p === 'hoy') return { desde: hoy, hasta: hoy };
  const d = new Date(hoy + 'T12:00:00Z');
  if (p === 'semana') {
    const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
    d.setUTCDate(d.getUTCDate() - dow);
    return { desde: d.toISOString().slice(0, 10), hasta: hoy };
  }
  return { desde: hoy.slice(0, 8) + '01', hasta: hoy };
}

/** Puntaje con el que se ordena: cantidad de ventas (vendedores) o de entregas (domiciliarios). */
export const puntaje = (f: FilaRanking) => (f.tipo === 'vendedor' ? Number(f.pedidos) : Number(f.entregas));

/** Lo que cuenta para la meta: pesos vendidos (vendedores) o entregas (domiciliarios). */
export const logro = (f: FilaRanking) => (f.tipo === 'vendedor' ? Number(f.ventas ?? 0) : Number(f.entregas));

/** Ordena por el puesto de la base; si no viene: más ventas (cantidad), más pesos y por nombre. */
export function ordenarRanking(filas: FilaRanking[]): FilaRanking[] {
  return [...filas].sort((a, b) =>
    a.orden != null && b.orden != null
      ? a.orden - b.orden
      : puntaje(b) - puntaje(a) || Number(b.ventas ?? 0) - Number(a.ventas ?? 0) || a.nombre.localeCompare(b.nombre)
  );
}

/** "9 ventas": lo que ve quien no puede ver los pesos. */
export const textoVentas = (n: number) => `${n} ${n === 1 ? 'venta' : 'ventas'}`;

/**
 * Ranking de vendedores (quién vendió más, solo pedidos entregados) y de
 * domiciliarios (quién hizo más entregas), con metas del mes. El admin puede
 * fijar las metas desde aquí.
 */
@Component({
  selector: 'app-ranking',
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, AvatarComponent, EsqueletoComponent],
  templateUrl: './ranking.page.html',
  styleUrls: ['../ui.scss', './ranking.page.scss'],
})
export class RankingPage implements OnInit {
  tipo: TipoRanking = 'vendedor';
  periodo: Periodo = 'mes';
  loading = true;
  errorMsg = '';
  filas: FilaRanking[] = [];
  miId: string | null = null;
  readonly puedeEditarMetas: boolean;
  /** Meta que se está editando (id del usuario) y su valor en el campo. */
  editandoId: string | null = null;
  metaTexto = '';
  guardandoMeta = false;

  readonly medallas = ['🥇', '🥈', '🥉'];

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef, route: ActivatedRoute) {
    this.puedeEditarMetas = !!route.snapshot.data['editarMetas'];
    const t = route.snapshot.data['tipo'] as TipoRanking | undefined;
    if (t) this.tipo = t;
    addIcons({ trophyOutline, flagOutline });
  }

  async ngOnInit(): Promise<void> {
    const user = await this.supabase.getCurrentUser();
    this.miId = user?.id ?? null;
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading = !this.filas.length;
    this.errorMsg = '';
    const { desde, hasta } = rangoPeriodo(this.periodo);
    const { data, error } = await this.supabase.client.rpc('ranking', { p_desde: desde, p_hasta: hasta });
    if (error) {
      this.errorMsg = /ranking/.test(error.message)
        ? 'El ranking todavía no está activado en el sistema.'
        : 'No se pudo cargar el ranking. Revisa tu conexión.';
      this.filas = [];
    } else {
      this.filas = ((data ?? []) as any[]).map((f) => ({
        ...f,
        pedidos: Number(f.pedidos) || 0,
        ventas: f.ventas == null ? null : Number(f.ventas) || 0,
        entregas: Number(f.entregas) || 0,
        meta: f.meta == null ? null : Number(f.meta),
        orden: f.orden == null ? null : Number(f.orden),
        avance: f.avance == null ? null : Number(f.avance),
      }));
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  cambiarTipo(t: TipoRanking): void {
    this.tipo = t;
    this.editandoId = null;
  }

  cambiarPeriodo(p: Periodo): void {
    this.periodo = p;
    this.editandoId = null;
    this.cargar();
  }

  get lista(): FilaRanking[] {
    return ordenarRanking(this.filas.filter((f) => f.tipo === this.tipo));
  }

  get podio(): FilaRanking[] {
    return this.lista.slice(0, 3).filter((f) => puntaje(f) > 0);
  }

  get resto(): FilaRanking[] {
    return this.lista.slice(this.podio.length);
  }

  /** Orden visual del podio: 2.º, 1.º, 3.º */
  get podioVisual(): { f: FilaRanking; puesto: number }[] {
    const p = this.podio.map((f, i) => ({ f, puesto: i + 1 }));
    return [p[1], p[0], p[2]].filter(Boolean);
  }

  get miPuesto(): number | null {
    const i = this.lista.findIndex((f) => f.usuario_id === this.miId);
    return i >= 0 ? i + 1 : null;
  }

  valor(f: FilaRanking): string {
    if (f.tipo === 'domiciliario') return `${f.entregas} ${f.entregas === 1 ? 'entrega' : 'entregas'}`;
    // El ranking va por cantidad de ventas; los pesos solo los ven admin y despachador (en el detalle)
    return textoVentas(f.pedidos);
  }

  detalle(f: FilaRanking): string {
    if (f.tipo !== 'vendedor' || f.ventas == null) return '';
    return `${this.pesos(f.ventas)} vendidos`;
  }

  /** Avance hacia la meta (las metas son del mes). */
  avance(f: FilaRanking): number | null {
    if (this.periodo !== 'mes') return null;
    if (f.avance != null) return f.avance;
    if (!f.meta) return null;
    return Math.min(100, Math.round((logro(f) / f.meta) * 100));
  }

  textoMeta(f: FilaRanking): string {
    if (!f.meta) return this.esYo(f) ? 'Tu meta' : 'Meta';
    return f.tipo === 'vendedor' ? `Meta ${this.pesos(f.meta)}` : `Meta ${f.meta} entregas`;
  }

  esYo(f: FilaRanking): boolean {
    return f.usuario_id === this.miId;
  }

  // ---------- Metas (solo admin) ----------
  editarMeta(f: FilaRanking): void {
    this.editandoId = f.usuario_id;
    this.metaTexto = f.meta ? String(f.meta) : '';
  }

  cancelarMeta(): void {
    this.editandoId = null;
  }

  async guardarMeta(f: FilaRanking): Promise<void> {
    if (this.guardandoMeta) return;
    const texto = this.metaTexto.replace(/[^\d]/g, '');
    const valor = texto ? Number(texto) : null;
    this.guardandoMeta = true;
    const cambio = f.tipo === 'vendedor' ? { meta_ventas: valor } : { meta_entregas: valor };
    const { error } = await this.supabase.client
      .from('metas')
      .upsert({ usuario_id: f.usuario_id, ...cambio, updated_at: new Date().toISOString() }, { onConflict: 'usuario_id' });
    this.guardandoMeta = false;
    if (error) {
      this.errorMsg = 'No se pudo guardar la meta. ' + error.message;
    } else {
      this.filas = this.filas.map((x) => (x.usuario_id === f.usuario_id && x.tipo === f.tipo ? { ...x, meta: valor } : x));
      this.editandoId = null;
    }
    this.cdr.detectChanges();
  }

  pesos(n: number): string {
    return (Number(n) || 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  }

  track(_: number, f: FilaRanking): string {
    return f.usuario_id + f.tipo;
  }
}
