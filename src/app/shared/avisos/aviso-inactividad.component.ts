import { Component } from '@angular/core';
import { InactividadService } from '../../core/services/inactividad.service';

/** Aviso que aparece el último minuto antes de cerrar la sesión por inactividad. */
@Component({
  selector: 'app-aviso-inactividad',
  standalone: true,
  template: `
    @if (inactividad.segundosRestantes() !== null) {
      <div class="fondo" role="alertdialog" aria-modal="true" aria-labelledby="t-inact" aria-describedby="d-inact">
        <div class="caja">
          <h2 id="t-inact">¿Sigues ahí?</h2>
          <p id="d-inact">
            Por seguridad, la sesión se cerrará en
            <strong>{{ inactividad.segundosRestantes() }} s</strong> por inactividad.
          </p>
          <button (click)="inactividad.seguir()">Seguir conectado</button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .fondo { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 16, 19, 0.5); }
      .caja { width: 100%; max-width: 360px; padding: 20px; border-radius: 14px; background: var(--surface); color: var(--text); box-shadow: var(--shadow-pop); text-align: center; }
      h2 { margin: 0 0 6px; font-size: 18px; font-weight: 600; }
      p { margin: 0 0 16px; font-size: 14px; line-height: 1.5; color: var(--text-soft); }
      strong { color: var(--text); font-variant-numeric: tabular-nums; }
      button { width: 100%; height: 46px; border: none; border-radius: var(--radius); background: var(--accent); color: var(--on-accent); font-size: 15px; font-weight: 500; cursor: pointer; }
    `,
  ],
})
export class AvisoInactividadComponent {
  constructor(public inactividad: InactividadService) {}
}
