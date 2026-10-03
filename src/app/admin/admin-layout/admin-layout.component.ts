import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  homeOutline,
  receiptOutline,
  cubeOutline,
  peopleOutline,
  walletOutline,
  barChartOutline,
  settingsOutline,
  add,
  sunnyOutline,
  moonOutline,
  chevronBackOutline,
  chevronForwardOutline,
  logOutOutline,
  ellipsisHorizontal,
  notificationsOutline,
  peopleCircleOutline,
  timeOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons';
import { ThemeService } from '../../core/services/theme.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { InactividadService } from '../../core/services/inactividad.service';
import { AvisosPanelComponent } from '../../shared/avisos/avisos-panel.component';
import { AvisoInactividadComponent } from '../../shared/avisos/aviso-inactividad.component';

interface MenuItem {
  label: string;
  path: string;
  icon: string;
}

/** Minutos sin usar la app antes de cerrar la sesión del admin. */
/** Se usa si Configuración no tiene el valor (minutos sin uso antes de cerrar sesión). */
const MINUTOS_INACTIVIDAD = 30;

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    IonIcon,
    AvisosPanelComponent,
    AvisoInactividadComponent,
  ],
  templateUrl: './admin-layout.component.html',
  styleUrls: ['../../shared/pill-nav.scss', './admin-layout.component.scss'],
})
export class AdminLayoutComponent implements OnInit, OnDestroy {
  collapsed = localStorage.getItem('sidebar-colapsado') === '1';
  masAbierto = false;

  menuItems: MenuItem[] = [
    { label: 'Inicio', path: '/admin', icon: 'home-outline' },
    { label: 'Pedidos', path: '/admin/pedidos', icon: 'receipt-outline' },
    { label: 'Cuadres', path: '/admin/cuadres', icon: 'wallet-outline' },
    { label: 'Clientes', path: '/admin/clientes', icon: 'people-circle-outline' },
    { label: 'Productos', path: '/admin/productos', icon: 'cube-outline' },
    { label: 'Usuarios', path: '/admin/usuarios', icon: 'people-outline' },
    { label: 'Reportes', path: '/admin/reportes', icon: 'bar-chart-outline' },
    { label: 'Actividad', path: '/admin/actividad', icon: 'time-outline' },
    { label: 'Configuración', path: '/admin/configuracion', icon: 'settings-outline' },
    { label: 'Mi seguridad', path: '/admin/seguridad', icon: 'shield-checkmark-outline' },
  ];

  /** En el celular, lo que no cabe en la barra va en "Más" */
  get menuMas(): MenuItem[] {
    return this.menuItems.filter((m) => !['/admin', '/admin/pedidos'].includes(m.path));
  }

  constructor(
    public theme: ThemeService,
    public avisos: NotificacionesService,
    private inactividad: InactividadService,
    private supabase: SupabaseService,
    private router: Router
  ) {
    addIcons({
      homeOutline,
      receiptOutline,
      cubeOutline,
      peopleOutline,
      walletOutline,
      barChartOutline,
      settingsOutline,
      add,
      sunnyOutline,
      moonOutline,
      chevronBackOutline,
      chevronForwardOutline,
      logOutOutline,
      ellipsisHorizontal,
      notificationsOutline,
      peopleCircleOutline,
      timeOutline,
      shieldCheckmarkOutline,
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
