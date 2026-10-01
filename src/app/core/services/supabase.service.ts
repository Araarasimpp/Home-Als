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
  role: UserRole;
  activo: boolean;
  /** Solo aplica a vendedores. 'margen' = lo que cobre sobre el precio base. */
  comision_tipo?: ComisionTipo;
  /** Porcentaje de la ganancia (0-100) cuando comision_tipo = 'porcentaje'. */
  comision_porcentaje?: number;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  public client: SupabaseClient;
  private currentProfile: Profile | null = null;

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
    this.currentProfile = null;
    return this.client.auth.signOut();
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

    this.currentProfile = data as Profile;
    return this.currentProfile;
  }

  clearCachedProfile() {
    this.currentProfile = null;
  }
}
