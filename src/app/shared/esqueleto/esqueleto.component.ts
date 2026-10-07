// Esqueleto de carga: una vista previa gris de lo que va a aparecer (encabezado,
// tarjetas, listas o formulario) mientras llegan los datos, en lugar de un
// texto de "Cargando…".
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type TipoEsqueleto = 'lista' | 'tarjetas' | 'kpis' | 'formulario' | 'pagina';

@Component({
  selector: 'app-esqueleto',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="esq" [class.esq-compacto]="compacto" aria-busy="true" [attr.aria-label]="etiqueta" role="status">
      <!-- Página completa: encabezado + KPIs + lista -->
      <ng-container *ngIf="tipo === 'pagina'">
        <div class="esq-head">
          <span class="b" style="width: 120px; height: 10px"></span>
          <span class="b" style="width: 200px; height: 22px"></span>
        </div>
        <div class="esq-kpis">
          <div class="esq-kpi" *ngFor="let i of [1, 2, 3, 4]">
            <span class="b" style="width: 60%; height: 10px"></span>
            <span class="b" style="width: 80%; height: 20px"></span>
          </div>
        </div>
      </ng-container>

      <div class="esq-kpis" *ngIf="tipo === 'kpis'">
        <div class="esq-kpi" *ngFor="let i of rango">
          <span class="b" style="width: 60%; height: 10px"></span>
          <span class="b" style="width: 80%; height: 20px"></span>
        </div>
      </div>

      <div class="esq-lista" *ngIf="tipo === 'lista' || tipo === 'pagina'">
        <div class="esq-fila" *ngFor="let i of rango; let n = index">
          <span class="b esq-avatar"></span>
          <span class="esq-textos">
            <span class="b" [style.width.%]="anchos[n % anchos.length]" style="height: 12px"></span>
            <span class="b" [style.width.%]="anchos[(n + 2) % anchos.length] - 25" style="height: 10px"></span>
          </span>
          <span class="b" style="width: 64px; height: 14px"></span>
        </div>
      </div>

      <div class="esq-tarjetas" *ngIf="tipo === 'tarjetas'">
        <div class="esq-tarjeta" *ngFor="let i of rango">
          <span class="b" style="width: 100%; aspect-ratio: 1"></span>
          <span class="b" style="width: 80%; height: 12px"></span>
          <span class="b" style="width: 45%; height: 12px"></span>
        </div>
      </div>

      <div class="esq-form" *ngIf="tipo === 'formulario'">
        <div class="esq-campo" *ngFor="let i of rango">
          <span class="b" style="width: 120px; height: 10px"></span>
          <span class="b" style="width: 100%; height: 40px"></span>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .esq {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .esq-compacto {
        gap: 10px;
      }
      .b {
        display: block;
        border-radius: 6px;
        background: color-mix(in srgb, var(--text-muted, #8a8f98) 16%, transparent);
        animation: esq-pulso 1.3s ease-in-out infinite;
      }
      @keyframes esq-pulso {
        50% {
          opacity: 0.45;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .b {
          animation: none;
        }
      }
      .esq-head {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .esq-kpis {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        border: 1px solid var(--border);
        border-radius: var(--radius-lg, 10px);
        background: var(--surface);
        overflow: hidden;
      }
      .esq-kpi {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px 16px;
      }
      .esq-kpi + .esq-kpi {
        border-left: 1px solid var(--border);
      }
      .esq-lista {
        border: 1px solid var(--border);
        border-radius: var(--radius-lg, 10px);
        background: var(--surface);
        overflow: hidden;
      }
      .esq-compacto .esq-lista {
        border: none;
        background: none;
      }
      .esq-fila {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
      }
      .esq-compacto .esq-fila {
        padding: 8px 0;
      }
      .esq-fila + .esq-fila {
        border-top: 1px solid var(--border);
      }
      .esq-avatar {
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        border-radius: 50%;
      }
      .esq-textos {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .esq-tarjetas {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 12px;
      }
      .esq-tarjeta {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg, 10px);
        background: var(--surface);
      }
      .esq-form {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 16px;
      }
      .esq-campo {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      @media (max-width: 640px) {
        .esq-kpis {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .esq-kpi:nth-child(3) {
          border-left: none;
        }
        .esq-kpi:nth-child(n + 3) {
          border-top: 1px solid var(--border);
        }
      }
    `,
  ],
})
export class EsqueletoComponent {
  @Input() tipo: TipoEsqueleto = 'lista';
  /** Cuántas filas, tarjetas o campos se dibujan. */
  @Input() cantidad = 5;
  /** Versión sin borde ni fondo, para dentro de otra tarjeta. */
  @Input() compacto = false;
  @Input() etiqueta = 'Cargando';

  readonly anchos = [70, 55, 85, 60, 75];

  get rango(): number[] {
    return Array.from({ length: Math.max(1, this.cantidad) }, (_, i) => i);
  }
}
