// Fotos de soportes (comprobantes de pago, facturas): se comprimen, se suben de
// una vez al bucket privado "comprobantes" y se devuelven las rutas internas.
import { Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cameraOutline, closeOutline, imageOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { comprimirImagen } from '../imagenes/comprimir';

const BUCKET = 'comprobantes';

/** Enlaces firmados (1 hora) de varias rutas del bucket privado; '' si falla. */
export async function urlsComprobantes(db: SupabaseService['client'], rutas: string[]): Promise<string[]> {
  if (!rutas.length) return [];
  const { data } = await db.storage.from(BUCKET).createSignedUrls(rutas, 3600);
  const porRuta = new Map((data ?? []).map((d) => [d.path, d.signedUrl ?? '']));
  return rutas.map((r) => porRuta.get(r) ?? '');
}

@Component({
  selector: 'app-fotos-input',
  standalone: true,
  imports: [CommonModule, IonIcon],
  template: `
    <div class="fi">
      <span class="fi-etq">{{ titulo }}<em *ngIf="obligatorio"> · obligatorio</em></span>
      <div class="fi-fila">
        <div class="fi-foto" *ngFor="let r of rutas; let i = index">
          <img *ngIf="urls[r]" [src]="urls[r]" alt="" />
          <button type="button" class="fi-quitar" (click)="quitar(i)" [attr.aria-label]="'Quitar foto ' + (i + 1)">
            <ion-icon name="close-outline"></ion-icon>
          </button>
        </div>
        <label class="fi-agregar" [class.ocupado]="subiendo">
          <input type="file" accept="image/*" multiple (change)="elegir($event)" [disabled]="subiendo" />
          <span class="fi-spin" *ngIf="subiendo" aria-hidden="true"></span>
          <ion-icon *ngIf="!subiendo" [name]="rutas.length ? 'image-outline' : 'camera-outline'" aria-hidden="true"></ion-icon>
          <span>{{ subiendo ? 'Subiendo…' : rutas.length ? 'Otra foto' : 'Subir foto' }}</span>
        </label>
      </div>
      <small class="fi-pista" *ngIf="pista">{{ pista }}</small>
      <small class="fi-error" role="alert" *ngIf="error">{{ error }}</small>
    </div>
  `,
  styles: [
    `
      .fi { display: flex; flex-direction: column; gap: 8px; }
      .fi-etq { font-size: 13px; font-weight: 600; color: var(--text-soft); }
      .fi-etq em { font-style: normal; font-weight: 500; color: var(--text-muted); }
      .fi-fila { display: flex; flex-wrap: wrap; gap: 8px; }
      .fi-foto { position: relative; width: 76px; height: 76px; border-radius: 14px; overflow: hidden; border: 1px solid var(--border); background: var(--surface-2); }
      .fi-foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .fi-quitar { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: none;
        border-radius: 50%; background: rgba(20, 24, 21, 0.72); color: #fff; font-size: 15px; cursor: pointer; }
      .fi-agregar { width: 76px; height: 76px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
        border: 1.5px dashed var(--border-strong, var(--border)); border-radius: 14px; background: var(--surface); color: var(--text-soft);
        font-size: 11.5px; font-weight: 600; text-align: center; cursor: pointer; }
      .fi-agregar ion-icon { font-size: 22px; color: var(--accent); }
      .fi-agregar input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
      .fi-agregar:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
      .fi-agregar.ocupado { cursor: progress; opacity: 0.7; }
      .fi-spin { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--accent); animation: fi-giro 0.8s linear infinite; }
      @keyframes fi-giro { to { transform: rotate(360deg); } }
      .fi-pista { font-size: 12px; color: var(--text-muted); }
      .fi-error { font-size: 12.5px; color: var(--danger); }
    `,
  ],
})
export class FotosInputComponent implements OnChanges {
  private supabase = inject(SupabaseService);

  @Input() titulo = 'Fotos';
  @Input() pista = '';
  @Input() obligatorio = false;
  /** Carpeta dentro del bucket (ej. "pagos" o "recoleccion/<id>") */
  @Input() carpeta = 'pagos';
  @Input() rutas: string[] = [];
  @Output() cambio = new EventEmitter<string[]>();

  urls: Record<string, string> = {};
  subiendo = false;
  error = '';

  ngOnChanges(): void {
    void this.cargarUrls();
  }

  private async cargarUrls(): Promise<void> {
    const faltan = this.rutas.filter((r) => !this.urls[r]);
    if (!faltan.length) return;
    const urls = await urlsComprobantes(this.supabase.client, faltan);
    faltan.forEach((r, i) => (this.urls[r] = urls[i]));
  }

  async elegir(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files ?? []);
    input.value = '';
    if (!archivos.length) return;
    this.subiendo = true;
    this.error = '';
    const nuevas: string[] = [];
    try {
      for (const original of archivos.slice(0, 6)) {
        const file = await comprimirImagen(original, 'comprobante');
        const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
        const ruta = `${this.carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await this.supabase.client.storage.from(BUCKET).upload(ruta, file, { upsert: false, contentType: file.type });
        if (error) throw error;
        this.urls[ruta] = URL.createObjectURL(file);
        nuevas.push(ruta);
      }
    } catch (e: any) {
      this.error = 'No se pudo subir la foto. Revisa la conexión e intenta otra vez.';
      console.error(e);
    } finally {
      this.subiendo = false;
      if (nuevas.length) this.cambio.emit([...this.rutas, ...nuevas]);
    }
  }

  quitar(i: number): void {
    const r = this.rutas[i];
    this.cambio.emit(this.rutas.filter((_, j) => j !== i));
    // Se borra del bucket; si no hay permiso de borrar, solo queda huérfana
    void this.supabase.client.storage.from(BUCKET).remove([r]);
  }

  constructor() {
    addIcons({ cameraOutline, closeOutline, imageOutline });
  }
}
