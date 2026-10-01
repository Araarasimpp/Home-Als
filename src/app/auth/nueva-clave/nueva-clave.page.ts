import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { EvaluacionClave, evaluarClave, vecesFiltrada } from '../../shared/seguridad/clave';
import { MedidorClaveComponent } from '../../shared/seguridad/medidor-clave.component';

type Estado = 'verificando' | 'listo' | 'invalido';

@Component({
  selector: 'app-nueva-clave',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MedidorClaveComponent],
  templateUrl: './nueva-clave.page.html',
  styleUrls: ['../auth-shell.scss'],
})
export class NuevaClavePage implements OnInit {
  estado: Estado = 'verificando';
  email = '';
  password = '';
  confirmar = '';
  verClave = false;
  loading = false;
  errorMsg = '';
  intentoEnviar = false;
  evaluacion: EvaluacionClave = evaluarClave('');

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  /**
   * El enlace del correo trae la sesión de recuperación en la URL:
   *  - flujo PKCE:     /auth/nueva-clave?code=...
   *  - flujo implícito: /auth/nueva-clave#access_token=...&refresh_token=...&type=recovery
   * Se procesa aquí y se borra de la barra de direcciones.
   */
  async ngOnInit(): Promise<void> {
    const auth = this.supabase.client.auth;
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));

    try {
      if (hash.get('error_description') || url.searchParams.get('error_description')) {
        this.estado = 'invalido';
      } else if (url.searchParams.get('code')) {
        const { error } = await auth.exchangeCodeForSession(url.searchParams.get('code')!);
        this.estado = error ? 'invalido' : 'listo';
      } else if (hash.get('access_token') && hash.get('refresh_token')) {
        const { error } = await auth.setSession({
          access_token: hash.get('access_token')!,
          refresh_token: hash.get('refresh_token')!,
        });
        this.estado = error ? 'invalido' : 'listo';
      } else {
        this.estado = 'invalido';
      }
    } catch {
      this.estado = 'invalido';
    }

    // Quitar los tokens de la URL (historial, capturas de pantalla, etc.)
    window.history.replaceState(null, '', '/auth/nueva-clave');

    if (this.estado === 'listo') {
      const user = await this.supabase.getCurrentUser();
      this.email = user?.email ?? '';
      this.actualizarEvaluacion();
    }
    this.cdr.detectChanges();
  }

  actualizarEvaluacion(): void {
    this.evaluacion = evaluarClave(this.password, { email: this.email });
  }

  get noCoinciden(): boolean {
    return this.confirmar.length > 0 && this.confirmar !== this.password;
  }

  async onGuardar(): Promise<void> {
    if (this.loading) return;
    this.errorMsg = '';
    this.intentoEnviar = true;
    this.actualizarEvaluacion();

    if (!this.evaluacion.valida) {
      this.errorMsg = 'La contraseña todavía no cumple todos los requisitos.';
      return;
    }
    if (this.password !== this.confirmar) {
      this.errorMsg = 'Las contraseñas no coinciden.';
      return;
    }

    this.loading = true;
    this.cdr.detectChanges();

    const filtrada = await vecesFiltrada(this.password);
    if (filtrada && filtrada > 0) {
      this.loading = false;
      this.errorMsg =
        'Esa contraseña aparece en filtraciones de datos de otros sitios, así que los atacantes ya la conocen. Elige otra.';
      this.cdr.detectChanges();
      return;
    }

    const { error } = await this.supabase.cambiarClave(this.password);
    if (error) {
      this.loading = false;
      this.errorMsg = /same|different/i.test(error.message)
        ? 'La nueva contraseña debe ser distinta de la anterior.'
        : /session|expired|jwt/i.test(error.message)
          ? 'El enlace venció. Pide uno nuevo.'
          : 'No se pudo guardar la contraseña. Intenta de nuevo.';
      this.cdr.detectChanges();
      return;
    }

    // Se cierra la sesión de recuperación y se pide entrar con la clave nueva
    await this.supabase.logout();
    this.router.navigate(['/auth/login'], { queryParams: { clave: '1' } });
  }
}
