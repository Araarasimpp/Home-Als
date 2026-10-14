// Tarjeta del inicio (vendedor y domiciliario): "Vas #2 de 15 este mes" + meta.
// Toca la tarjeta para ver el ranking completo.
import { ChangeDetectorRef, Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { FilaRanking, TipoRanking, ordenarRanking, puntaje, rangoPeriodo, textoVentas } from './ranking.page';

@Component({
  selector: 'app-mi-puesto',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <a class="mp" *ngIf="listo" [routerLink]="ruta" aria-label="Ver el ranking completo">
      <span class="mp-ico" aria-hidden="true">{{ medalla }}</span>
      <span class="mp-txt">
        <strong *ngIf="puesto; else sinPuesto">Vas #{{ puesto }} de {{ total }} este mes</strong>
        <ng-template #sinPuesto><strong>Ranking del mes</strong></ng-template>
        <span>{{ detalle }}</span>
        <span class="mp-barra" *ngIf="avance !== null"><i [style.width.%]="avance" [class.ok]="avance === 100"></i></span>
      </span>
      <span class="mp-ver" aria-hidden="true">Ver ›</span>
    </a>
  `,
  styles: [
    `
      .mp {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: linear-gradient(135deg, var(--accent-wash), var(--surface) 70%);
        color: var(--text);
        text-decoration: none;
      }
      .mp-ico {
        font-size: 32px;
        line-height: 1;
      }
      .mp-txt {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .mp-txt strong {
        font-size: 15px;
        font-weight: 600;
      }
      .mp-txt > span {
        font-size: 13px;
        color: var(--text-soft);
      }
      .mp-barra {
        display: block;
        height: 6px;
        margin-top: 4px;
        border-radius: 3px;
        background: var(--surface-2);
        overflow: hidden;
      }
      .mp-barra i {
        display: block;
        height: 100%;
        border-radius: 3px;
        background: var(--accent);
      }
      .mp-barra i.ok {
        background: var(--st-entregado);
      }
      .mp-ver {
        font-size: 13px;
        font-weight: 600;
        color: var(--accent);
        white-space: nowrap;
      }
    `,
  ],
})
export class MiPuestoComponent implements OnInit {
  @Input() tipo: TipoRanking = 'vendedor';
  @Input() ruta = '';

  listo = false;
  puesto: number | null = null;
  total = 0;
  medalla = '🏆';
  detalle = '';
  avance: number | null = null;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    const user = await this.supabase.getCurrentUser();
    const { desde, hasta } = rangoPeriodo('mes');
    const { data, error } = await this.supabase.client.rpc('ranking', { p_desde: desde, p_hasta: hasta });
    if (error || !user) return; // sin la función en la base, la tarjeta no aparece
    const lista = ordenarRanking(((data ?? []) as FilaRanking[]).filter((f) => f.tipo === this.tipo));
    const i = lista.findIndex((f) => f.usuario_id === user.id);
    this.total = lista.length;
    if (i >= 0) {
      const yo = lista[i];
      const p = puntaje(yo);
      this.puesto = p > 0 ? i + 1 : null;
      this.medalla = p > 0 ? (['🥇', '🥈', '🥉'][i] ?? '🏆') : '🏁';
      const valor = this.tipo === 'domiciliario'
        ? `${p} ${p === 1 ? 'entrega' : 'entregas'}`
        : yo.ventas == null
          ? textoVentas(Number(yo.pedidos))
          : Number(p).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }) + ' vendidos';
      const avance = yo.avance != null ? Number(yo.avance) : yo.meta ? Math.min(100, Math.round((p / Number(yo.meta)) * 100)) : null;
      if (avance !== null) {
        this.avance = avance;
        this.detalle = `${valor} · ${this.avance}% de tu meta`;
      } else {
        this.detalle = p > 0 ? valor : '¡Arranca el mes y súbete al podio!';
      }
    } else {
      this.detalle = 'Mira quién va ganando';
    }
    this.listo = true;
    this.cdr.detectChanges();
  }
}
