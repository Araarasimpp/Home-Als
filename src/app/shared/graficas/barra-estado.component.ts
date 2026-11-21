import { Component, Input, computed, signal } from '@angular/core';
import { Segmento } from './dona.component';

/**
 * Barra de estado apilada: una sola barra horizontal partida en colores según
 * cuánto pesa cada parte (ej. entregados, en ruta, pendientes), con su leyenda.
 * Con `meta` se vuelve una barra de avance (valor de 0 a meta).
 */
@Component({
  selector: 'app-barra-estado',
  standalone: true,
  styles: [
    `
      :host { display: block; }
      .cabeza { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 7px; font-size: 13px; }
      .cabeza span { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cabeza b { font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .barra { display: flex; gap: 3px; height: var(--alto, 10px); border-radius: 999px; background: var(--surface-2); overflow: hidden; }
      .barra i { display: block; height: 100%; border-radius: 999px; transform-origin: left; animation: crece 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
      @keyframes crece { from { transform: scaleX(0); } }
      @media (prefers-reduced-motion: reduce) { .barra i { animation: none; } }
      .leyenda { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 9px 0 0; padding: 0; font-size: 12px; color: var(--text-soft); }
      .leyenda li { display: inline-flex; align-items: center; gap: 6px; }
      .leyenda i { width: 8px; height: 8px; border-radius: 2px; }
      .leyenda b { font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
    `,
  ],
  template: `
    @if (titulo) {
      <div class="cabeza">
        <span>{{ titulo }}</span>
        @if (resumen) {
          <b>{{ resumen }}</b>
        }
      </div>
    }
    <div class="barra" [style.--alto]="alto + 'px'" role="img" [attr.aria-label]="aria()">
      @for (p of partes(); track p.etiqueta) {
        <i [style.flex-grow]="p.valor" [style.background]="p.color" [title]="p.etiqueta + ': ' + p.valor"></i>
      }
      @if (resto() > 0) {
        <i class="resto" [style.flex-grow]="resto()" style="background: transparent"></i>
      }
    </div>
    @if (leyenda && partes().length > 1) {
      <ul class="leyenda">
        @for (p of partes(); track p.etiqueta) {
          <li><i [style.background]="p.color"></i>{{ p.etiqueta }} <b>{{ formato ? formato(p.valor) : p.valor }}</b></li>
        }
      </ul>
    }
  `,
})
export class BarraEstadoComponent {
  private segs = signal<Segmento[]>([]);
  private tope = signal<number | null>(null);
  @Input() set segmentos(v: Segmento[] | null | undefined) {
    this.segs.set((v ?? []).filter((s) => Number(s.valor) > 0));
  }
  /** Si se da, la barra muestra el avance hacia este total (el resto queda vacío) */
  @Input() set meta(v: number | null | undefined) {
    this.tope.set(v ?? null);
  }
  @Input() titulo = '';
  @Input() resumen = '';
  @Input() alto = 10;
  @Input() leyenda = true;
  @Input() formato: ((n: number) => string) | null = null;

  readonly partes = computed(() => this.segs());
  readonly resto = computed(() => {
    const t = this.tope();
    if (!t) return 0;
    const usado = this.segs().reduce((s, x) => s + Number(x.valor), 0);
    return Math.max(0, t - usado);
  });
  readonly aria = computed(() => {
    const total = this.segs().reduce((s, x) => s + Number(x.valor), 0) + this.resto();
    if (!total) return this.titulo + ': sin datos';
    return `${this.titulo}: ` + this.segs().map((s) => `${s.etiqueta} ${Math.round((Number(s.valor) / total) * 100)}%`).join(', ');
  });
}
