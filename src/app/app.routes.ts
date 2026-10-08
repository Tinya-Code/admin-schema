import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { schemas } from './schemas/registry';

/** Redirect inicial: primer recurso del registry (menú lateral). */
const firstResource = schemas[0].id;

export const routes: Routes = [
  // '' exacto → primer recurso; cualquier otra URL → shell (abajo).
  { path: '', pathMatch: 'full', redirectTo: firstResource },
  // Login FUERA del shell: si viviera dentro, `authGuard` lo bloquearía
  // a él mismo y no habría dónde caer sin sesión (§5.1).
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadChildren: () => import('./shell/shell.routes').then((m) => m.shellRoutes),
  },
  // Desconocidas → redirect al inicio (resuelto al primer recurso).
  { path: '**', redirectTo: firstResource },
];
