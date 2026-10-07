import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavController } from '@ionic/angular';
import { SupabaseService, UserRole } from '../services/supabase.service';
import { EsqueletoComponent } from '../../shared/esqueleto/esqueleto.component';

const CLAVE_ULTIMO_ROL = 'ultimo-rol';

/** Sección de inicio de cada rol. */
export const INICIO_ROL: Record<UserRole, string> = {
  admin: '/admin',
  vendedor: '/vendedor',
  domiciliario: '/domiciliario',
  despachador: '/despachador',
};

/** Recuerda el último rol para dibujar el esqueleto correcto la próxima vez. */
export function recordarRol(rol: UserRole): void {
  try {
    localStorage.setItem(CLAVE_ULTIMO_ROL, rol);
  } catch {
    /* sin almacenamiento: se usa el esqueleto por defecto */
  }
}

function ultimoRol(): UserRole | null {
  try {
    return localStorage.getItem(CLAVE_ULTIMO_ROL) as UserRole | null;
  } catch {
    return null;
  }
}

/**
 * Punto de entrada: decide a qué sección va la persona según su rol. Mientras
 * tanto muestra el esqueleto del menú y de la página (no un "Cargando...").
 */
@Component({
  selector: 'app-init',
  standalone: true,
  imports: [CommonModule, EsqueletoComponent],
  template: `
    <div class="ai" [class.ai-sidebar]="conSidebar">
      <aside class="ai-side" aria-hidden="true">
        <span class="ai-b ai-brand"></span>
        <span class="ai-b ai-item" *ngFor="let w of [70, 55, 80, 60, 65, 50]" [style.width.%]="w"></span>
      </aside>
      <main class="ai-main">
        <app-esqueleto tipo="pagina" [cantidad]="6" etiqueta="Abriendo Home ALS"></app-esqueleto>
      </main>
      <nav class="ai-tabs" aria-hidden="true">
        <span class="ai-tab" *ngFor="let i of [1, 2, 3, 4]"><span class="ai-b ai-icon"></span><span class="ai-b ai-label"></span></span>
      </nav>
    </div>
  `,
  styles: [
    `
      .ai {
        display: flex;
        height: 100vh;
        height: 100dvh;
        background: var(--bg);
        overflow: hidden;
      }
      .ai-b {
        display: block;
        border-radius: 6px;
        background: color-mix(in srgb, var(--text-muted, #8a8f98) 16%, transparent);
        animation: ai-pulso 1.3s ease-in-out infinite;
      }
      @keyframes ai-pulso {
        50% {
          opacity: 0.45;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .ai-b {
          animation: none;
        }
      }
      .ai-side {
        display: none;
        width: 232px;
        flex-shrink: 0;
        flex-direction: column;
        gap: 14px;
        padding: 16px 14px;
        box-sizing: border-box;
        background: var(--sidebar, var(--surface));
        border-right: 1px solid var(--border);
      }
      .ai-brand {
        width: 60%;
        height: 28px;
        margin-bottom: 10px;
      }
      .ai-item {
        height: 14px;
      }
      .ai-main {
        flex: 1;
        min-width: 0;
        max-width: 760px;
        margin: 0 auto;
        padding: 20px 16px calc(var(--tabbar-h, 56px) + 24px);
        box-sizing: border-box;
        overflow: hidden;
      }
      .ai-tabs {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        height: calc(var(--tabbar-h, 56px) + env(safe-area-inset-bottom));
        padding-bottom: env(safe-area-inset-bottom);
        background: var(--surface);
        border-top: 1px solid var(--border);
      }
      .ai-tab {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 5px;
      }
      .ai-icon {
        width: 20px;
        height: 20px;
        border-radius: 50%;
      }
      .ai-label {
        width: 36px;
        height: 8px;
      }
      /* Admin y despachador en computador: menú lateral */
      @media (min-width: 861px) {
        .ai-sidebar .ai-side {
          display: flex;
        }
        .ai-sidebar .ai-tabs {
          display: none;
        }
        .ai-sidebar .ai-main {
          max-width: none;
          margin: 0;
          padding: 28px 32px;
        }
      }
    `,
  ],
})
export class AppInitPage implements OnInit {
  readonly conSidebar: boolean;

  constructor(private supabase: SupabaseService, private nav: NavController) {
    const rol = ultimoRol();
    this.conSidebar = rol === 'admin' || rol === 'despachador';
  }

  ngOnInit(): void {
    this.redirigir();
  }

  // ion-router-outlet puede volver a mostrar esta misma página sin crearla de
  // nuevo (ngOnInit no se repite); por eso también se redirige al entrar.
  ionViewWillEnter(): void {
    this.redirigir();
  }

  private redirigiendo = false;

  private async redirigir(): Promise<void> {
    if (this.redirigiendo) return;
    this.redirigiendo = true;
    try {
      const profile = await this.supabase.getCurrentProfile();
      if (!profile) {
        await this.nav.navigateRoot('/auth/login', { animated: false });
        return;
      }
      recordarRol(profile.role);
      // navigateRoot limpia la pila de Ionic: esta página y los layouts de
      // otros roles se destruyen y no se reutilizan con datos viejos.
      await this.nav.navigateRoot(INICIO_ROL[profile.role] ?? '/auth/login', { animated: false });
    } finally {
      this.redirigiendo = false;
    }
  }
}
