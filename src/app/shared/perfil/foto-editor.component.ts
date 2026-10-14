// Encuadre de la foto de perfil: se arrastra la imagen dentro del círculo y se
// acerca con el control (o pellizcando con dos dedos). Devuelve un JPEG cuadrado.
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

const VISOR = 260; // px del área de encuadre
const SALIDA = 384; // px de la foto final (se ve nítida en pantallas retina)

@Component({
  selector: 'app-foto-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fe-fondo" (click)="cancelar.emit()"></div>
    <section class="fe-hoja" role="dialog" aria-modal="true" aria-labelledby="fe-titulo">
      <span class="fe-agarre" aria-hidden="true"></span>
      <h2 id="fe-titulo">Encuadra tu foto</h2>
      <p class="fe-ayuda">Arrastra para mover y usa el control para acercar.</p>

      <div
        class="fe-visor"
        #visor
        [style.width.px]="visorPx"
        [style.height.px]="visorPx"
        (pointerdown)="bajar($event)"
        (pointermove)="mover($event)"
        (pointerup)="subir($event)"
        (pointercancel)="subir($event)"
        (wheel)="rueda($event)"
        tabindex="0"
        aria-label="Área de encuadre. Usa las flechas para mover la foto."
        (keydown)="teclado($event)"
      >
        <img
          *ngIf="src"
          [src]="src"
          alt=""
          draggable="false"
          [style.width.px]="ancho * escala"
          [style.height.px]="alto * escala"
          [style.transform]="'translate(' + x + 'px,' + y + 'px)'"
        />
        <span class="fe-mascara" aria-hidden="true"></span>
      </div>

      <label class="fe-zoom">
        <span aria-hidden="true">−</span>
        <input type="range" min="1" max="4" step="0.01" [ngModel]="zoom" (ngModelChange)="cambiarZoom($event)" aria-label="Acercar o alejar" />
        <span aria-hidden="true">+</span>
      </label>

      <div class="fe-acciones">
        <button type="button" class="fe-btn" (click)="cancelar.emit()" [disabled]="guardando">Cancelar</button>
        <button type="button" class="fe-btn fe-primario" (click)="confirmar()" [disabled]="guardando || !src">
          {{ guardando ? 'Guardando…' : 'Usar esta foto' }}
        </button>
      </div>
    </section>
  `,
  styles: [
    `
      .fe-fondo { position: fixed; inset: 0; z-index: 200; background: rgba(10, 12, 16, 0.55); animation: aparecer 200ms ease-out; }
      .fe-hoja {
        position: fixed; z-index: 201; left: 0; right: 0; bottom: 0; margin: 0 auto; max-width: 440px;
        padding: 10px 20px calc(20px + env(safe-area-inset-bottom));
        display: flex; flex-direction: column; align-items: center; gap: 14px;
        background: var(--surface); color: var(--text);
        border-radius: 22px 22px 0 0; box-shadow: 0 -18px 50px -20px rgba(10, 12, 20, 0.45);
        max-height: calc(100vh - env(safe-area-inset-top) - 12px);
        max-height: calc(100dvh - env(safe-area-inset-top) - 12px);
        overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box;
        animation: subir 320ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .fe-hoja > * { flex-shrink: 0; }
      @media (min-width: 720px) {
        .fe-hoja { top: 50%; bottom: auto; transform: translateY(-50%); border-radius: 22px; padding-bottom: 20px; animation: aparecer 220ms ease-out; }
      }
      @keyframes subir { from { transform: translateY(100%); } }
      @keyframes aparecer { from { opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .fe-hoja, .fe-fondo { animation: none; } }
      .fe-agarre { width: 42px; height: 5px; border-radius: 3px; background: var(--border-strong); }
      h2 { margin: 2px 0 0; font-size: 17px; font-weight: 600; }
      .fe-ayuda { margin: -8px 0 0; font-size: 13px; color: var(--text-soft); text-align: center; }
      .fe-visor {
        position: relative; overflow: hidden; border-radius: 18px; background: #0d0f14;
        touch-action: none; cursor: grab; user-select: none; outline: none;
      }
      .fe-visor:active { cursor: grabbing; }
      .fe-visor:focus-visible { box-shadow: 0 0 0 3px var(--accent); }
      .fe-visor img { position: absolute; left: 0; top: 0; max-width: none; pointer-events: none; }
      /* Todo lo que queda por fuera del círculo se oscurece */
      .fe-mascara {
        position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
        box-shadow: 0 0 0 999px rgba(10, 12, 16, 0.62), inset 0 0 0 2px rgba(255, 255, 255, 0.85);
      }
      .fe-zoom { display: flex; align-items: center; gap: 12px; width: 100%; max-width: 300px; color: var(--text-soft); font-size: 20px; }
      .fe-zoom input { flex: 1; accent-color: var(--accent); height: 28px; }
      .fe-acciones { display: flex; gap: 10px; width: 100%; }
      .fe-btn {
        flex: 1; height: 48px; border-radius: var(--radius); border: 1px solid var(--border-strong);
        background: var(--surface); color: var(--text); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
      }
      .fe-primario { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
      .fe-btn:disabled { opacity: 0.6; cursor: progress; }
    `,
  ],
})
export class FotoEditorComponent implements AfterViewInit, OnDestroy {
  @Input() set archivo(f: File | null) {
    this.cargar(f);
  }
  @Input() guardando = false;
  @Output() listo = new EventEmitter<Blob>();
  @Output() cancelar = new EventEmitter<void>();
  @ViewChild('visor') visor?: ElementRef<HTMLDivElement>;

  readonly visorPx = VISOR;
  src: string | null = null;
  private img: HTMLImageElement | null = null;
  ancho = 0;
  alto = 0;
  base = 1; // escala para que la imagen cubra el visor
  zoom = 1;
  x = 0;
  y = 0;

  private punteros = new Map<number, { x: number; y: number }>();
  private distanciaInicial = 0;
  private zoomInicial = 1;

  constructor(private cdr: ChangeDetectorRef) {}

  get escala(): number {
    return this.base * this.zoom;
  }

  ngAfterViewInit(): void {
    this.visor?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    if (this.src) URL.revokeObjectURL(this.src);
  }

  @HostListener('document:keydown.escape')
  alEscape(): void {
    if (!this.guardando) this.cancelar.emit();
  }

  private cargar(f: File | null): void {
    if (this.src) URL.revokeObjectURL(this.src);
    this.src = null;
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      this.img = img;
      this.ancho = img.naturalWidth;
      this.alto = img.naturalHeight;
      this.base = VISOR / Math.min(this.ancho, this.alto);
      this.zoom = 1;
      this.x = (VISOR - this.ancho * this.escala) / 2;
      this.y = (VISOR - this.alto * this.escala) / 2;
      this.src = url;
      this.cdr.detectChanges();
    };
    img.src = url;
  }

  /** La imagen siempre cubre el círculo: no se puede dejar un borde vacío. */
  private limitar(): void {
    const w = this.ancho * this.escala, h = this.alto * this.escala;
    this.x = Math.min(0, Math.max(VISOR - w, this.x));
    this.y = Math.min(0, Math.max(VISOR - h, this.y));
  }

  /** Cambia el zoom manteniendo fijo el centro del visor. */
  cambiarZoom(z: number): void {
    const nuevo = Math.min(4, Math.max(1, Number(z)));
    const cx = (VISOR / 2 - this.x) / this.escala;
    const cy = (VISOR / 2 - this.y) / this.escala;
    this.zoom = nuevo;
    this.x = VISOR / 2 - cx * this.escala;
    this.y = VISOR / 2 - cy * this.escala;
    this.limitar();
  }

  bajar(e: PointerEvent): void {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.punteros.size === 2) {
      const [a, b] = [...this.punteros.values()];
      this.distanciaInicial = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoomInicial = this.zoom;
    }
  }

  mover(e: PointerEvent): void {
    const antes = this.punteros.get(e.pointerId);
    if (!antes) return;
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.punteros.size === 2) {
      const [a, b] = [...this.punteros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.distanciaInicial > 0) this.cambiarZoom(this.zoomInicial * (d / this.distanciaInicial));
    } else {
      this.x += e.clientX - antes.x;
      this.y += e.clientY - antes.y;
      this.limitar();
    }
  }

  subir(e: PointerEvent): void {
    this.punteros.delete(e.pointerId);
  }

  rueda(e: WheelEvent): void {
    e.preventDefault();
    this.cambiarZoom(this.zoom - e.deltaY * 0.002);
  }

  teclado(e: KeyboardEvent): void {
    const paso = 12;
    const mov: Record<string, [number, number]> = { ArrowLeft: [paso, 0], ArrowRight: [-paso, 0], ArrowUp: [0, paso], ArrowDown: [0, -paso] };
    if (mov[e.key]) {
      e.preventDefault();
      this.x += mov[e.key][0];
      this.y += mov[e.key][1];
      this.limitar();
    } else if (e.key === '+' || e.key === '=') this.cambiarZoom(this.zoom + 0.1);
    else if (e.key === '-') this.cambiarZoom(this.zoom - 0.1);
  }

  confirmar(): void {
    if (!this.img) return;
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = SALIDA;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    const lado = VISOR / this.escala;
    ctx.drawImage(this.img, -this.x / this.escala, -this.y / this.escala, lado, lado, 0, 0, SALIDA, SALIDA);
    lienzo.toBlob((b) => b && this.listo.emit(b), 'image/jpeg', 0.88);
  }
}
