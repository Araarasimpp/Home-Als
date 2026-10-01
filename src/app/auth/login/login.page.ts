import { ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import {
  fallosRestantes,
  limpiarFallos,
  msBloqueado,
  registrarFallo,
} from '../../shared/seguridad/intentos-login';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.page.html',
  styleUrls: ['../auth-shell.scss', './login.page.scss'],
})
export class LoginPage implements OnDestroy {
  email = '';
  password = '';
  errorMsg = '';
  loading = false;
  verClave = false;
  bloqMayus = false;
  /** Mensaje verde al llegar desde registro o desde "nueva contraseña". */
  avisoOk = '';
  /** Segundos de bloqueo restantes por demasiados intentos (0 = libre). */
  segundosBloqueo = 0;

  private reloj: ReturnType<typeof setInterval> | null = null;

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {
    const q = this.route.snapshot.queryParamMap;
    if (q.get('registrado') === '1') {
      this.avisoOk = 'Cuenta creada. Si te llegó un correo de confirmación, ábrelo antes de iniciar sesión.';
    } else if (q.get('clave') === '1') {
      this.avisoOk = 'Contraseña actualizada. Ya puedes iniciar sesión con la nueva.';
    }
  }

  ngOnDestroy(): void {
    if (this.reloj) clearInterval(this.reloj);
  }

  /** Detecta Bloq Mayús mientras se escribe la contraseña. */
  revisarMayus(evento: KeyboardEvent): void {
    if (typeof evento.getModifierState === 'function') {
      this.bloqMayus = evento.getModifierState('CapsLock');
    }
  }

  private iniciarCuentaRegresiva(): void {
    const actualizar = () => {
      this.segundosBloqueo = Math.ceil(msBloqueado(this.email) / 1000);
      if (this.segundosBloqueo <= 0 && this.reloj) {
        clearInterval(this.reloj);
        this.reloj = null;
        this.errorMsg = '';
      }
      this.cdr.detectChanges();
    };
    actualizar();
    if (this.segundosBloqueo > 0 && !this.reloj) {
      this.reloj = setInterval(actualizar, 1000);
    }
  }

  get textoBloqueo(): string {
    const s = this.segundosBloqueo;
    return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
  }

  async onLogin() {
    if (this.loading || this.segundosBloqueo > 0) return;
    this.errorMsg = '';
    this.avisoOk = '';

    const email = this.email.trim();
    if (!email || !this.password) {
      this.errorMsg = 'Escribe tu correo y tu contraseña.';
      return;
    }

    if (msBloqueado(email) > 0) {
      this.errorMsg = 'Demasiados intentos fallidos. Espera para volver a intentar.';
      this.iniciarCuentaRegresiva();
      return;
    }

    this.loading = true;
    this.cdr.detectChanges();
    const { error } = await this.supabase.login(email, this.password);

    if (error) {
      this.loading = false;
      this.password = '';

      // Límite del servidor (Supabase) alcanzado
      if (error.status === 429) {
        this.errorMsg = 'Demasiados intentos desde esta red. Espera unos minutos.';
        this.cdr.detectChanges();
        return;
      }
      if (/email not confirmed/i.test(error.message)) {
        this.errorMsg = 'Tu correo aún no está confirmado. Abre el enlace que te llegó al registrarte.';
        this.cdr.detectChanges();
        return;
      }

      registrarFallo(email);
      const restantes = fallosRestantes(email);
      if (msBloqueado(email) > 0) {
        this.errorMsg = 'Demasiados intentos fallidos. Espera para volver a intentar.';
        this.iniciarCuentaRegresiva();
      } else {
        // Mensaje genérico: no revela si el correo existe o no
        this.errorMsg =
          'El correo o la contraseña no coinciden.' +
          (restantes <= 2 ? ` Te quedan ${restantes} ${restantes === 1 ? 'intento' : 'intentos'} antes de un bloqueo temporal.` : '');
      }
      this.cdr.detectChanges();
      return;
    }

    limpiarFallos(email);
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
