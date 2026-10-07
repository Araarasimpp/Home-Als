import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot, UrlTree } from '@angular/router';
import { SupabaseService, UserRole } from '../services/supabase.service';
import { INICIO_ROL } from '../app-init/app-init.page';

@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {
  constructor(private supabase: SupabaseService, private router: Router) {}

  async canActivate(route: ActivatedRouteSnapshot): Promise<boolean | UrlTree> {
    const allowedRoles = route.data['roles'] as UserRole[] | undefined;

    const profile = await this.supabase.getCurrentProfile();

    // No hay sesión → al login
    if (!profile) {
      this.router.navigate(['/auth/login']);
      return false;
    }

    // El profile queda cacheado en memoria durante la sesión, así que
    // revisamos "activo" con una consulta fresca por si lo desactivaron
    // mientras la persona ya tenía la sesión abierta.
    const { data: estadoActual } = await this.supabase.client
      .from('profiles')
      .select('activo')
      .eq('id', profile.id)
      .single();

    if (estadoActual && !estadoActual.activo) {
      await this.supabase.logout();
      this.router.navigate(['/auth/login']);
      return false;
    }

    // La ruta no restringe roles → cualquier autenticado pasa
    if (!allowedRoles || allowedRoles.length === 0) {
      return true;
    }

    // El rol del usuario no está en la lista permitida → a la sección de su rol
    if (!allowedRoles.includes(profile.role)) {
      return this.router.parseUrl(INICIO_ROL[profile.role] ?? '/auth/login');
    }

    return true;
  }
}
