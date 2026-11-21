import { Component, Input, computed, signal } from '@angular/core';

export interface Segmento {
  etiqueta: string;
  valor: number;
  color: string;
}

/**
 * Gráfica de dona en SVG (sin librerías): un segmento por color con un hueco
 * entre ellos y un valor en el centro. Al pasar el dedo o el mouse por un
 * segmento (o por su fila de la leyenda) se ve su porcentaje.
 */
@Component({
  selector: 'app-dona',
  standalone: true,
  styles: [
    `
      :host { display: block; }
      .caja { position: relative; width: var(--tam, 150px); aspect-ratio: 1; margin: 0 auto; }
      svg { width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; animation: gira 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
      circle { fill: none; transition: stroke-width 160ms ease, opacity 160ms ease; }
      .seg { animation: dibuja 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
      @keyframes gira { from { transform: rotate(-180deg); } }
      @keyframes dibuja { from { stroke-dasharray: 0 1000; } }
      @media (prefers-reduced-motion: reduce) { svg, .seg { animation: none; } }
      .pista { stroke: var(--surface-2); }
      .seg.apagado { opacity: 0.3; }
      .centro { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 18%; text-align: center; pointer-events: none; }
      .centro strong { font-family: var(--display-font); font-size: var(--tam-valor, 20px); font-weight: 500; line-height: 1.1; letter-spacing: -0.02em; color: var(--text); white-space: nowrap; font-variant-numeric: tabular-nums; }
      .centro span { margin-top: 3px; font-size: 11px; color: var(--text-muted); }
      .leyenda { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
      .leyenda li { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 9px; font-size: 13px; color: var(--text-soft); cursor: default; }
      .leyenda i { width: 10px; height: 10px; border-radius: 3px; }
      .leyenda b { font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
      .leyenda li.on { color: var(--text); }
      .vacia { margin: 0; font-size: 13px; color: var(--text-muted); text-align: center; }
    `,
  ],
  template: `
    <div class="caja" [style.--tam]="tam + 'px'" [style.--tam-valor]="tamValor + 'px'">
      <svg viewBox="0 0 100 100" role="img" [attr.aria-label]="etiquetaAria() || 'Sin datos'">
        <circle class="pista" cx="50" cy="50" [attr.r]="r" [attr.stroke-width]="grosor" />
        @for (a of arcos(); track a.etiqueta) {
          <circle
            class="seg"
            cx="50"
            cy="50"
            [attr.r]="r"
            [attr.stroke]="a.color"
            [attr.stroke-width]="enfocado() === a.etiqueta ? grosor + 3 : grosor"
            stroke-linecap="round"
            [attr.stroke-dasharray]="a.largo + ' ' + circ"
            [attr.stroke-dashoffset]="-a.inicio"
            [class.apagado]="enfocado() && enfocado() !== a.etiqueta"
            (mouseenter)="enfocado.set(a.etiqueta)"
            (mouseleave)="enfocado.set(null)"
            (click)="alternar(a.etiqueta)"
          >
            <title>{{ a.etiqueta }}: {{ a.pct }}%</title>
          </circle>
        }
      </svg>
      <div class="centro">
        @if (enfocadoSeg(); as e) {
          <strong>{{ e.pct }}%</strong><span>{{ e.etiqueta }}</span>
        } @else {
          <strong>{{ valor }}</strong>
          @if (etiqueta) {
            <span>{{ etiqueta }}</span>
          }
        }
      </div>
    </div>
    @if (leyenda) {
      @if (arcos().length) {
        <ul class="leyenda">
          @for (a of arcos(); track a.etiqueta) {
            <li [class.on]="enfocado() === a.etiqueta" (mouseenter)="enfocado.set(a.etiqueta)" (mouseleave)="enfocado.set(null)" (click)="alternar(a.etiqueta)">
              <i [style.background]="a.color"></i><span>{{ a.etiqueta }}</span><b>{{ formato ? formato(a.valor) : a.valor }}</b>
            </li>
          }
        </ul>
      } @else {
        <p class="vacia">{{ textoVacio }}</p>
      }
    }
  `,
})
export class DonaComponent {
  private segs = signal<Segmento[]>([]);
  @Input() set segmentos(v: Segmento[] | null | undefined) {
    this.segs.set((v ?? []).filter((s) => Number(s.valor) > 0));
  }
  /** Texto grande del centro */
  @Input() valor: string | number = '';
  /** Texto pequeño debajo del valor */
  @Input() etiqueta = '';
  @Input() tam = 150;
  @Input() tamValor = 20;
  @Input() leyenda = true;
  @Input() textoVacio = 'Todavía no hay datos.';
  /** Cómo mostrar cada valor en la leyenda (ej. pesos) */
  @Input() formato: ((n: number) => string) | null = null;

  readonly r = 40;
  readonly grosor = 11;
  readonly circ = 2 * Math.PI * 40;
  readonly enfocado = signal<string | null>(null);

  readonly arcos = computed(() => {
    const l = this.segs();
    const total = l.reduce((s, x) => s + Number(x.valor), 0);
    if (!total) return [];
    // Hueco entre segmentos, descontando lo que ocupan las puntas redondas
    const hueco = l.length > 1 ? this.grosor + 3 : 0;
    let inicio = 0;
    return l.map((x) => {
      const parte = (Number(x.valor) / total) * this.circ;
      const largo = Math.max(0.001, parte - hueco);
      const a = { ...x, inicio: inicio + hueco / 2, largo, pct: Math.round((Number(x.valor) / total) * 100) };
      inicio += parte;
      return a;
    });
  });
  readonly enfocadoSeg = computed(() => this.arcos().find((a) => a.etiqueta === this.enfocado()) ?? null);
  readonly etiquetaAria = computed(() => this.arcos().map((a) => `${a.etiqueta} ${a.pct}%`).join(', '));

  /** En el celular no hay "pasar el mouse": tocar un segmento lo muestra o lo quita */
  alternar(etiqueta: string): void {
    this.enfocado.set(this.enfocado() === etiqueta ? null : etiqueta);
  }
}
