import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

export type UserRole = 'admin' | 'vendedor' | 'domiciliario' | 'despachador';

export type ComisionTipo = 'margen' | 'porcentaje';

export interface Profile {
  id: string;
  nombre: string;
  email?: string;
  telefono?: string;
  /** Rol con el que la persona está trabajando ahora (su "modo"). */
  role: UserRole;
  /** Todos los roles que el admin le dio. Puede cambiar de modo entre ellos. */
  roles?: UserRole[];
  activo: boolean;
  /** Solo aplica a vendedores. 'margen' = lo que cobre sobre el precio base. */
  comision_tipo?: ComisionTipo;
  /** Porcentaje de la ganancia (0-100) cuando comision_tipo = 'porcentaje'. */
  comision_porcentaje?: number;
}

/** Roles que usan computadores compartidos: se les cierra la sesión por inactividad. */

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  public client: SupabaseClient;
  private currentProfile: Profile | null = null;

  /** true cuando el admin entró con contraseña pero le falta el código de 2 pasos. */
  public mfaPendiente = false;


  constructor() {
    this.client = createClient(environment.supabaseUrl, environment.supabaseKey, {
      auth: {
        // La sesión se guarda en el dispositivo y se mantiene hasta que el
        // usuario cierre sesión explícitamente (funciona igual en PC y móvil).
        persistSession: true,
        autoRefreshToken: true,
        // El enlace de recuperación de contraseña se procesa a mano en
        // /auth/nueva-clave, así ninguna otra página toma tokens de la URL.
        detectSessionInUrl: false,
      },
    });
  }

  async login(email: string, password: string) {
    // Si había otra persona en este dispositivo, no reutilizar su perfil
    this.currentProfile = null;
    return this.client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  }

  async register(email: string, password: string, nombre: string, telefono?: string) {
    return this.client.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { nombre, telefono } },
    });
  }

  /** Envía el correo para crear una contraseña nueva. */
  async recuperarClave(email: string) {
    return this.client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/nueva-clave`,
    });
  }

  /** Cambia la contraseña de la sesión actual (la abre el enlace de recuperación). */
  async cambiarClave(password: string) {
    return this.client.auth.updateUser({ password });
  }

  async logout() {
    // Antes de salir, este dispositivo deja de recibir los avisos de esta cuenta
    // (si no, en un celular compartido le llegarían a la siguiente persona)
    await this.quitarPushDeEsteDispositivo();
    this.currentProfile = null;
    return this.client.auth.signOut();
  }

  private async quitarPushDeEsteDispositivo(): Promise<void> {
    try {
      if (!('serviceWorker' in navigator)) return;
      const regs = await navigator.serviceWorker.getRegistrations();
      const reg = regs.find((r) => (r.active || r.installing || r.waiting)?.scriptURL.includes('sw-push.js'));
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return;
      await Promise.race([
        this.client.rpc('quitar_push', { p_endpoint: sub.endpoint }),
        new Promise((ok) => setTimeout(ok, 3000)),
      ]);
      await sub.unsubscribe();
    } catch {
      /* si falla, la suscripción vieja se limpia sola cuando el navegador la rechace */
    }
  }

  async getCurrentUser(): Promise<User | null> {
    const { data } = await this.client.auth.getUser();
    return data.user;
  }

  async getCurrentProfile(): Promise<Profile | null> {
    if (this.currentProfile) return this.currentProfile;

    const user = await this.getCurrentUser();
    if (!user) return null;

    const { data, error } = await this.client
      .from('profiles')
      // '*' para incluir las columnas de comisión sin fallar si aún no existen
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Error cargando profile:', error.message);
      return null;
    }

    const perfil = data as Profile;

    // Verificación en dos pasos: si el admin la tiene activa y esta sesión
    // aún no pasó el código, no se le entrega el perfil (los guards lo
    // devuelven al login, que pide el código).
    if (!perfil.roles?.length) perfil.roles = [perfil.role];
    // Quien tenga el rol admin (aunque esté en otro modo) pasa por el código
    if (perfil.roles.includes('admin') && (await this.necesitaCodigoMfa())) {
      this.mfaPendiente = true;
      return null;
    }
    this.mfaPendiente = false;

    this.currentProfile = perfil;
    return this.currentProfile;
  }

  // ---------------------------------------------------------------------
  // Verificación en dos pasos (TOTP: Google Authenticator, Authy, etc.)
  // ---------------------------------------------------------------------

  /** true si la cuenta tiene 2 pasos activo y esta sesión todavía no puso el código. */
  async necesitaCodigoMfa(): Promise<boolean> {
    const { data, error } = await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return false;
    return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
  }

  /** Factor TOTP ya verificado de la cuenta, si tiene. */
  async factorMfaActivo(): Promise<{ id: string } | null> {
    const { data } = await this.client.auth.mfa.listFactors();
    const f = data?.totp?.find((x: any) => x.status === 'verified');
    return f ? { id: f.id } : null;
  }

  /** Paso 1 de activar: devuelve el QR para escanear y la clave para escribir a mano. */
  async iniciarMfa(): Promise<{ factorId: string; qr: string; clave: string }> {
    // Limpia intentos anteriores que quedaron a medias
    const { data: lista } = await this.client.auth.mfa.listFactors();
    for (const f of (lista?.all ?? []) as any[]) {
      if (f.status !== 'verified') await this.client.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await this.client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Home ALS ${new Date().toISOString().slice(0, 10)}`,
    });
    if (error || !data) throw error ?? new Error('No se pudo iniciar la verificación en dos pasos');
    return { factorId: data.id, qr: data.totp.qr_code, clave: data.totp.secret };
  }

  /** Comprueba un código de 6 dígitos (sirve para activar y para iniciar sesión). */
  async verificarCodigoMfa(factorId: string, codigo: string) {
    const r = await this.client.auth.mfa.challengeAndVerify({ factorId, code: codigo.replace(/\s/g, '') });
    if (!r.error) {
      this.mfaPendiente = false;
      this.currentProfile = null; // se recarga ya con la sesión verificada
    }
    return r;
  }

  async desactivarMfa(factorId: string) {
    return this.client.auth.mfa.unenroll({ factorId });
  }

  // El cierre de sesión por inactividad vive en core/services/inactividad.service.ts

  /** Cambia el modo (rol activo) entre los roles que tiene la persona. */
  async cambiarRol(rol: UserRole): Promise<void> {
    const { error } = await this.client.rpc('cambiar_rol', { p_rol: rol });
    if (error) throw error;
    this.currentProfile = null;
  }

  clearCachedProfile() {
    this.currentProfile = null;
  }
}
