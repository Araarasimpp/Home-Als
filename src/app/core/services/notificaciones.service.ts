import { Injectable, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

/** Estado de los avisos con la app cerrada (push) en este dispositivo. */
export type EstadoPush = 'activo' | 'inactivo' | 'no-soportado' | 'instalar-ios' | 'error';

const SW_URL = '/assets/sw-push.js';

export interface Aviso {
  id: string;
  tipo: string;
  titulo: string;
  cuerpo: string | null;
  url: string | null;
  leida: boolean;
  created_at: string;
}

/**
 * Avisos de la app (pedido asignado, pedido nuevo, cuadre cerrado…).
 * Los crea la base de datos con triggers y llegan al instante por Realtime.
 * Con permiso del navegador, además se muestra un aviso del sistema y suena.
 * Con "push" activo, los avisos llegan aunque la app esté cerrada: los envía
 * la Edge Function enviar-push y los muestra el service worker sw-push.js.
 */
@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  readonly avisos = signal<Aviso[]>([]);
  readonly noLeidas = computed(() => this.avisos().filter((a) => !a.leida).length);
  readonly abierto = signal(false);
  readonly permiso = signal<NotificationPermission | 'no-soportado'>(
    typeof Notification === 'undefined' ? 'no-soportado' : Notification.permission
  );

  readonly push = signal<EstadoPush>(this.estadoPushInicial());

  private canal: RealtimeChannel | null = null;
  private usuarioId: string | null = null;

  constructor(private supabase: SupabaseService, private router: Router) {}

  /** Se llama desde cada layout al entrar. Seguro de llamar varias veces. */
  async iniciar(): Promise<void> {
    const user = await this.supabase.getCurrentUser();
    if (!user || user.id === this.usuarioId) return;
    this.detener();
    this.usuarioId = user.id;

    const { data } = await this.supabase.client
      .from('notificaciones')
      .select('id, tipo, titulo, cuerpo, url, leida, created_at')
      .order('created_at', { ascending: false })
      .limit(40);
    this.avisos.set((data ?? []) as Aviso[]);

    this.canal = this.supabase.client
      .channel(`avisos-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: `usuario_id=eq.${user.id}` },
        (payload) => this.recibir(payload.new as Aviso)
      )
      .subscribe();

    // Si en este dispositivo ya se dio permiso, se renueva la suscripción en
    // silencio (por ejemplo, si ahora entró otra persona en el mismo celular)
    if (this.permiso() === 'granted' && this.push() !== 'no-soportado' && this.push() !== 'instalar-ios') {
      this.activarPush().catch(() => {});
    }
  }

  detener(): void {
    if (this.canal) this.supabase.client.removeChannel(this.canal);
    this.canal = null;
    this.usuarioId = null;
    this.avisos.set([]);
    this.abierto.set(false);
  }

  private recibir(aviso: Aviso): void {
    this.avisos.update((lista) => [aviso, ...lista].slice(0, 60));
    this.sonar();
    this.avisoDelSistema(aviso);
  }

  toggle(): void {
    this.abierto.update((v) => !v);
  }

  cerrar(): void {
    this.abierto.set(false);
  }

  async abrirAviso(aviso: Aviso): Promise<void> {
    this.cerrar();
    if (!aviso.leida) await this.marcarLeida(aviso.id);
    if (aviso.url) this.router.navigateByUrl(aviso.url);
  }

  async marcarLeida(id: string): Promise<void> {
    this.avisos.update((l) => l.map((a) => (a.id === id ? { ...a, leida: true } : a)));
    await this.supabase.client.from('notificaciones').update({ leida: true }).eq('id', id);
  }

  async marcarTodasLeidas(): Promise<void> {
    const ids = this.avisos().filter((a) => !a.leida).map((a) => a.id);
    if (!ids.length) return;
    this.avisos.update((l) => l.map((a) => ({ ...a, leida: true })));
    await this.supabase.client.from('notificaciones').update({ leida: true }).in('id', ids);
  }

  /** Pide permiso para mostrar avisos del sistema y los activa con la app cerrada. */
  async pedirPermiso(): Promise<void> {
    if (typeof Notification === 'undefined') return;
    const r = await Notification.requestPermission();
    this.permiso.set(r);
    if (r === 'granted') {
      this.sonar();
      await this.activarPush().catch(() => this.push.set('error'));
    }
  }

  // ---------------------------------------------------------------------
  // Avisos con la app cerrada (Web Push)
  // ---------------------------------------------------------------------

  private estadoPushInicial(): EstadoPush {
    if (typeof window === 'undefined') return 'no-soportado';
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const instalada =
      window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    // En iPhone solo funciona si la app está agregada a la pantalla de inicio
    if (ios && !instalada) return 'instalar-ios';
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
      return 'no-soportado';
    }
    return 'inactivo';
  }

  /** Registra el service worker y suscribe este dispositivo a los avisos. */
  async activarPush(): Promise<void> {
    if (this.push() === 'no-soportado' || this.push() === 'instalar-ios') return;
    if (Notification.permission !== 'granted') return;

    const registro = await this.registrarServiceWorker();
    const clave = await this.clavePublica();
    if (!clave) {
      this.push.set('error');
      return;
    }

    let sub = await registro.pushManager.getSubscription();
    if (!sub) {
      sub = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.base64UrlABytes(clave),
      });
    }

    const json = sub.toJSON();
    const { error } = await this.supabase.client.rpc('registrar_push', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys?.['p256dh'],
      p_auth: json.keys?.['auth'],
      p_dispositivo: navigator.userAgent.slice(0, 200),
    });
    this.push.set(error ? 'error' : 'activo');
  }

  /** El service worker controla toda la app si el servidor lo permite; si no (ej. en desarrollo), solo /assets/. */
  private async registrarServiceWorker(): Promise<ServiceWorkerRegistration> {
    let reg: ServiceWorkerRegistration;
    try {
      reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
    } catch {
      reg = await navigator.serviceWorker.register(SW_URL);
    }
    // pushManager.subscribe necesita un service worker activo
    if (!reg.active) {
      const sw = reg.installing || reg.waiting;
      if (sw) {
        await new Promise<void>((ok) => {
          if (sw.state === 'activated') return ok();
          sw.addEventListener('statechange', () => sw.state === 'activated' && ok());
          setTimeout(ok, 8000);
        });
      }
    }
    return reg;
  }

  private clavePublicaCache: string | null = null;

  /** La clave pública VAPID la entrega la Edge Function (así no hay que ponerla en el código). */
  private async clavePublica(): Promise<string | null> {
    if (this.clavePublicaCache) return this.clavePublicaCache;
    const { data, error } = await this.supabase.client.functions.invoke('enviar-push', { method: 'GET' });
    const clave = !error ? (data as any)?.publicKey : null;
    this.clavePublicaCache = clave || null;
    return this.clavePublicaCache;
  }

  private base64UrlABytes(base64Url: string): ArrayBuffer {
    const relleno = '='.repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = (base64Url + relleno).replace(/-/g, '+').replace(/_/g, '/');
    const crudo = atob(base64);
    return Uint8Array.from(crudo, (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
  }

  private avisoDelSistema(aviso: Aviso): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    // Si la persona está mirando la app, basta con la campana y el sonido
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    const opciones: NotificationOptions = {
      body: aviso.cuerpo ?? '',
      icon: 'assets/icon/logo-192.png',
      tag: aviso.id,
    };
    try {
      const n = new Notification(aviso.titulo, opciones);
      n.onclick = () => {
        window.focus();
        this.abrirAviso(aviso);
        n.close();
      };
    } catch {
      // Android no permite "new Notification" sin un service worker
      navigator.serviceWorker?.ready.then((reg) => reg.showNotification(aviso.titulo, opciones)).catch(() => {});
    }
  }

  /** Dos tonos cortos, generados en el navegador (no necesita archivos de audio). */
  private sonar(): void {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [880, 1175].forEach((frecuencia, i) => {
        const osc = ctx.createOscillator();
        const vol = ctx.createGain();
        osc.frequency.value = frecuencia;
        osc.type = 'sine';
        const t = ctx.currentTime + i * 0.16;
        vol.gain.setValueAtTime(0.0001, t);
        vol.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
        vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        osc.connect(vol).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.15);
      });
      setTimeout(() => ctx.close(), 600);
    } catch {
      /* sin sonido si el navegador no lo permite */
    }
  }
}
