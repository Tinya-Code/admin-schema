import { Routes } from '@angular/router';

import { unsavedChangesGuard } from '../core/guards/unsaved-changes.guard';
import { Layout } from './layout/layout';

/**
 * Rutas del shell: rutas dinámicas por recurso → páginas lazy.
 * Se resuelve el `id` contra el registry: agregar un recurso nuevo solo
 * requiere su schema (base.md §13.1) — no tocar rutas.
 *
 * Las rutas del formulario llevan `canDeactivate` (aviso de cambios sin
 * guardar, base.md §13.9). El orden importa: las rutas más específicas
 * (`new`, `…/edit`) van antes de `:id`.
 */
export const shellRoutes: Routes = [
  {
    path: '',
    component: Layout,
    children: [
      {
        path: ':id/new',
        loadComponent: () => import('../pages/form-view/form-view').then((m) => m.FormView),
        canDeactivate: [unsavedChangesGuard],
      },
      {
        path: ':id/:key/edit',
        loadComponent: () => import('../pages/form-view/form-view').then((m) => m.FormView),
        canDeactivate: [unsavedChangesGuard],
      },
      // Ficha de detalle enlazable (`/orders/{ref}`): la comparte el widget
      // `record-list` del dashboard y cualquier link externo. El orden
      // importa — va después de `new` y de `…/edit`, que son más específicas.
      {
        path: ':id/:key',
        loadComponent: () =>
          import('../pages/resource-page/resource-page').then((m) => m.ResourcePage),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('../pages/resource-page/resource-page').then((m) => m.ResourcePage),
      },
    ],
  },
];
