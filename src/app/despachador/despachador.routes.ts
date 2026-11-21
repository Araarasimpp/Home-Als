// src/app/despachador/despachador.routes.ts
import { Routes } from '@angular/router';
import { RoleGuard } from '../core/guards/role.guard';
import { DespachadorLayoutComponent } from './despachador-layout/despachador-layout.component';
import { SECCIONES_DESPACHADOR } from '../shared/escritorio/secciones';

export const DESPACHADOR_ROUTES: Routes = [
  {
    path: '',
    canActivate: [RoleGuard],
    data: { roles: ['despachador', 'admin'] },
    component: DespachadorLayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./inicio/inicio.page').then((m) => m.InicioDespachadorPage),
      },
      {
        path: 'pedidos',
        loadComponent: () =>
          import('../admin/pedidos/pedidos.page').then((m) => m.PedidosPage),
      },
      {
        // Solo mirar: el despachador no envía bases ni recibe la plata
        path: 'recolector',
        loadComponent: () => import('../shared/recolector/recolector.page').then((m) => m.RecolectorPage),
      },
      {
        // "Tú" en el celular: perfil, todas las páginas, rol, tema y salir
        path: 'tu',
        data: { base: '/despachador', secciones: SECCIONES_DESPACHADOR, ocultar: ['/despachador', '/despachador/pedidos'] },
        loadComponent: () => import('../shared/tu/tu.page').then((m) => m.TuPage),
      },
      {
        path: 'pedidos/nuevo',
        canActivate: [RoleGuard],
        data: { roles: ['despachador', 'admin'], volverA: '/despachador/pedidos' },
        loadComponent: () =>
          import('../vendedor/nuevo-pedido/nuevo-pedido.page').then(
            (m) => m.NuevoPedidoPage
          ),
      },
      {
        path: 'pedidos/:id/editar',
        data: { volverA: '/despachador/pedidos' },
        loadComponent: () =>
          import('../vendedor/nuevo-pedido/nuevo-pedido.page').then((m) => m.NuevoPedidoPage),
      },
      {
        path: 'venta-local',
        data: { canal: 'local', volverA: '/despachador/pedidos', rutaVentas: '/despachador/ventas-del-local' },
        loadComponent: () =>
          import('../vendedor/nuevo-pedido/nuevo-pedido.page').then((m) => m.NuevoPedidoPage),
      },
      {
        path: 'ventas-del-local',
        data: { rutaNueva: '/despachador/venta-local', rutaEditar: '/despachador/ventas-del-local', verGanancia: true },
        loadComponent: () =>
          import('../admin/ventas-local/ventas-local.page').then((m) => m.VentasLocalPage),
      },
      {
        // Corregir una venta del local (producto, cantidad, precio o pago)
        path: 'ventas-del-local/:id/editar',
        data: { volverA: '/despachador/ventas-del-local' },
        loadComponent: () =>
          import('../vendedor/nuevo-pedido/nuevo-pedido.page').then((m) => m.NuevoPedidoPage),
      },
      {
        path: 'calendario',
        loadComponent: () => import('../shared/calendario/calendario.page').then((m) => m.CalendarioPage),
      },
      {
        path: 'ranking',
        data: { tipo: 'domiciliario' },
        loadComponent: () => import('../shared/ranking/ranking.page').then((m) => m.RankingPage),
      },
      {
        path: 'perfil',
        loadComponent: () => import('../shared/perfil/mi-perfil.page').then((m) => m.MiPerfilPage),
      },
      {
        path: 'cuadres',
        loadComponent: () =>
          import('../admin/cuadres/cuadres.page').then((m) => m.AdminCuadresPage),
      },
    ],
  },
];