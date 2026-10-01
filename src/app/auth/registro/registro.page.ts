import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './registro.page.html',
  styleUrls: ['../auth-shell.scss', './registro.page.scss'],
})
export class RegistroPage {
  nombre = '';
  email = '';
  telefono = '';
  password = '';
  errorMsg = '';
  loading = false;
  verClave = false;

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async onRegistrar() {
    if (this.loading) return;
    this.errorMsg = '';

    if (!this.nombre || !this.email || !this.password) {
      this.errorMsg = 'Escribe tu nombre, tu correo y una contraseña.';
      return;
    }

    if (this.password.length < 6) {
      this.errorMsg = 'La contraseña necesita al menos 6 caracteres.';
      return;
    }

    this.loading = true;
    this.cdr.detectChanges();
    const { error } = await this.supabase.register(
      this.email,
      this.password,
      this.nombre,
      this.telefono || undefined
    );
    this.loading = false;

    if (error) {
      this.errorMsg =
        error.message === 'User already registered'
          ? 'Ya existe una cuenta con ese correo. Inicia sesión o usa otro correo.'
          : 'No se pudo crear la cuenta. Intenta de nuevo en un momento.';
      this.cdr.detectChanges();
      return;
    }

    this.router.navigate(['/auth/login'], { queryParams: { registrado: '1' } });
  }
}
