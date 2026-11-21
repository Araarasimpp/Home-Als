// src/app/domiciliario/domiciliario.routes.ts
import { Routes } from '@angular/router';
import { RoleGuard } from '../core/guards/role.guard';
import { DomiciliarioLayoutComponent } from './domiciliario-layout/domiciliario-layout.component';
import { SECCIONES_DOMICILIARIO } from '../shared/escritorio/secciones';

export const DOMICILIARIO_ROUTES: Routes = [
  {
    path: '',
    canActivate: [RoleGuard],
    data: { roles: ['domiciliario', 'admin'] },
    component: DomiciliarioLayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./inicio/inicio.page').then((m) => m.InicioDomiciliarioPage),
      },
      {
        path: 'perfil',
        loadComponent: () => import('../shared/perfil/mi-perfil.page').then((m) => m.MiPerfilPage),
      },
      {
        path: 'cuadres',
        loadComponent: () => import('./cuadres/cuadres.page').then((m) => m.CuadresPage),
      },
      {
        // "Tú" en el celular: perfil, todas las páginas, rol, tema y salir
        path: 'tu',
        data: { base: '/domiciliario', secciones: SECCIONES_DOMICILIARIO, ocultar: ['/domiciliario', '/domiciliario/cuadres'] },
        loadComponent: () => import('../shared/tu/tu.page').then((m) => m.TuPage),
      },
      {
        path: 'ranking',
        data: { tipo: 'domiciliario' },
        loadComponent: () => import('../shared/ranking/ranking.page').then((m) => m.RankingPage),
      },
    ],
  },
];