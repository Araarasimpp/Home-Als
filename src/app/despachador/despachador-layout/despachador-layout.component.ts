import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  homeOutline,
  swapHorizontalOutline,
  receiptOutline,
  storefrontOutline,
  walletOutline,
  add,
  sunnyOutline,
  moonOutline,
  chevronBackOutline,
  chevronForwardOutline,
  logOutOutline,
  ellipsisHorizontal,
  notificationsOutline,
} from 'ionicons/icons';
import { ThemeService } from '../../core/services/theme.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { InactividadService } from '../../core/services/inactividad.service';
import { AvisosPanelComponent } from '../../shared/avisos/avisos-panel.component';
import { CambioRolComponent } from '../../shared/cambio-rol/cambio-rol.component';
import { AvisoInactividadComponent } from '../../shared/avisos/aviso-inactividad.component';

interface MenuItem {
  label: string;
  path: string;
  icon: string;
}

/** Se usa si Configuración no tiene el valor (minutos sin uso antes de cerrar sesión). */
const MINUTOS_INACTIVIDAD = 30;

@Component({
  selector: 'app-despachador-layout',
  standalone: true,
  imports: [
    CambioRolComponent,
    CommonModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    IonIcon,
    AvisosPanelComponent,
    AvisoInactividadComponent,
  ],
  templateUrl: './despachador-layout.component.html',
  styleUrls: ['../../shared/pill-nav.scss', './despachador-layout.component.scss'],
})
export class DespachadorLayoutComponent implements OnInit, OnDestroy {
  collapsed = localStorage.getItem('sidebar-colapsado') === '1';
  masAbierto = false;

  menuItems: MenuItem[] = [
    { label: 'Inicio', path: '/despachador', icon: 'home-outline' },
    { label: 'Pedidos', path: '/despachador/pedidos', icon: 'receipt-outline' },
    { label: 'Venta en local', path: '/despachador/venta-local', icon: 'storefront-outline' },
    { label: 'Cuadres', path: '/despachador/cuadres', icon: 'wallet-outline' },
  ];

  constructor(
    public theme: ThemeService,
    public avisos: NotificacionesService,
    private inactividad: InactividadService,
    private supabase: SupabaseService,
    private router: Router
  ) {
    addIcons({
      homeOutline,
      swapHorizontalOutline,
      receiptOutline,
      storefrontOutline,
      walletOutline,
      add,
      sunnyOutline,
      moonOutline,
      chevronBackOutline,
      chevronForwardOutline,
      logOutOutline,
      ellipsisHorizontal,
      notificationsOutline,
    });
  }

  ngOnInit(): void {
    this.avisos.iniciar();
    this.inactividad.iniciarConConfig(MINUTOS_INACTIVIDAD);
  }

  ngOnDestroy(): void {
    this.inactividad.detener();
  }

  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    localStorage.setItem('sidebar-colapsado', this.collapsed ? '1' : '0');
  }

  toggleAvisos(): void {
    this.masAbierto = false;
    this.avisos.toggle();
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  async logout(): Promise<void> {
    this.masAbierto = false;
    this.inactividad.detener();
    this.avisos.detener();
    await this.supabase.logout();
    this.router.navigateByUrl('/auth/login');
  }
}
