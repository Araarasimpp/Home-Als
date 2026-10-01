import { Component } from '@angular/core';
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
} from 'ionicons/icons';
import { ThemeService } from '../../core/services/theme.service';
import { SupabaseService } from '../../core/services/supabase.service';

interface MenuItem {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, IonIcon],
  templateUrl: './admin-layout.component.html',
  styleUrls: ['../../shared/pill-nav.scss', './admin-layout.component.scss'],
})
export class AdminLayoutComponent {
  collapsed = localStorage.getItem('sidebar-colapsado') === '1';
  masAbierto = false;

  menuItems: MenuItem[] = [
    { label: 'Inicio', path: '/admin', icon: 'home-outline' },
    { label: 'Pedidos', path: '/admin/pedidos', icon: 'receipt-outline' },
    { label: 'Cuadres', path: '/admin/cuadres', icon: 'wallet-outline' },
    { label: 'Productos', path: '/admin/productos', icon: 'cube-outline' },
    { label: 'Usuarios', path: '/admin/usuarios', icon: 'people-outline' },
    { label: 'Reportes', path: '/admin/reportes', icon: 'bar-chart-outline' },
    { label: 'Configuración', path: '/admin/configuracion', icon: 'settings-outline' },
  ];

  constructor(
    public theme: ThemeService,
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
    });
  }

  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    localStorage.setItem('sidebar-colapsado', this.collapsed ? '1' : '0');
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  async logout(): Promise<void> {
    this.masAbierto = false;
    await this.supabase.logout();
    this.router.navigateByUrl('/auth/login');
  }
}
