import { Component, Input } from '@angular/core';
import { LowerCasePipe } from '@angular/common';
import { EvaluacionClave } from './clave';

/**
 * Barra de fuerza + lista de requisitos de una contraseña.
 * <app-medidor-clave [evaluacion]="evaluacion"></app-medidor-clave>
 */
@Component({
  selector: 'app-medidor-clave',
  standalone: true,
  imports: [LowerCasePipe],
  template: `
    @if (evaluacion.nivel === 'vacía') {
      <p class="pista">Mínimo 10 caracteres, con letras y números.</p>
    } @else {
      <div class="fila">
        <div class="medidor" [attr.data-puntaje]="evaluacion.puntaje" aria-hidden="true">
          @for (i of [0, 1, 2, 3]; track i) {
            <span [class.lleno]="i <= evaluacion.puntaje"></span>
          }
        </div>
        <span class="nivel" aria-live="polite">{{ evaluacion.nivel }}</span>
      </div>
      <!-- Solo lo que falta: cuando todo se cumple, la lista desaparece -->
      @if (pendientes.length) {
        <ul class="requisitos">
          @for (r of pendientes; track r.texto) {
            <li>
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <circle cx="8" cy="8" r="6.2" fill="none" stroke="var(--border-strong)" stroke-width="1.5" />
              </svg>
              <span>Falta: {{ r.texto | lowercase }}</span>
            </li>
          }
        </ul>
      }
    }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: 6px; }
      .pista { margin: 0; font-size: 12px; color: var(--text-muted); }
      .fila { display: flex; align-items: center; gap: 10px; }
      .medidor { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
      .medidor span { height: 4px; border-radius: 2px; background: var(--border); transition: background 160ms; }
      .medidor[data-puntaje='0'] .lleno, .medidor[data-puntaje='1'] .lleno { background: var(--danger); }
      .medidor[data-puntaje='2'] .lleno { background: var(--st-ruta); }
      .medidor[data-puntaje='3'] .lleno, .medidor[data-puntaje='4'] .lleno { background: var(--st-entregado); }
      .nivel { flex-shrink: 0; min-width: 64px; text-align: right; font-size: 12px; font-weight: 500; color: var(--text-soft); }
      .nivel::first-letter { text-transform: uppercase; }
      .requisitos { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
      .requisitos li { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
      .requisitos svg { flex-shrink: 0; }
    `,
  ],
})
export class MedidorClaveComponent {
  @Input({ required: true }) evaluacion!: EvaluacionClave;

  get pendientes() {
    return this.evaluacion.requisitos.filter((r) => !r.ok);
  }
}
