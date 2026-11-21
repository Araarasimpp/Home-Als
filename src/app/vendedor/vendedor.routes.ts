// src/app/vendedor/vendedor.routes.ts
import { Routes } from '@angular/router';
import { RoleGuard } from '../core/guards/role.guard';
import { VendedorLayoutComponent } from './vendedor-layout/vendedor-layout.component';
import { SECCIONES_VENDEDOR } from '../shared/escritorio/secciones';

export const VENDEDOR_ROUTES: Routes = [
  {
    path: '',
    canActivate: [RoleGuard],
    data: { roles: ['vendedor', 'admin'] },
    component: VendedorLayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () => import('./inicio/inicio.page').then((m) => m.InicioPage),
      },
      {
        path: 'nuevo-pedido',
        loadComponent: () =>
          import('./nuevo-pedido/nuevo-pedido.page').then((m) => m.NuevoPedidoPage),
      },
      {
        path: 'venta-local',
        data: { canal: 'local', rutaVentas: '/vendedor/ventas-del-local' },
        loadComponent: () =>
          import('./nuevo-pedido/nuevo-pedido.page').then((m) => m.NuevoPedidoPage),
      },
      {
        path: 'ranking',
        data: { tipo: 'vendedor' },
        loadComponent: () => import('../shared/ranking/ranking.page').then((m) => m.RankingPage),
      },
      {
        path: 'perfil',
        loadComponent: () => import('../shared/perfil/mi-perfil.page').then((m) => m.MiPerfilPage),
      },
      {
        path: 'pagos',
        loadComponent: () => import('../shared/pagos/pagos.page').then((m) => m.PagosPage),
      },
      {
        // "Tú" en el celular: perfil, todas las páginas, rol, tema y salir
        path: 'tu',
        data: { base: '/vendedor', secciones: SECCIONES_VENDEDOR, ocultar: ['/vendedor', '/vendedor/venta-local', '/vendedor/nuevo-pedido'] },
        loadComponent: () => import('../shared/tu/tu.page').then((m) => m.TuPage),
      },
      {
        path: 'ventas-del-local',
        data: { rutaNueva: '/vendedor/venta-local' },
        loadComponent: () =>
          import('../admin/ventas-local/ventas-local.page').then((m) => m.VentasLocalPage),
      },
    ],
  },
];