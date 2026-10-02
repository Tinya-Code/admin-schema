import { Routes } from '@angular/router';

import { schemas } from './schemas/registry';

/** Redirect inicial: primer recurso del registry (menú lateral). */
const firstResource = schemas[0].id;

export const routes: Routes = [
  // '' exacto → primer recurso; cualquier otra URL → shell (abajo).
  { path: '', pathMatch: 'full', redirectTo: firstResource },
  {
    path: '',
    loadChildren: () => import('./shell/shell.routes').then((m) => m.shellRoutes),
  },
  // Desconocidas → redirect al inicio (resuelto al primer recurso).
  { path: '**', redirectTo: firstResource },
];
