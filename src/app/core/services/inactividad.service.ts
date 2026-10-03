import { Injectable, NgZone, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase.service';

const CLAVE = 'ultima-actividad';
const AVISO_MS = 60_000; // se avisa 1 minuto antes de cerrar

/**
 * Cierra la sesión tras un tiempo sin usar la app (útil en computadores
 * compartidos de la tienda). La última actividad se comparte entre pestañas
 * con localStorage, así que trabajar en una pestaña mantiene viva la otra.
 */
@Injectable({ providedIn: 'root' })
export class InactividadService {
  /** Segundos que faltan para cerrar (solo durante el último minuto), o null. */
  readonly segundosRestantes = signal<number | null>(null);

  private limiteMs = 0;
  private reloj: ReturnType<typeof setInterval> | null = null;
  private activo = false;
  private ultimoGuardado = 0;

  private readonly marcar = () => this.registrarActividad();

  constructor(private router: Router, private supabase: SupabaseService, private zone: NgZone) {}

  /**
   * Arranca con el tiempo definido en Configuración (inactividad_minutos;
   * 0 = nunca cerrar). Si no se puede leer, usa 30 minutos.
   */
  async iniciarConConfig(porDefecto = 30): Promise<void> {
    let minutos = porDefecto;
    const { data } = await this.supabase.client.from('configuracion').select('*').eq('id', true).single();
    const v = Number((data as any)?.inactividad_minutos);
    if (Number.isFinite(v) && v >= 0) minutos = v;
    if (minutos > 0) this.iniciar(minutos);
  }

  iniciar(minutos: number): void {
    this.limiteMs = minutos * 60_000;
    if (this.activo) return;
    this.activo = true;
    this.registrarActividad(true);
    const eventos = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
    this.zone.runOutsideAngular(() => {
      eventos.forEach((e) => window.addEventListener(e, this.marcar, { passive: true, capture: true }));
      this.reloj = setInterval(() => this.revisar(), 1000);
    });
  }

  detener(): void {
    if (!this.activo) return;
    this.activo = false;
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((e) =>
      window.removeEventListener(e, this.marcar, { capture: true } as any)
    );
    if (this.reloj) clearInterval(this.reloj);
    this.reloj = null;
    this.segundosRestantes.set(null);
  }

  /** "Seguir conectado" en el aviso */
  seguir(): void {
    this.registrarActividad(true);
    this.segundosRestantes.set(null);
  }

  private registrarActividad(forzar = false): void {
    const ahora = Date.now();
    // Se guarda como máximo cada 5 s para no escribir en cada movimiento
    if (!forzar && ahora - this.ultimoGuardado < 5000) return;
    this.ultimoGuardado = ahora;
    try {
      localStorage.setItem(CLAVE, String(ahora));
    } catch {
      /* sin almacenamiento: se usa solo la memoria */
    }
    if (this.segundosRestantes() !== null) this.zone.run(() => this.segundosRestantes.set(null));
  }

  private ultimaActividad(): number {
    const guardado = Number(localStorage.getItem(CLAVE));
    return Math.max(guardado || 0, this.ultimoGuardado);
  }

  private revisar(): void {
    const restante = this.limiteMs - (Date.now() - this.ultimaActividad());
    if (restante <= 0) {
      this.zone.run(() => this.cerrarSesion());
    } else if (restante <= AVISO_MS) {
      const s = Math.ceil(restante / 1000);
      if (this.segundosRestantes() !== s) this.zone.run(() => this.segundosRestantes.set(s));
    } else if (this.segundosRestantes() !== null) {
      this.zone.run(() => this.segundosRestantes.set(null));
    }
  }

  private async cerrarSesion(): Promise<void> {
    this.detener();
    await this.supabase.logout();
    this.router.navigate(['/auth/login'], { queryParams: { inactividad: '1' } });
  }
}
