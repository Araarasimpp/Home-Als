import { Component, Input } from '@angular/core';

/**
 * Avatar de una persona: muestra su foto si tiene, si no sus iniciales.
 * Sin nombre ni foto dibuja un círculo punteado (ej. "sin domiciliario").
 *
 * <app-avatar [nombre]="u.nombre" [url]="u.avatar_url" [size]="28"></app-avatar>
 */
@Component({
  selector: 'app-avatar',
  standalone: true,
  template: `
    @if (url && !fallo) {
      <img [src]="url" [alt]="nombre ? 'Foto de ' + nombre : ''" (error)="fallo = true" />
    } @else if (nombre) {
      <span aria-hidden="true">{{ iniciales }}</span>
    }
  `,
  host: {
    '[class.vacio]': '!nombre && !(url && !fallo)',
    '[style.width.px]': 'size',
    '[style.height.px]': 'size',
    '[style.font-size.px]': 'size * 0.42',
  },
  styles: [
    `
      :host {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        border-radius: 50%;
        overflow: hidden;
        background: var(--selected);
        color: var(--text-2);
        font-weight: 600;
        line-height: 1;
        user-select: none;
      }
      :host(.vacio) {
        background: none;
        border: 1.5px dashed var(--border-strong);
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
    `,
  ],
})
export class AvatarComponent {
  @Input() nombre: string | null | undefined = null;
  @Input() set url(valor: string | null | undefined) {
    this._url = valor ?? null;
    this.fallo = false; // si cambia la foto, se vuelve a intentar cargar
  }
  get url(): string | null {
    return this._url;
  }
  private _url: string | null = null;
  @Input() size = 20;

  fallo = false;

  get iniciales(): string {
    return (this.nombre ?? '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
  }
}
