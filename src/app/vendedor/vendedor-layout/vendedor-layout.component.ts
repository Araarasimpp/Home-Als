import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { homeOutline, add, logOutOutline, sunnyOutline, moonOutline, notificationsOutline, storefrontOutline, swapHorizontalOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ThemeService } from '../../core/services/theme.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { AvisosPanelComponent } from '../../shared/avisos/avisos-panel.component';
import { CambioRolComponent } from '../../shared/cambio-rol/cambio-rol.component';

@Component({
  selector: 'app-vendedor-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, IonIcon, AvisosPanelComponent, CambioRolComponent],
  templateUrl: './vendedor-layout.component.html',
  styleUrls: ['../../shared/pill-nav.scss', './vendedor-layout.component.scss'],
})
export class VendedorLayoutComponent implements OnInit {
  constructor(
    private supabase: SupabaseService,
    private router: Router,
    public theme: ThemeService,
    public avisos: NotificacionesService
  ) {
    addIcons({ homeOutline, add, logOutOutline, sunnyOutline, moonOutline, notificationsOutline, storefrontOutline, swapHorizontalOutline });
  }

  ngOnInit(): void {
    this.avisos.iniciar();
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  async logout(): Promise<void> {
    this.avisos.detener();
    await this.supabase.logout();
    this.router.navigateByUrl('/auth/login');
  }
}
