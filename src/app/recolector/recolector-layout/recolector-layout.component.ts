import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { bagHandleOutline, notificationsOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ThemeService } from '../../core/services/theme.service';
import { AvisosPanelComponent } from '../../shared/avisos/avisos-panel.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';

/** Recolector: su día (bases, compras y facturas), avisos y "Tú". */
@Component({
  selector: 'app-recolector-layout',
  standalone: true,
  imports: [AvatarComponent, CommonModule, RouterLink, RouterLinkActive, RouterOutlet, IonIcon, AvisosPanelComponent],
  templateUrl: './recolector-layout.component.html',
  styleUrls: ['../../shared/pill-nav.scss', './recolector-layout.component.scss'],
})
export class RecolectorLayoutComponent implements OnInit {
  constructor(
    public supabase: SupabaseService,
    public avisos: NotificacionesService,
    // Aplica el modo claro u oscuro guardado
    public theme: ThemeService
  ) {
    addIcons({ bagHandleOutline, notificationsOutline });
  }

  ngOnInit(): void {
    this.avisos.iniciar();
  }
}
