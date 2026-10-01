import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { EvaluacionClave, evaluarClave, vecesFiltrada } from '../../shared/seguridad/clave';
import { MedidorClaveComponent } from '../../shared/seguridad/medidor-clave.component';

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MedidorClaveComponent],
  templateUrl: './registro.page.html',
  styleUrls: ['../auth-shell.scss', './registro.page.scss'],
})
export class RegistroPage {
  nombre = '';
  email = '';
  telefono = '';
  password = '';
  confirmar = '';
  errorMsg = '';
  loading = false;
  verClave = false;
  intentoEnviar = false;

  evaluacion: EvaluacionClave = evaluarClave('');

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  /** Recalcula la fuerza al escribir la contraseña, el nombre o el correo. */
  actualizarEvaluacion(): void {
    this.evaluacion = evaluarClave(this.password, { nombre: this.nombre, email: this.email });
  }

  get noCoinciden(): boolean {
    return this.confirmar.length > 0 && this.confirmar !== this.password;
  }

  async onRegistrar() {
    if (this.loading) return;
    this.errorMsg = '';
    this.intentoEnviar = true;
    this.actualizarEvaluacion();

    if (!this.nombre.trim() || !this.email.trim() || !this.password) {
      this.errorMsg = 'Escribe tu nombre, tu correo y una contraseña.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
      this.errorMsg = 'Revisa el correo: parece incompleto.';
      return;
    }
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

    // ¿Aparece en filtraciones conocidas? Si no se puede consultar (sin
    // internet, servicio caído), se deja pasar: Supabase tiene su propia revisión.
    const filtrada = await vecesFiltrada(this.password);
    if (filtrada && filtrada > 0) {
      this.loading = false;
      this.errorMsg =
        'Esa contraseña aparece en filtraciones de datos de otros sitios, así que los atacantes ya la conocen. Elige otra.';
      this.cdr.detectChanges();
      return;
    }

    const { error } = await this.supabase.register(
      this.email,
      this.password,
      this.nombre.trim(),
      this.telefono.trim() || undefined
    );
    this.loading = false;

    if (error) {
      if (error.message === 'User already registered') {
        this.errorMsg = 'Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.';
      } else if (/password/i.test(error.message)) {
        // Rechazo de Supabase por su propia política de contraseñas
        this.errorMsg = 'El servidor rechazó la contraseña por insegura. Prueba con una más larga y variada.';
      } else if (error.status === 429) {
        this.errorMsg = 'Demasiados registros desde esta red. Espera unos minutos.';
      } else {
        this.errorMsg = 'No se pudo crear la cuenta. Intenta de nuevo en un momento.';
      }
      this.cdr.detectChanges();
      return;
    }

    this.router.navigate(['/auth/login'], { queryParams: { registrado: '1' } });
  }
}
