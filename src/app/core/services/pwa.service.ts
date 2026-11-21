// Ajustes de la app instalada (PWA) en iPhone y Android.
//  - Teclado: agrega body.teclado-abierto mientras se escribe, para esconder la
//    barra inferior flotante (si no, tapa el campo en Android y salta en iPhone).
//  - Versión nueva: la app instalada no se recarga sola y la gente se quedaba con
//    la versión vieja hasta cerrarla del todo. Al volver a la app (y cada 10 min)
//    se compara el index.html publicado con el cargado y se ofrece actualizar.
//  - Barra de estado de Android: el color sigue al tema (crema o verde oscuro).
import { Injectable, signal } from '@angular/core';

const CAMPOS_TEXTO = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=file]):not([type=color]), textarea, select, [contenteditable=true]';
const COLOR_CLARO = '#f3f2e9';
const COLOR_OSCURO = '#0e1511';

@Injectable({ providedIn: 'root' })
export class PwaService {
  /** true cuando hay una versión publicada más nueva que la cargada */
  readonly versionNueva = signal(false);
  private iniciado = false;
  private cerrarTeclado?: ReturnType<typeof setTimeout>;

  iniciar(): void {
    if (this.iniciado) return;
    this.iniciado = true;
    this.vigilarTeclado();
    this.vigilarVersion();
    this.colorBarraEstado();
  }

  actualizar(): void {
    location.reload();
  }

  // ---------- Teclado ----------
  private vigilarTeclado(): void {
    const body = document.body;
    document.addEventListener('focusin', (e) => {
      if ((e.target as Element)?.matches?.(CAMPOS_TEXTO)) {
        clearTimeout(this.cerrarTeclado);
        body.classList.add('teclado-abierto');
      }
    });
    document.addEventListener('focusout', (e) => {
      if (!(e.target as Element)?.matches?.(CAMPOS_TEXTO)) return;
      // Pequeña espera: al pasar de un campo a otro no debe parpadear la barra
      this.cerrarTeclado = setTimeout(() => {
        if (!document.activeElement?.matches?.(CAMPOS_TEXTO)) body.classList.remove('teclado-abierto');
      }, 150);
    });
    // Android: el teclado se puede cerrar con el botón atrás sin quitar el foco
    const vv = window.visualViewport;
    if (vv) {
      const base = { alto: window.innerHeight };
      vv.addEventListener('resize', () => {
        if (vv.height > base.alto * 0.85) {
          body.classList.remove('teclado-abierto');
          base.alto = Math.max(base.alto, vv.height);
        }
      });
    }
  }

  // ---------- Versión nueva ----------
  private vigilarVersion(): void {
    const revisar = () => this.revisarVersion().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') revisar();
    });
    setInterval(revisar, 10 * 60 * 1000);
  }

  private async revisarVersion(): Promise<void> {
    if (this.versionNueva()) return;
    const actual = this.firma(document);
    if (!actual) return; // en desarrollo los archivos no llevan huella
    const r = await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const html = await r.text();
    const publicado = this.firma(new DOMParser().parseFromString(html, 'text/html'));
    if (publicado && publicado !== actual) this.versionNueva.set(true);
  }

  /** Nombre del archivo main-XXXX.js (cambia con cada publicación) */
  private firma(doc: Document): string | null {
    const s = Array.from(doc.querySelectorAll('script[src]'))
      .map((e) => e.getAttribute('src') ?? '')
      .find((src) => /main-[\w-]+\.js$/.test(src));
    return s ?? null;
  }

  // ---------- Barra de estado (Android) ----------
  private colorBarraEstado(): void {
    let meta = document.querySelector('meta[name="theme-color"]:not([media])') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    const poner = () => (meta!.content = document.body.classList.contains('dark') ? COLOR_OSCURO : COLOR_CLARO);
    poner();
    new MutationObserver(poner).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
}
