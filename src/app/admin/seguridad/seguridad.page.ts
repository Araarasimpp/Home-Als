import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-seguridad',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './seguridad.page.html',
  styleUrls: ['../../shared/ui.scss', '../clientes/clientes.page.scss', './seguridad.page.scss'],
})
export class SeguridadPage {
  constructor(private supabase: SupabaseService, private router: Router) {}

  async cerrarTodas(): Promise<void> {
    if (!confirm('Se cerrará tu sesión en todos los dispositivos, incluido este. ¿Continuar?')) return;
    await this.supabase.client.auth.signOut({ scope: 'global' });
    this.router.navigateByUrl('/auth/login');
  }
}
