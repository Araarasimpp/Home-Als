// "Tú" (pestaña de la barra del celular, como en jasta): tu foto y tu nombre
// arriba (al tocarlos se abre Mi perfil), el modo en que estás trabajando, y
// debajo todas las páginas en listas agrupadas. Reemplaza al menú "Más".
import { AfterViewInit, Component, ElementRef, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addCircleOutline,
  bagHandleOutline,
  barChartOutline,
  bicycleOutline,
  calendarOutline,
  cardOutline,
  chevronDownOutline,
  chevronForwardOutline,
  closeCircle,
  createOutline,
  cubeOutline,
  homeOutline,
  listOutline,
  logOutOutline,
  moonOutline,
  notificationsOutline,
  peopleCircleOutline,
  peopleOutline,
  personCircleOutline,
  receiptOutline,
  searchOutline,
  settingsOutline,
  shieldCheckmarkOutline,
  storefrontOutline,
  sunnyOutline,
  swapHorizontalOutline,
  timeOutline,
  trophyOutline,
  walletOutline,
} from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ThemeService } from '../../core/services/theme.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { InactividadService } from '../../core/services/inactividad.service';
import { AvatarComponent } from '../avatar/avatar.component';
import { CambioRolComponent, ETIQUETA_ROL } from '../cambio-rol/cambio-rol.component';
import { PaginaNav, SeccionNav } from '../escritorio/nav-escritorio.component';

const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

@Component({
  selector: 'app-tu',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, IonIcon, AvatarComponent, CambioRolComponent],
  styles: [
    `
      :host {
        display: block;
        min-height: 100%;
        color: var(--text);
      }
      .tu {
        max-width: 620px;
        margin: 0 auto;
        padding: 0 16px 28px;
      }

      /* Barra de arriba: botones redondos de vidrio; al bajar aparece el nombre en el centro */
      .tu-barra {
        position: sticky;
        top: 0;
        z-index: 5;
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        margin: 0 -16px;
        padding: 10px 16px;
        transition: background 200ms ease, box-shadow 200ms ease;
      }
      .tu-barra.chico {
        background: color-mix(in srgb, var(--bg) 74%, transparent);
        -webkit-backdrop-filter: blur(18px) saturate(180%);
        backdrop-filter: blur(18px) saturate(180%);
        box-shadow: 0 1px 0 var(--border);
      }
      .tu-mini {
        font-size: 16px;
        font-weight: 650;
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 200ms ease, transform 200ms ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 52vw;
      }
      .tu-barra.chico .tu-mini {
        opacity: 1;
        transform: none;
      }
      .tu-circ {
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        padding: 0;
        border-radius: 50%;
        cursor: pointer;
        text-decoration: none;
        border: 1px solid var(--border);
        color: var(--text);
        font-size: 19px;
        background: color-mix(in srgb, var(--surface) 70%, transparent);
        -webkit-backdrop-filter: blur(12px) saturate(180%);
        backdrop-filter: blur(12px) saturate(180%);
        box-shadow: var(--shadow-card);
        -webkit-tap-highlight-color: transparent;
      }
      .tu-circ:active {
        transform: scale(0.94);
      }
      .tu-der {
        justify-self: end;
        display: flex;
        width: auto;
        padding: 0 4px;
        border-radius: 999px;
      }
      .tu-der > * {
        position: relative;
        width: 38px;
        height: 36px;
        display: grid;
        place-items: center;
        border: none;
        background: none;
        color: inherit;
        font-size: 19px;
        cursor: pointer;
        padding: 0;
        text-decoration: none;
      }
      .tu-badge {
        position: absolute;
        top: 2px;
        right: 1px;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        box-sizing: border-box;
        border-radius: 999px;
        background: var(--danger);
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        line-height: 16px;
        text-align: center;
      }
      .tu-buscar {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 46px;
        margin: 4px 0 8px;
        padding: 0 12px;
        border: 1px solid var(--border);
        border-radius: 16px;
        background: var(--surface);
        box-shadow: var(--shadow-card);
      }
      .tu-buscar ion-icon {
        color: var(--text-muted);
        font-size: 18px;
      }
      .tu-buscar input {
        flex: 1;
        min-width: 0;
        height: 100%;
        border: none;
        background: none;
        color: var(--text);
        font: inherit;
        font-size: 16px;
        outline: none;
      }
      .tu-buscar button {
        border: none;
        background: none;
        color: var(--text-muted);
        font-size: 20px;
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        cursor: pointer;
        padding: 0;
      }

      /* Cabecera: modo de trabajo, foto grande, nombre y roles */
      .tu-cab {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 6px 0 16px;
      }
      .tu-nota {
        position: relative;
        z-index: 1;
        margin-bottom: -10px;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        max-width: 80%;
        padding: 7px 13px;
        border-radius: 16px;
        border: 1px solid var(--border);
        cursor: pointer;
        font: inherit;
        font-size: 12.5px;
        color: var(--text-soft);
        background: var(--surface);
        box-shadow: var(--shadow-card);
      }
      .tu-nota::after {
        content: '';
        position: absolute;
        left: 50%;
        bottom: -5px;
        width: 9px;
        height: 9px;
        margin-left: -4.5px;
        border-radius: 50%;
        border: 1px solid var(--border);
        background: var(--surface);
      }
      .tu-nota:disabled {
        cursor: default;
      }
      .tu-punto {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--data-green);
        flex-shrink: 0;
      }
      .tu-nota ion-icon {
        font-size: 14px;
        color: var(--text-muted);
      }
      .tu-foto {
        display: block;
        border-radius: 50%;
        -webkit-tap-highlight-color: transparent;
        transition: transform 160ms ease;
        box-shadow: 0 0 0 4px var(--surface), 0 14px 30px -12px rgba(27, 33, 29, 0.35);
      }
      .tu-foto:active {
        transform: scale(0.96);
      }
      .tu-nombre {
        margin-top: 14px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--text);
        text-decoration: none;
        font-family: var(--display-font);
        font-size: 27px;
        font-weight: 500;
        letter-spacing: -0.02em;
        text-align: center;
      }
      .tu-nombre ion-icon {
        font-size: 17px;
        color: var(--text-soft);
      }
      .tu-rol {
        margin: 2px 0 0;
        color: var(--text-muted);
        font-size: 14px;
        text-align: center;
      }

      /* Listas agrupadas (tarjetas con filas y flecha) */
      .tu-tit {
        margin: 20px 6px 8px;
        font-size: 12px;
        font-weight: 650;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      .tu-grupo {
        border-radius: 20px;
        background: var(--surface);
        overflow: hidden;
        border: 1px solid var(--border);
        box-shadow: var(--shadow-card);
      }
      .tu-fila {
        display: flex;
        align-items: center;
        gap: 14px;
        min-height: 54px;
        padding: 0 14px;
        color: var(--text);
        text-decoration: none;
        font: inherit;
        font-size: 15.5px;
        width: 100%;
        box-sizing: border-box;
        border: none;
        background: none;
        cursor: pointer;
        text-align: left;
        -webkit-tap-highlight-color: transparent;
      }
      .tu-fila + .tu-fila .tu-txt {
        box-shadow: 0 -1px 0 var(--border-soft, var(--border));
      }
      .tu-ico {
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        border-radius: 10px;
        background: var(--surface-2);
        color: var(--text-soft);
        font-size: 18px;
      }
      .tu-txt {
        flex: 1;
        align-self: stretch;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-width: 0;
      }
      .tu-txt span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tu-txt small {
        margin-left: auto;
        color: var(--text-muted);
        font-size: 13px;
      }
      .tu-flecha {
        font-size: 16px;
        color: var(--text-muted);
        flex-shrink: 0;
      }
      .tu-fila:active {
        background: var(--hover);
      }
      .tu-fila.active .tu-ico {
        background: var(--accent);
        color: var(--on-accent);
      }
      .tu-fila.peligro {
        color: var(--danger);
      }
      .tu-fila.peligro .tu-ico {
        background: var(--danger-wash);
        color: var(--danger);
      }
      .tu-vacio {
        margin: 24px 0;
        text-align: center;
        color: var(--text-soft);
        font-size: 14px;
      }
      .tu-version {
        margin: 18px 0 0;
        text-align: center;
        font-size: 12px;
        color: var(--text-muted);
      }
      @media (min-width: 861px) {
        .tu {
          padding-top: 16px;
          padding-bottom: 40px;
        }
      }
    `,
  ],
  template: `
    <div class="tu">
      <header class="tu-barra" [class.chico]="nombreFuera()">
        <button type="button" class="tu-circ" aria-label="Buscar página" (click)="alternarBuscar()"><ion-icon name="search-outline"></ion-icon></button>
        <span class="tu-mini" aria-hidden="true">{{ nombre() }}</span>
        <span class="tu-circ tu-der">
          <button type="button" (click)="theme.toggle()" [attr.aria-label]="theme.isDark() ? 'Modo claro' : 'Modo oscuro'">
            <ion-icon [name]="theme.isDark() ? 'sunny-outline' : 'moon-outline'"></ion-icon>
          </button>
          <button type="button" (click)="avisos.toggle()" [attr.aria-expanded]="avisos.abierto()"
            [attr.aria-label]="'Avisos' + (avisos.noLeidas() ? ', ' + avisos.noLeidas() + ' sin leer' : '')">
            <ion-icon name="notifications-outline"></ion-icon>
            @if (avisos.noLeidas()) { <span class="tu-badge">{{ avisos.noLeidas() > 9 ? '9+' : avisos.noLeidas() }}</span> }
          </button>
          <a [routerLink]="base + '/perfil'" aria-label="Editar perfil"><ion-icon name="create-outline"></ion-icon></a>
        </span>
      </header>

      @if (buscando()) {
        <label class="tu-buscar">
          <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
          <input #campo type="search" placeholder="Buscar página (ej: pagos, cuadres)" aria-label="Buscar página" autocomplete="off"
            [value]="busqueda()" (input)="busqueda.set($any($event.target).value)" />
          @if (busqueda()) {
            <button type="button" aria-label="Borrar búsqueda" (click)="busqueda.set('')"><ion-icon name="close-circle"></ion-icon></button>
          }
        </label>
      }

      <section class="tu-cab">
        <button type="button" class="tu-nota" [disabled]="!cr.disponible" (click)="cr.abrir()"
          [attr.aria-label]="cr.disponible ? 'Cambiar de rol: trabajando como ' + rolActual() : 'Trabajando como ' + rolActual()">
          <span class="tu-punto"></span>Trabajando como {{ rolActual() }}
          @if (cr.disponible) { <ion-icon name="swap-horizontal-outline" aria-hidden="true"></ion-icon> }
        </button>
        <a class="tu-foto" [routerLink]="base + '/perfil'" aria-label="Mi perfil: cambiar foto y nombre">
          <app-avatar [nombre]="supabase.perfil()?.nombre" [url]="supabase.perfil()?.avatar_url" [size]="104"></app-avatar>
        </a>
        <a #nombreEl class="tu-nombre" [routerLink]="base + '/perfil'">{{ nombre() }}<ion-icon name="chevron-down-outline" aria-hidden="true"></ion-icon></a>
        <p class="tu-rol">{{ rolesTexto() }}</p>
      </section>

      @if (buscando() && busqueda().trim()) {
        <div class="tu-grupo">
          @for (item of encontradas(); track item.path + item.label) {
            <a class="tu-fila" [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
              <span class="tu-ico"><ion-icon [name]="item.icon"></ion-icon></span>
              <span class="tu-txt"><span>{{ item.label }}</span><ion-icon class="tu-flecha" name="chevron-forward-outline"></ion-icon></span>
            </a>
          }
        </div>
        @if (!encontradas().length) { <p class="tu-vacio">No encontramos esa página. Prueba con otra palabra.</p> }
      } @else {
        @for (sec of secciones(); track sec.id) {
          <h3 class="tu-tit">{{ sec.label }}</h3>
          <div class="tu-grupo">
            @for (item of sec.paginas; track item.path + item.label) {
              <a class="tu-fila" [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
                <span class="tu-ico"><ion-icon [name]="item.icon"></ion-icon></span>
                <span class="tu-txt"><span>{{ item.label }}</span><ion-icon class="tu-flecha" name="chevron-forward-outline"></ion-icon></span>
              </a>
            }
          </div>
        }
        <h3 class="tu-tit">Preferencias</h3>
        <div class="tu-grupo">
          @if (cr.disponible) {
            <button type="button" class="tu-fila" (click)="cr.abrir()">
              <span class="tu-ico"><ion-icon name="swap-horizontal-outline"></ion-icon></span>
              <span class="tu-txt"><span>Cambiar de rol</span><small>{{ rolActual() }}</small><ion-icon class="tu-flecha" name="chevron-forward-outline"></ion-icon></span>
            </button>
          }
          <button type="button" class="tu-fila" (click)="theme.toggle()">
            <span class="tu-ico"><ion-icon [name]="theme.isDark() ? 'sunny-outline' : 'moon-outline'"></ion-icon></span>
            <span class="tu-txt"><span>{{ theme.isDark() ? 'Modo claro' : 'Modo oscuro' }}</span></span>
          </button>
        </div>
        <div class="tu-grupo" style="margin-top: 22px">
          <button type="button" class="tu-fila peligro" (click)="salir()">
            <span class="tu-ico"><ion-icon name="log-out-outline"></ion-icon></span>
            <span class="tu-txt"><span>Cerrar sesión</span></span>
          </button>
        </div>
        <p class="tu-version">Home ALS</p>
      }
    </div>
    <app-cambio-rol #cr></app-cambio-rol>
  `,
})
export class TuPage implements AfterViewInit, OnDestroy {
  supabase = inject(SupabaseService);
  theme = inject(ThemeService);
  avisos = inject(NotificacionesService);
  private inactividad = inject(InactividadService);
  private router = inject(Router);
  private ruta = inject(ActivatedRoute);

  private nombreEl = viewChild<ElementRef<HTMLElement>>('nombreEl');
  private campo = viewChild<ElementRef<HTMLInputElement>>('campo');
  private io?: IntersectionObserver;

  /** Ej. "/admin" (para Mi perfil) */
  readonly base: string = this.ruta.snapshot.data['base'] ?? '';
  /** Páginas que ya están en la barra de abajo no se repiten aquí */
  private readonly ocultar: string[] = this.ruta.snapshot.data['ocultar'] ?? [];
  private readonly todas: SeccionNav[] = this.ruta.snapshot.data['secciones'] ?? [];

  buscando = signal(false);
  busqueda = signal('');
  nombreFuera = signal(false);
  nombre = computed(() => this.supabase.perfil()?.nombre ?? '');
  rolActual = computed(() => {
    const r = this.supabase.perfil()?.role;
    return r ? ETIQUETA_ROL[r] : '';
  });
  rolesTexto = computed(() => {
    const p = this.supabase.perfil();
    const roles = p?.roles?.length ? p.roles : p?.role ? [p.role] : [];
    return roles.map((r) => ETIQUETA_ROL[r]).join(' · ');
  });

  /** Mi perfil ya está en la foto y lo de la barra de abajo no se repite */
  secciones = computed(() =>
    this.todas
      .map((s) => ({
        ...s,
        paginas: s.paginas.filter((p) => !p.atajo && !this.ocultar.includes(p.path) && !p.path.endsWith('/perfil')),
      }))
      .filter((s) => s.paginas.length)
  );

  encontradas = computed<PaginaNav[]>(() => {
    const q = normal(this.busqueda());
    if (!q) return [];
    return this.todas.flatMap((s) => s.paginas).filter((p) => !p.atajo && normal(p.label).includes(q));
  });

  constructor() {
    addIcons({
      addCircleOutline,
      bagHandleOutline,
      barChartOutline,
      bicycleOutline,
      calendarOutline,
      cardOutline,
      chevronDownOutline,
      chevronForwardOutline,
      closeCircle,
      createOutline,
      cubeOutline,
      homeOutline,
      listOutline,
      logOutOutline,
      moonOutline,
      notificationsOutline,
      peopleCircleOutline,
      peopleOutline,
      personCircleOutline,
      receiptOutline,
      searchOutline,
      settingsOutline,
      shieldCheckmarkOutline,
      storefrontOutline,
      sunnyOutline,
      swapHorizontalOutline,
      timeOutline,
      trophyOutline,
      walletOutline,
    });
  }

  ngAfterViewInit(): void {
    const el = this.nombreEl()?.nativeElement;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    this.io = new IntersectionObserver(([e]) => this.nombreFuera.set(!e.isIntersecting && e.boundingClientRect.top < 120), {
      rootMargin: '-70px 0px 0px 0px',
    });
    this.io.observe(el);
  }

  ngOnDestroy(): void {
    this.io?.disconnect();
  }

  alternarBuscar(): void {
    this.buscando.set(!this.buscando());
    if (!this.buscando()) this.busqueda.set('');
    else setTimeout(() => this.campo()?.nativeElement.focus(), 0);
  }

  async salir(): Promise<void> {
    if (!confirm('¿Cerrar sesión?')) return;
    this.inactividad.detener();
    this.avisos.detener();
    await this.supabase.logout();
    this.router.navigateByUrl('/auth/login');
  }
}
