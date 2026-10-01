import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.page.html',
  styleUrls: ['../auth-shell.scss', './login.page.scss'],
})
export class LoginPage {
  email = '';
  password = '';
  errorMsg = '';
  loading = false;
  verClave = false;
  // Viene de registro con ?registrado=1
  recienRegistrado = false;

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {
    this.recienRegistrado = this.route.snapshot.queryParamMap.get('registrado') === '1';
  }

  async onLogin() {
    if (this.loading) return;
    this.errorMsg = '';
    this.recienRegistrado = false;

    if (!this.email || !this.password) {
      this.errorMsg = 'Escribe tu correo y tu contraseña.';
      return;
    }

    this.loading = true;
    this.cdr.detectChanges();
    const { error } = await this.supabase.login(this.email, this.password);

    if (error) {
      this.loading = false;
      this.errorMsg = 'El correo o la contraseña no coinciden. Revísalos e intenta de nuevo.';
      this.cdr.detectChanges();
      return;
    }

    const profile = await this.supabase.getCurrentProfile();
    this.loading = false;

    if (!profile) {
      this.errorMsg = 'No se pudo cargar tu perfil. Intenta de nuevo en un momento.';
      this.cdr.detectChanges();
      return;
    }

    if (!profile.activo) {
      await this.supabase.logout();
      this.errorMsg = 'Tu cuenta está desactivada. Pídele al administrador que la active.';
      this.cdr.detectChanges();
      return;
    }

    switch (profile.role) {
      case 'admin':
        this.router.navigateByUrl('/admin');
        break;
      case 'vendedor':
        this.router.navigateByUrl('/vendedor');
        break;
      case 'domiciliario':
        this.router.navigateByUrl('/domiciliario');
        break;
      case 'despachador':
        this.router.navigateByUrl('/despachador');
        break;
    }
  }
}
