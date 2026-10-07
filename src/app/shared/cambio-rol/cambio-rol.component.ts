// Selector de modo para quien tiene varios roles (ej. vendedor y domiciliario).
// Cada layout pone su propio botón y llama a abrir(); este componente muestra
// la lista de roles y hace el cambio.
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, NavController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { checkmark, close } from 'ionicons/icons';
import { SupabaseService, UserRole } from '../../core/services/supabase.service';
import { INICIO_ROL, recordarRol } from '../../core/app-init/app-init.page';

export const ETIQUETA_ROL: Record<UserRole, string> = {
  admin: 'Admin',
  despachador: 'Despachador',
  vendedor: 'Vendedor',
  domiciliario: 'Domiciliario',
};

const DESCRIPCION_ROL: Record<UserRole, string> = {
  admin: 'Todo el negocio: pedidos, productos, usuarios y reportes',
  despachador: 'Asignar pedidos, rótulos y cuadres',
  vendedor: 'Crear pedidos y ventas en local',
  domiciliario: 'Tu ruta, entregas y cuadre',
};

@Component({
  selector: 'app-cambio-rol',
  standalone: true,
  imports: [CommonModule, IonIcon],
  template: `
    <ng-container *ngIf="abierto">
      <button class="cr-fondo" aria-label="Cerrar" (click)="cerrar()"></button>
      <div class="cr-hoja" role="dialog" aria-modal="true" aria-labelledby="cr-titulo">
        <div class="cr-head">
          <h2 id="cr-titulo">Trabajar como</h2>
          <button class="cr-x" (click)="cerrar()" aria-label="Cerrar"><ion-icon name="close"></ion-icon></button>
        </div>
        <button
          *ngFor="let r of roles"
          class="cr-opcion"
          [class.on]="r === actual"
          [disabled]="cambiando"
          (click)="elegir(r)"
        >
          <span class="cr-texto">
            <strong>{{ etiqueta(r) }}</strong>
            <span>{{ r === destino ? 'Cambiando…' : descripcion(r) }}</span>
          </span>
          <span class="cr-spin" *ngIf="r === destino" aria-hidden="true"></span>
          <ion-icon *ngIf="r === actual && !destino" name="checkmark" aria-label="Actual"></ion-icon>
        </button>
        <p class="cr-error" role="alert" *ngIf="error">{{ error }}</p>
      </div>
    </ng-container>
  `,
  styles: [
    `
      .cr-fondo {
        position: fixed;
        inset: 0;
        z-index: 1000;
        border: none;
        background: rgba(10, 12, 16, 0.45);
      }
      .cr-hoja {
        position: fixed;
        z-index: 1001;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        width: min(420px, calc(100vw - 32px));
        padding: 8px;
        box-sizing: border-box;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg, 10px);
        background: var(--surface);
        box-shadow: var(--shadow-pop, 0 12px 32px rgba(0, 0, 0, 0.18));
      }
      @media (min-width: 900px) {
        .cr-hoja {
          top: 50%;
          bottom: auto;
          transform: translate(-50%, -50%);
        }
      }
      .cr-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 8px 10px;
      }
      .cr-head h2 {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        color: var(--text);
      }
      .cr-x {
        display: flex;
        width: 32px;
        height: 32px;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: var(--radius-sm, 6px);
        background: none;
        color: var(--text-soft);
        font-size: 18px;
        cursor: pointer;
      }
      .cr-opcion {
        display: flex;
        width: 100%;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border: 1px solid transparent;
        border-radius: var(--radius, 8px);
        background: none;
        color: var(--text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .cr-opcion:hover {
        background: var(--surface-2);
      }
      .cr-opcion.on {
        border-color: var(--accent);
        background: var(--accent-wash);
      }
      .cr-opcion ion-icon {
        color: var(--accent);
        font-size: 20px;
      }
      .cr-texto {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .cr-texto strong {
        font-size: 14px;
        font-weight: 600;
      }
      .cr-texto span {
        font-size: 12px;
        color: var(--text-soft);
      }
      .cr-opcion:disabled {
        cursor: progress;
      }
      .cr-spin {
        width: 18px;
        height: 18px;
        border: 2px solid var(--accent-wash);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: cr-giro 0.7s linear infinite;
      }
      @keyframes cr-giro {
        to {
          transform: rotate(360deg);
        }
      }
      .cr-error {
        margin: 8px;
        font-size: 13px;
        color: var(--danger);
      }
    `,
  ],
})
export class CambioRolComponent implements OnInit, OnDestroy {
  private destruido = false;
  abierto = false;
  cambiando = false;
  /** Rol al que se está cambiando (muestra el indicador en esa opción). */
  destino: UserRole | null = null;
  error = '';
  roles: UserRole[] = [];
  actual: UserRole | null = null;

  constructor(private supabase: SupabaseService, private nav: NavController, private cdr: ChangeDetectorRef) {
    addIcons({ checkmark, close });
  }

  async ngOnInit(): Promise<void> {
    const perfil = await this.supabase.getCurrentProfile();
    this.roles = perfil?.roles?.length ? perfil.roles : perfil ? [perfil.role] : [];
    this.actual = perfil?.role ?? null;
    this.cdr.detectChanges();
  }

  ngOnDestroy(): void {
    this.destruido = true;
  }

  /** true si la persona tiene más de un rol (los layouts muestran su botón solo así). */
  get disponible(): boolean {
    return this.roles.length > 1;
  }

  get etiquetaActual(): string {
    return this.actual ? ETIQUETA_ROL[this.actual] : '';
  }

  etiqueta(r: UserRole): string {
    return ETIQUETA_ROL[r] ?? r;
  }

  descripcion(r: UserRole): string {
    return DESCRIPCION_ROL[r] ?? '';
  }

  abrir(): void {
    if (this.cambiando) return;
    this.error = '';
    this.abierto = true;
    this.cdr.detectChanges();
  }

  cerrar(): void {
    this.abierto = false;
    this.cdr.detectChanges();
  }

  async elegir(r: UserRole): Promise<void> {
    if (this.cambiando) return;
    if (r === this.actual) {
      this.cerrar();
      return;
    }
    this.cambiando = true;
    this.destino = r;
    this.error = '';
    this.cdr.detectChanges();
    try {
      await conLimite(this.supabase.cambiarRol(r), 15000);
      recordarRol(r);
      this.actual = r;
      this.abierto = false;
      // Directo a la sección del nuevo rol. navigateRoot limpia la pila de
      // Ionic, así no se reutiliza ninguna pantalla vieja (antes se pasaba por
      // "/" y Ionic mostraba otra vez el "Cargando..." del arranque sin redirigir).
      await this.nav.navigateRoot(INICIO_ROL[r], { animated: false });
    } catch (e: any) {
      this.error = e?.message === 'tiempo'
        ? 'La conexión está lenta y no se pudo cambiar de rol. Intenta de nuevo.'
        : e?.message ?? 'No se pudo cambiar de rol.';
    } finally {
      this.cambiando = false;
      this.destino = null;
      // Al cambiar de rol este componente ya se destruyó con el layout anterior
      if (!this.destruido) this.cdr.detectChanges();
    }
  }
}

/** Rechaza si la promesa no termina a tiempo (para no dejar la pantalla esperando). */
function conLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((ok, falla) => {
    const t = setTimeout(() => falla(new Error('tiempo')), ms);
    promesa.then(
      (v) => {
        clearTimeout(t);
        ok(v);
      },
      (e) => {
        clearTimeout(t);
        falla(e);
      }
    );
  });
}
