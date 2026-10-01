import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-recuperar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './recuperar.page.html',
  styleUrls: ['../auth-shell.scss'],
})
export class RecuperarPage {
  email = '';
  loading = false;
  enviado = false;
  errorMsg = '';

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async onEnviar(): Promise<void> {
    if (this.loading) return;
    this.errorMsg = '';
    const email = this.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.errorMsg = 'Escribe un correo válido.';
      return;
    }

    this.loading = true;
    this.cdr.detectChanges();
    const { error } = await this.supabase.recuperarClave(email);
    this.loading = false;

    // Límite de envíos del servidor: es el único error que se muestra.
    // Cualquier otro caso muestra el mismo mensaje, exista o no la cuenta,
    // para no revelar qué correos están registrados.
    if (error && error.status === 429) {
      this.errorMsg = 'Ya se enviaron varios correos hace poco. Espera unos minutos e intenta de nuevo.';
    } else {
      this.enviado = true;
    }
    this.cdr.detectChanges();
  }
}
