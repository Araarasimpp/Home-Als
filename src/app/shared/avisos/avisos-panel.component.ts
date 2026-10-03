import { Component, Input } from '@angular/core';
import { NotificacionesService, Aviso } from '../../core/services/notificaciones.service';

/**
 * Panel de avisos. Se abre con el botón de campana del layout.
 * posicion = 'sidebar': junto al menú lateral (escritorio)
 * posicion = 'barra':   sobre la barra inferior (celular)
 */
@Component({
  selector: 'app-avisos-panel',
  standalone: true,
  template: `
    @if (avisos.abierto()) {
      <button class="fondo" aria-label="Cerrar avisos" (click)="avisos.cerrar()"></button>
      <section class="panel" [class.barra]="posicion === 'barra'" role="dialog" aria-label="Avisos">
        <header>
          <h2>Avisos</h2>
          @if (avisos.noLeidas()) {
            <button class="link" (click)="avisos.marcarTodasLeidas()">Marcar todo como leído</button>
          }
        </header>

        @if (avisos.permiso() === 'default') {
          <div class="permiso">
            <p>Activa los avisos para enterarte aunque estés en otra pestaña.</p>
            <button (click)="avisos.pedirPermiso()">Activar avisos</button>
          </div>
        } @else if (avisos.permiso() === 'denied') {
          <p class="permiso permiso-off">
            Los avisos del sistema están bloqueados en este navegador. Puedes activarlos desde el candado junto a la dirección.
          </p>
        }

        <div class="lista">
          @for (a of avisos.avisos(); track a.id) {
            <button class="aviso" [class.nuevo]="!a.leida" (click)="avisos.abrirAviso(a)">
              <span class="punto" [attr.data-tipo]="a.tipo" aria-hidden="true"></span>
              <span class="texto">
                <span class="titulo">{{ a.titulo }}</span>
                @if (a.cuerpo) {
                  <span class="cuerpo">{{ a.cuerpo }}</span>
                }
                <span class="hora">{{ hace(a) }}</span>
              </span>
            </button>
          } @empty {
            <p class="vacio">No tienes avisos todavía. Aquí verás pedidos nuevos, asignaciones y cuadres.</p>
          }
        </div>
      </section>
    }
  `,
  styles: [
    `
      .fondo { position: fixed; inset: 0; z-index: 140; border: none; padding: 0; background: rgba(15, 16, 19, 0.2); }
      .panel {
        position: fixed; z-index: 141; left: 240px; bottom: 16px; width: 380px;
        max-height: min(560px, calc(100dvh - 32px)); display: flex; flex-direction: column;
        background: var(--surface); color: var(--text); border: 1px solid var(--border);
        border-radius: var(--radius-lg); box-shadow: var(--shadow-pop); overflow: hidden;
        animation: subir 180ms var(--ease);
      }
      .panel.barra {
        left: 8px; right: 8px; width: auto; margin: 0 auto; max-width: 480px;
        bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 8px);
        max-height: calc(100dvh - var(--tabbar-h) - 40px);
      }
      @media (max-width: 860px) {
        .panel:not(.barra) {
          left: 8px; right: 8px; width: auto;
          bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 8px);
          max-height: calc(100dvh - var(--tabbar-h) - 40px);
        }
      }
      @keyframes subir { from { opacity: 0; transform: translateY(6px); } }
      header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border-soft); }
      h2 { margin: 0; font-size: 15px; font-weight: 600; }
      .link { border: none; background: none; padding: 4px 0; color: var(--accent); font-size: 12px; font-weight: 500; cursor: pointer; }
      .permiso { margin: 10px 12px 0; padding: 10px 12px; border-radius: var(--radius); background: var(--accent-wash); font-size: 13px; line-height: 1.45; }
      .permiso p { margin: 0 0 8px; }
      .permiso button { height: 32px; padding: 0 12px; border: none; border-radius: var(--radius-sm); background: var(--accent); color: var(--on-accent); font-size: 13px; font-weight: 500; cursor: pointer; }
      .permiso-off { background: var(--surface-2); color: var(--text-soft); }
      .lista { overflow-y: auto; padding: 6px; }
      .aviso { width: 100%; display: flex; gap: 10px; padding: 10px; border: none; border-radius: var(--radius); background: none; color: var(--text); text-align: left; cursor: pointer; }
      .aviso:hover { background: var(--hover); }
      .aviso.nuevo { background: var(--accent-wash); }
      .punto { width: 8px; height: 8px; margin-top: 6px; flex-shrink: 0; border-radius: 50%; background: var(--border-strong); }
      .aviso.nuevo .punto { background: var(--accent); }
      .punto[data-tipo='pedido_cancelado'] { background: var(--danger) !important; }
      .punto[data-tipo='pedido_entregado'], .punto[data-tipo='cuadre_confirmado'] { background: var(--st-entregado) !important; }
      .texto { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .titulo { font-size: 14px; font-weight: 500; }
      .cuerpo { font-size: 13px; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; }
      .hora { font-size: 11px; color: var(--text-muted); }
      .vacio { margin: 0; padding: 24px 12px; text-align: center; font-size: 13px; line-height: 1.5; color: var(--text-soft); }
    `,
  ],
})
export class AvisosPanelComponent {
  @Input() posicion: 'sidebar' | 'barra' = 'sidebar';

  constructor(public avisos: NotificacionesService) {}

  hace(a: Aviso): string {
    const s = Math.round((Date.now() - new Date(a.created_at).getTime()) / 1000);
    if (s < 60) return 'Hace un momento';
    if (s < 3600) return `Hace ${Math.floor(s / 60)} min`;
    if (s < 86400) return `Hace ${Math.floor(s / 3600)} h`;
    return new Date(a.created_at).toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Bogota',
    });
  }
}
