// src/app/recolector/recolector.routes.ts
import { Routes } from '@angular/router';
import { RoleGuard } from '../core/guards/role.guard';
import { RecolectorLayoutComponent } from './recolector-layout/recolector-layout.component';
import { SECCIONES_RECOLECTOR } from '../shared/escritorio/secciones';

export const RECOLECTOR_ROUTES: Routes = [
  {
    path: '',
    canActivate: [RoleGuard],
    data: { roles: ['recolector'] },
    component: RecolectorLayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () => import('../shared/recolector/recolector.page').then((m) => m.RecolectorPage),
      },
      {
        path: 'perfil',
        loadComponent: () => import('../shared/perfil/mi-perfil.page').then((m) => m.MiPerfilPage),
      },
      {
        path: 'tu',
        data: { base: '/recolector', secciones: SECCIONES_RECOLECTOR, ocultar: ['/recolector'] },
        loadComponent: () => import('../shared/tu/tu.page').then((m) => m.TuPage),
      },
    ],
  },
];
