import { Routes } from '@angular/router';

import { authGuard, shellRoutes } from '@tinya-code/gas-admin-ui';

import { schemas } from './schemas/registry';

/** Redirect inicial: primer recurso del catálogo (menú lateral). */
const firstResource = schemas[0].id;

export const routes: Routes = [
  // '' exacto → primer recurso; cualquier otra URL → shell (abajo).
  { path: '', pathMatch: 'full', redirectTo: firstResource },
  // Login FUERA del shell: si viviera dentro, `authGuard` lo bloquearía
  // a él mismo y no habría dónde caer sin sesión (§5.1).
  {
    path: 'login',
    loadComponent: () => import('@tinya-code/gas-admin-ui').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadChildren: () => shellRoutes,
  },
  // Desconocidas → redirect al inicio (resuelto al primer recurso).
  { path: '**', redirectTo: firstResource },
];
