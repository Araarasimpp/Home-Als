// Navegación de escritorio de admin y despachador, con el diseño de referencia:
// un riel angosto de íconos (una sección por ícono) + el panel de la sección
// abierta (título, sus páginas con contadores, el avance del día y la persona).
// La barra superior (migas, buscador, avisos y "+ Nuevo") es BarraSuperiorComponent.
import { Component, DestroyRef, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  chevronBackOutline,
  chevronForwardOutline,
  logOutOutline,
  searchOutline,
  sunnyOutline,
  moonOutline,
  notificationsOutline,
  add,
  swapHorizontalOutline,
  cardOutline,
  bagHandleOutline,
  homeOutline,
  receiptOutline,
  storefrontOutline,
  listOutline,
  peopleCircleOutline,
  walletOutline,
  barChartOutline,
  cubeOutline,
  peopleOutline,
  trophyOutline,
  timeOutline,
  settingsOutline,
  shieldCheckmarkOutline,
  personCircleOutline,
  checkmarkCircleOutline,
  bicycleOutline,
  calendarOutline,
} from 'ionicons/icons';
import { filter } from 'rxjs/operators';
import { SupabaseService } from '../../core/services/supabase.service';
import { ThemeService } from '../../core/services/theme.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { AvatarComponent } from '../avatar/avatar.component';
import { ETIQUETA_ROL } from '../cambio-rol/cambio-rol.component';
import { inicioDiaColombia } from '../fecha-colombia';

/** Clave de un contador que se muestra junto a una página del panel. */
export type ClaveConteo = 'porAlistar' | 'alistados' | 'enRuta' | 'cuadres';

export interface PaginaNav {
  label: string;
  path: string;
  icon: string;
  conteo?: ClaveConteo;
  /** Filtro de Pedidos que abre (ej. alistado) */
  query?: Record<string, string>;
  /** Acceso rápido de "Necesita atención": no cuenta para saber en qué sección se está */
  atajo?: boolean;
}

export interface SeccionNav {
  id: string;
  label: string;
  icon: string;
  subtitulo: string;
  paginas: PaginaNav[];
  /** Va abajo en el riel (Ajustes) */
  abajo?: boolean;
}

/** Sección y página que corresponden a una URL (la ruta más larga que coincide). */
export function ubicar(secciones: SeccionNav[], url: string): { seccion: SeccionNav; pagina: PaginaNav } {
  const limpia = url.split('?')[0].split('#')[0];
  let mejor = { seccion: secciones[0], pagina: secciones[0].paginas[0], largo: -1 };
  for (const s of secciones) {
    for (const p of s.paginas) {
      if (p.atajo) continue;
      const coincide = limpia === p.path || limpia.startsWith(p.path + '/');
      if (coincide && p.path.length > mejor.largo) mejor = { seccion: s, pagina: p, largo: p.path.length };
    }
  }
  return mejor;
}

/** Contadores en vivo para el panel (pedidos por alistar, en ruta, cuadres…). */
function usarConteos() {
  const supabase = inject(SupabaseService);
  const conteos = signal<Partial<Record<ClaveConteo, number>>>({});
  const hoy = signal<{ entregados: number; total: number } | null>(null);
  let ultima = 0;

  async function cargar(forzar = false): Promise<void> {
    if (!forzar && Date.now() - ultima < 20000) return;
    ultima = Date.now();
    const db = supabase.client;
    const contar = (q: any) => q.then((r: any) => (r.error ? undefined : (r.count ?? 0)));
    const inicio = inicioDiaColombia().toISOString();
    const [porAlistar, alistados, enRuta, cuadres, hoyTotal, hoyEntregados] = await Promise.all([
      contar(db.from('pedidos').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente').eq('canal', 'domicilio').is('alistado_at', null)),
      contar(db.from('pedidos').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente').not('alistado_at', 'is', null)),
      contar(db.from('pedidos').select('id', { count: 'exact', head: true }).eq('estado', 'en_ruta')),
      contar(db.from('cuadres').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')),
      contar(db.from('pedidos').select('id', { count: 'exact', head: true }).neq('estado', 'cancelado').gte('created_at', inicio)),
      contar(db.from('pedidos').select('id', { count: 'exact', head: true }).eq('estado', 'entregado').gte('created_at', inicio)),
    ]);
    conteos.set({ porAlistar, alistados, enRuta, cuadres });
    hoy.set(hoyTotal === undefined ? null : { entregados: hoyEntregados ?? 0, total: hoyTotal });
  }
  return { conteos, hoy, cargar };
}

@Component({
  selector: 'app-nav-escritorio',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, IonIcon, AvatarComponent],
  template: `
    <nav class="riel" aria-label="Secciones">
      <a class="marca" [routerLink]="secciones[0].paginas[0].path" aria-label="Inicio">
        <img src="assets/icon/logo.png" alt="" />
      </a>
      <div class="riel-grupo">
        @for (s of arriba; track s.id) {
          <ng-container *ngTemplateOutlet="icono; context: { $implicit: s }"></ng-container>
        }
      </div>
      <div class="riel-grupo riel-abajo">
        @for (s of abajo; track s.id) {
          <ng-container *ngTemplateOutlet="icono; context: { $implicit: s }"></ng-container>
        }
        <a class="riel-avatar" [routerLink]="rutaPerfil" [attr.aria-label]="'Mi perfil: ' + (supabase.perfil()?.nombre ?? '')">
          <app-avatar [nombre]="supabase.perfil()?.nombre" [url]="supabase.perfil()?.avatar_url" [size]="30"></app-avatar>
        </a>
      </div>
    </nav>

    <ng-template #icono let-s>
      <div class="riel-item" [class.activa]="s.id === actual().seccion.id">
        <a
          class="riel-btn"
          [routerLink]="s.paginas[0].path"
          [attr.aria-label]="s.label"
          [attr.aria-current]="s.id === actual().seccion.id ? 'page' : null"
          (click)="abrirSeccion(s)"
        >
          <ion-icon [name]="s.icon" aria-hidden="true"></ion-icon>
          @if (pendientes(s)) {
            <span class="punto" aria-hidden="true"></span>
          }
        </a>
        <!-- Con el panel cerrado, al pasar el mouse se ven las páginas de la sección -->
        <div class="flyout" role="menu">
          <p class="flyout-titulo">{{ s.label }}</p>
          @for (p of s.paginas; track p.path) {
            <a role="menuitem" [routerLink]="p.path">{{ p.label }}</a>
          }
        </div>
      </div>
    </ng-template>

    @if (!colapsado) {
      <aside class="panel" [attr.aria-label]="actual().seccion.label">
        <header class="panel-cabeza">
          <div>
            <h2>{{ actual().seccion.label }}</h2>
            <p>{{ actual().seccion.subtitulo }}</p>
          </div>
          <button class="cerrar" (click)="alternar.emit()" aria-label="Cerrar panel">
            <ion-icon name="chevron-back-outline"></ion-icon>
          </button>
        </header>

        <div class="paginas">
          @for (p of principales; track p.path) {
            <a
              class="pagina"
              [routerLink]="p.path"
              routerLinkActive="activa"
              [routerLinkActiveOptions]="{ exact: p.path === base }"
            >
              <span>{{ p.label }}</span>
              @if (p.conteo && conteos()[p.conteo]) {
                <span class="conteo num">{{ conteos()[p.conteo] }}</span>
              }
            </a>
          }
        </div>

        @if (atajos.length) {
          <p class="atencion-titulo">Necesita atención</p>
          <div class="paginas">
            @for (p of atajos; track p.label) {
              <a class="pagina atajo" [routerLink]="p.path" [queryParams]="p.query ?? null">
                <span class="atajo-texto"><ion-icon [name]="p.icon" aria-hidden="true"></ion-icon>{{ p.label }}</span>
                <span class="conteo num" [class.cero]="!conteos()[p.conteo!]">{{ conteos()[p.conteo!] ?? '–' }}</span>
              </a>
            }
          </div>
        }

        <div class="panel-pie">
          @if (hoy(); as h) {
            <a class="avance" [routerLink]="base + '/pedidos'">
              <span class="avance-fila">
                <strong>Entregas de hoy</strong>
                <span class="num">{{ h.entregados }}/{{ h.total }}</span>
              </span>
              <span class="avance-barra"><i [style.width.%]="h.total ? (h.entregados / h.total) * 100 : 0"></i></span>
              <span class="avance-nota">{{ h.total - h.entregados > 0 ? 'Faltan ' + (h.total - h.entregados) + ' por entregar' : 'Todo entregado' }}</span>
            </a>
          }
          <div class="persona">
            <app-avatar [nombre]="supabase.perfil()?.nombre" [url]="supabase.perfil()?.avatar_url" [size]="30"></app-avatar>
            <span class="persona-texto">
              <strong>{{ supabase.perfil()?.nombre }}</strong>
              <span>{{ rolActual }}</span>
            </span>
            <button class="salir" (click)="salir.emit()" aria-label="Cerrar sesión" title="Cerrar sesión">
              <ion-icon name="log-out-outline"></ion-icon>
            </button>
          </div>
        </div>
      </aside>
    }
  `,
  styleUrls: ['./nav-escritorio.component.scss'],
  host: { '[class.colapsado]': 'colapsado' },
})
export class NavEscritorioComponent implements OnInit {
  @Input({ required: true }) secciones: SeccionNav[] = [];
  /** '/admin' o '/despachador' */
  @Input({ required: true }) base = '';
  @Input() colapsado = false;
  @Output() alternar = new EventEmitter<void>();
  @Output() salir = new EventEmitter<void>();

  readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);
  private readonly url = signal(this.router.url);
  readonly actual = computed(() => ubicar(this.secciones, this.url()));
  private readonly datos = usarConteos();
  readonly conteos = this.datos.conteos;
  readonly hoy = this.datos.hoy;

  constructor() {
    addIcons({
      chevronBackOutline, logOutOutline, homeOutline, receiptOutline, storefrontOutline, listOutline,
      peopleCircleOutline, walletOutline, barChartOutline, cubeOutline, peopleOutline, trophyOutline,
      timeOutline, settingsOutline, shieldCheckmarkOutline, personCircleOutline, checkmarkCircleOutline, bicycleOutline, calendarOutline,
      cardOutline, bagHandleOutline,
    });
    const sub = this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.url.set(this.router.url);
      this.datos.cargar();
    });
    const reloj = setInterval(() => this.datos.cargar(true), 90000);
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      clearInterval(reloj);
    });
  }

  ngOnInit(): void {
    this.datos.cargar(true);
  }

  get principales(): PaginaNav[] {
    return this.actual().seccion.paginas.filter((p) => !p.atajo);
  }

  get atajos(): PaginaNav[] {
    return this.actual().seccion.paginas.filter((p) => p.atajo);
  }

  get arriba(): SeccionNav[] {
    return this.secciones.filter((s) => !s.abajo);
  }

  get abajo(): SeccionNav[] {
    return this.secciones.filter((s) => s.abajo);
  }

  get rutaPerfil(): string {
    return this.base + '/perfil';
  }

  get rolActual(): string {
    const r = this.supabase.perfil()?.role;
    return r ? ETIQUETA_ROL[r] : '';
  }

  /** Puntico en el ícono si alguna página de la sección tiene algo pendiente. */
  pendientes(s: SeccionNav): boolean {
    const c = this.conteos();
    return s.paginas.some((p) => !p.atajo && p.conteo && (c[p.conteo] ?? 0) > 0);
  }

  abrirSeccion(s: SeccionNav): void {
    if (this.colapsado && s.id === this.actual().seccion.id) this.alternar.emit();
  }
}

@Component({
  selector: 'app-barra-superior',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonIcon],
  template: `
    <nav class="migas" aria-label="Estás en">
      <span>Home ALS</span>
      <ion-icon class="sep" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
      @if (actual().seccion.label !== actual().pagina.label) {
        <span>{{ actual().seccion.label }}</span>
        <ion-icon class="sep" name="chevron-forward-outline" aria-hidden="true"></ion-icon>
      }
      <strong>{{ actual().pagina.label }}</strong>
    </nav>

    <form class="buscar" role="search" (ngSubmit)="buscar()">
      <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
      <input
        #campo
        name="q"
        type="search"
        [(ngModel)]="texto"
        placeholder="Buscar pedidos, clientes, barrios…"
        aria-label="Buscar pedidos"
        (keydown.escape)="texto = ''; campo.blur()"
      />
      <kbd aria-hidden="true">{{ atajo }}</kbd>
    </form>

    <div class="acciones">
      @if (puedeCambiarRol) {
        <button class="icono" (click)="cambiarRol.emit()" aria-label="Cambiar rol" title="Cambiar rol">
          <ion-icon name="swap-horizontal-outline"></ion-icon>
        </button>
      }
      <button class="icono" (click)="theme.toggle()" [attr.aria-label]="theme.isDark() ? 'Modo claro' : 'Modo oscuro'" [title]="theme.isDark() ? 'Modo claro' : 'Modo oscuro'">
        <ion-icon [name]="theme.isDark() ? 'sunny-outline' : 'moon-outline'"></ion-icon>
      </button>
      <button class="icono" (click)="avisos.toggle()" [class.on]="avisos.abierto()" [attr.aria-expanded]="avisos.abierto()" aria-label="Avisos" title="Avisos">
        <ion-icon name="notifications-outline"></ion-icon>
        @if (avisos.noLeidas()) {
          <span class="badge num">{{ avisos.noLeidas() > 9 ? '9+' : avisos.noLeidas() }}</span>
        }
      </button>
      <a class="nuevo" [routerLink]="base + '/pedidos/nuevo'">
        <ion-icon name="add" aria-hidden="true"></ion-icon>
        Nuevo pedido
      </a>
    </div>
  `,
  styleUrls: ['./barra-superior.component.scss'],
  host: { '(document:keydown)': 'atajoTeclado($event)' },
})
export class BarraSuperiorComponent {
  @Input({ required: true }) secciones: SeccionNav[] = [];
  @Input({ required: true }) base = '';
  @Input() puedeCambiarRol = false;
  @Output() cambiarRol = new EventEmitter<void>();

  readonly theme = inject(ThemeService);
  readonly avisos = inject(NotificacionesService);
  private readonly router = inject(Router);
  private readonly url = signal(this.router.url);
  readonly actual = computed(() => ubicar(this.secciones, this.url()));
  texto = '';
  readonly atajo = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

  constructor() {
    addIcons({ searchOutline, sunnyOutline, moonOutline, notificationsOutline, add, swapHorizontalOutline, chevronForwardOutline });
    const sub = this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.url.set(this.router.url));
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  /** Busca en Pedidos (cliente, barrio, número o producto). */
  buscar(): void {
    const q = this.texto.trim();
    this.router.navigate([this.base + '/pedidos'], { queryParams: q ? { q } : {} });
  }

  atajoTeclado(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      (document.querySelector('app-barra-superior input[type=search]') as HTMLInputElement | null)?.focus();
    }
  }
}
