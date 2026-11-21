import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, chevronBackOutline, chevronForwardOutline, close, trashOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { finDiaColombia, hoyColombiaISO, inicioDiaColombia, diaColombiaDe } from '../fecha-colombia';
import { SobreTodoDirective } from '../sobre-todo.directive';

export type TipoEvento = 'reunion' | 'pago' | 'entrega' | 'recordatorio';

export interface Evento {
  id: string;
  titulo: string;
  nota: string | null;
  dia: string; // YYYY-MM-DD
  hora_inicio: string; // HH:MM(:SS)
  hora_fin: string;
  tipo: TipoEvento;
}

interface Dia {
  iso: string;
  corto: string; // LUN
  num: number;
  hoy: boolean;
}

interface Colocado extends Evento {
  top: number;
  alto: number;
  izq: number; // %
  ancho: number; // %
}

/** Primera y última hora que se muestran en la semana */
const HORA_INI = 7;
const HORA_FIN = 22;
/** Alto de una hora en px (escritorio) */
export const ALTO_HORA = 52;

export const TIPOS: { valor: TipoEvento; etiqueta: string }[] = [
  { valor: 'reunion', etiqueta: 'Reunión' },
  { valor: 'pago', etiqueta: 'Pago' },
  { valor: 'entrega', etiqueta: 'Entrega' },
  { valor: 'recordatorio', etiqueta: 'Recordatorio' },
];

const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const aHora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fechaLocal = (iso: string) => new Date(`${iso}T12:00:00-05:00`);
const isoDe = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

/** Lunes de la semana de esa fecha */
function lunesDe(iso: string): string {
  const d = fechaLocal(iso);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return isoDe(d);
}

function sumarDias(iso: string, n: number): string {
  const d = fechaLocal(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDe(d);
}

/**
 * Calendario de la semana, como el del dashboard de referencia: eventos del
 * equipo por horas (reuniones, pagos, entregas, recordatorios) y, arriba de
 * cada día, lo que se vendió. Toca un espacio vacío para agregar; arrastra un
 * evento para moverlo. En el celular se ve un día a la vez.
 */
@Component({
  selector: 'app-calendario',
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, SobreTodoDirective],
  templateUrl: './calendario.page.html',
  styleUrls: ['./calendario.page.scss'],
})
export class CalendarioPage implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly horas = Array.from({ length: HORA_FIN - HORA_INI }, (_, i) => HORA_INI + i);
  readonly altoHora = ALTO_HORA;
  readonly tipos = TIPOS;
  readonly hoy = hoyColombiaISO();

  lunes = lunesDe(this.hoy);
  /** Día elegido en el celular */
  diaSel = this.hoy;
  dias: Dia[] = [];
  eventos: Evento[] = [];
  ventasPorDia = new Map<string, { total: number; pedidos: number }>();
  cargando = true;
  errorMsg = '';
  faltaTabla = false;

  /** Evento abierto en el editor (nuevo si no tiene id) */
  editando: (Partial<Evento> & { dia: string; hora_inicio: string; hora_fin: string }) | null = null;
  guardando = false;
  errorEditor = '';

  /** Evento que se está arrastrando */
  private arrastrado: Evento | null = null;

  constructor() {
    addIcons({ add, chevronBackOutline, chevronForwardOutline, close, trashOutline });
  }

  async ngOnInit(): Promise<void> {
    this.armarDias();
    await this.cargar();
  }

  // ---------- Semana ----------
  private armarDias(): void {
    this.dias = Array.from({ length: 7 }, (_, i) => {
      const iso = sumarDias(this.lunes, i);
      const d = fechaLocal(iso);
      return {
        iso,
        corto: d.toLocaleDateString('es-CO', { weekday: 'short', timeZone: 'America/Bogota' }).replace('.', '').toUpperCase(),
        num: Number(iso.slice(8, 10)),
        hoy: iso === this.hoy,
      };
    });
    if (!this.dias.some((d) => d.iso === this.diaSel)) this.diaSel = this.dias[0].iso;
  }

  get rangoTexto(): string {
    const ini = fechaLocal(this.lunes);
    const fin = fechaLocal(sumarDias(this.lunes, 6));
    const f = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', ...o });
    const mismoMes = ini.getUTCMonth() === fin.getUTCMonth();
    return mismoMes
      ? `${f(ini, { day: 'numeric' })} – ${f(fin, { day: 'numeric', month: 'long', year: 'numeric' })}`
      : `${f(ini, { day: 'numeric', month: 'short' })} – ${f(fin, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  get esEstaSemana(): boolean {
    return this.lunes === lunesDe(this.hoy);
  }

  moverSemana(n: number): void {
    this.lunes = sumarDias(this.lunes, 7 * n);
    this.diaSel = n > 0 ? this.lunes : sumarDias(this.lunes, 6);
    this.armarDias();
    this.cargar();
  }

  irAHoy(): void {
    this.lunes = lunesDe(this.hoy);
    this.diaSel = this.hoy;
    this.armarDias();
    this.cargar();
  }

  // ---------- Datos ----------
  async cargar(): Promise<void> {
    this.cargando = !this.eventos.length;
    this.errorMsg = '';
    const db = this.supabase.client;
    const desde = this.dias[0].iso;
    const hasta = this.dias[6].iso;
    const [evRes, pedRes] = await Promise.all([
      db.from('eventos').select('id, titulo, nota, dia, hora_inicio, hora_fin, tipo').gte('dia', desde).lte('dia', hasta).order('hora_inicio'),
      db
        .from('pedidos')
        .select('total, created_at')
        .neq('estado', 'cancelado')
        .gte('created_at', inicioDiaColombia(desde).toISOString())
        .lte('created_at', finDiaColombia(hasta).toISOString()),
    ]);
    if (evRes.error) {
      this.faltaTabla = /eventos|relation|schema/i.test(evRes.error.message);
      this.errorMsg = this.faltaTabla ? 'El calendario todavía no está activado en el sistema.' : 'No se pudieron cargar los eventos.';
      this.eventos = [];
    } else {
      this.faltaTabla = false;
      this.eventos = ((evRes.data ?? []) as Evento[]).map((e) => ({ ...e, hora_inicio: e.hora_inicio.slice(0, 5), hora_fin: e.hora_fin.slice(0, 5) }));
    }
    this.ventasPorDia = new Map();
    for (const p of (pedRes.data ?? []) as any[]) {
      const k = diaColombiaDe(p.created_at);
      const v = this.ventasPorDia.get(k) ?? { total: 0, pedidos: 0 };
      v.total += Number(p.total || 0);
      v.pedidos++;
      this.ventasPorDia.set(k, v);
    }
    this.cargando = false;
    this.cdr.detectChanges();
  }

  get totalEventos(): number {
    return this.eventos.length;
  }

  ventasDe(iso: string): { total: number; pedidos: number } | null {
    return this.ventasPorDia.get(iso) ?? null;
  }

  // ---------- Colocar eventos (los que se cruzan van lado a lado) ----------
  colocados(iso: string): Colocado[] {
    const lista = this.eventos.filter((e) => e.dia === iso).sort((a, b) => aMin(a.hora_inicio) - aMin(b.hora_inicio));
    const carriles: number[] = []; // minuto en que se libera cada carril
    const asignado: { e: Evento; carril: number }[] = [];
    let grupo: { e: Evento; carril: number }[] = [];
    let finGrupo = -1;
    const cerrarGrupo = () => {
      const n = Math.max(1, ...grupo.map((g) => g.carril + 1));
      for (const g of grupo) (g as any).n = n;
      grupo = [];
    };
    for (const e of lista) {
      const ini = aMin(e.hora_inicio);
      const fin = aMin(e.hora_fin);
      if (ini >= finGrupo) {
        cerrarGrupo();
        carriles.length = 0;
      }
      let c = carriles.findIndex((libre) => libre <= ini);
      if (c < 0) c = carriles.length;
      carriles[c] = fin;
      const item = { e, carril: c };
      asignado.push(item);
      grupo.push(item);
      finGrupo = Math.max(finGrupo, fin);
    }
    cerrarGrupo();
    const base = HORA_INI * 60;
    return asignado.map((a) => {
      const n = (a as any).n as number;
      const ini = Math.max(aMin(a.e.hora_inicio), base);
      const fin = Math.min(aMin(a.e.hora_fin), HORA_FIN * 60);
      return {
        ...a.e,
        top: ((ini - base) / 60) * ALTO_HORA,
        alto: Math.max(22, ((fin - ini) / 60) * ALTO_HORA - 3),
        izq: (a.carril / n) * 100,
        ancho: 100 / n,
      };
    });
  }

  eventosDelDia(iso: string): Evento[] {
    return this.eventos.filter((e) => e.dia === iso).sort((a, b) => aMin(a.hora_inicio) - aMin(b.hora_inicio));
  }

  cuantosEventos(iso: string): number {
    return this.eventos.filter((e) => e.dia === iso).length;
  }

  /** Línea de "ahora" en el día de hoy */
  get lineaAhora(): number | null {
    const ahora = new Date();
    const m = Number(ahora.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Bogota' })) * 60 + ahora.getMinutes();
    if (m < HORA_INI * 60 || m > HORA_FIN * 60) return null;
    return ((m - HORA_INI * 60) / 60) * ALTO_HORA;
  }

  etiquetaHora(h: number): string {
    if (h === 12) return '12 m.';
    return h < 12 ? `${h} a. m.` : `${h - 12} p. m.`;
  }

  rangoEvento(e: Evento): string {
    const f = (h: string) => {
      const [hh, mm] = h.split(':').map(Number);
      const s = hh < 12 ? 'a. m.' : 'p. m.';
      const h12 = hh % 12 === 0 ? 12 : hh % 12;
      return `${h12}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${s}`;
    };
    return `${f(e.hora_inicio)} – ${f(e.hora_fin)}`;
  }

  // ---------- Crear / editar ----------
  nuevoEn(iso: string, hora: number): void {
    this.errorEditor = '';
    this.editando = { titulo: '', nota: '', tipo: 'reunion', dia: iso, hora_inicio: aHora(hora * 60), hora_fin: aHora(Math.min(hora + 1, 23) * 60) };
  }

  nuevo(): void {
    const ahora = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Bogota' }));
    this.nuevoEn(this.diaSel, Math.min(Math.max(ahora + 1, HORA_INI), HORA_FIN - 1));
  }

  abrir(e: Evento, ev?: Event): void {
    ev?.stopPropagation();
    this.errorEditor = '';
    this.editando = { ...e };
  }

  cerrarEditor(): void {
    if (!this.guardando) this.editando = null;
  }

  async guardar(): Promise<void> {
    const e = this.editando;
    if (!e || this.guardando) return;
    const titulo = (e.titulo ?? '').trim();
    if (!titulo) {
      this.errorEditor = 'Ponle un nombre al evento.';
      return;
    }
    if (aMin(e.hora_fin) <= aMin(e.hora_inicio)) {
      this.errorEditor = 'La hora de fin debe ser después de la de inicio.';
      return;
    }
    this.guardando = true;
    this.errorEditor = '';
    const fila = { titulo, nota: (e.nota ?? '').trim() || null, tipo: e.tipo ?? 'reunion', dia: e.dia, hora_inicio: e.hora_inicio, hora_fin: e.hora_fin };
    const db = this.supabase.client;
    const { error } = e.id ? await db.from('eventos').update(fila).eq('id', e.id) : await db.from('eventos').insert(fila);
    this.guardando = false;
    if (error) {
      this.errorEditor = /eventos|relation|schema/i.test(error.message)
        ? 'El calendario todavía no está activado en el sistema.'
        : 'No se pudo guardar el evento. ' + error.message;
      this.cdr.detectChanges();
      return;
    }
    this.editando = null;
    await this.cargar();
  }

  async eliminar(): Promise<void> {
    const e = this.editando;
    if (!e?.id || this.guardando) return;
    if (!confirm(`¿Eliminar "${e.titulo}"?`)) return;
    this.guardando = true;
    const { error } = await this.supabase.client.from('eventos').delete().eq('id', e.id);
    this.guardando = false;
    if (error) {
      this.errorEditor = 'No se pudo eliminar. ' + error.message;
      this.cdr.detectChanges();
      return;
    }
    this.editando = null;
    await this.cargar();
  }

  // ---------- Arrastrar para mover (computador) ----------
  alArrastrar(e: Evento, ev: DragEvent): void {
    this.arrastrado = e;
    ev.dataTransfer?.setData('text/plain', e.id);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }

  permitirSoltar(ev: DragEvent): void {
    if (this.arrastrado) ev.preventDefault();
  }

  async soltarEn(iso: string, hora: number, ev: DragEvent): Promise<void> {
    ev.preventDefault();
    const e = this.arrastrado;
    this.arrastrado = null;
    if (!e) return;
    const dur = aMin(e.hora_fin) - aMin(e.hora_inicio);
    const ini = hora * 60;
    const fin = Math.min(ini + dur, 23 * 60 + 59);
    const cambio = { dia: iso, hora_inicio: aHora(ini), hora_fin: aHora(fin) };
    // Se mueve en pantalla de una vez; si falla, se recarga
    this.eventos = this.eventos.map((x) => (x.id === e.id ? { ...x, ...cambio } : x));
    this.cdr.detectChanges();
    const { error } = await this.supabase.client.from('eventos').update(cambio).eq('id', e.id);
    if (error) await this.cargar();
  }

  pesosCorto(n: number): string {
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M';
    if (n >= 1000) return '$' + Math.round(n / 1000).toLocaleString('es-CO') + ' mil';
    return '$' + n.toLocaleString('es-CO');
  }

  etiquetaTipo(t: TipoEvento): string {
    return TIPOS.find((x) => x.valor === t)?.etiqueta ?? t;
  }

  trackEvento(_: number, e: Evento): string {
    return e.id;
  }
}
