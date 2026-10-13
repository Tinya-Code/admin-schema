import type { Route, Routes } from '@angular/router';
import { inject } from '@angular/core';

import { validateComposition } from '../core/registry/composition-validator';
import type { ResourceSchema } from '../core/models/schema.model';
import { get } from '../core/registry/render-registry';
import { roleGuard } from '../core/guards/auth.guard';
import { unsavedChangesGuard } from '../core/guards/unsaved-changes.guard';
import { ViewNavigationService } from '../core/view-navigation/view-navigation.service';
import { schemas } from '../schemas/registry';
import { createViewContext } from '../views/composer/view-context';
import { Layout } from './layout/layout';

function pathRank(path: string): number[] {
  const segments = path.split('/');
  return [segments.length, segments.filter((segment) => !segment.startsWith(':')).length];
}

function compareRoutes(a: Route, b: Route): number {
  const aRank = pathRank(a.path ?? '');
  const bRank = pathRank(b.path ?? '');
  return bRank[0] - aRank[0] || bRank[1] - aRank[1];
}

/**
 * Rutas de los schemas recibidos (por defecto, la registry completa).
 * Cada schema se valida con `validateComposition` ANTES de generar rutas
 * (D3): una composición inválida revienta al arrancar, no en el render.
 */
export function resourceRoutes(catalog: readonly ResourceSchema[] = schemas): Route[] {
  return catalog
    .flatMap((schema) => {
      if (!schema.uiViews || Object.keys(schema.uiViews).length === 0) {
        throw new Error(`El recurso '${schema.id}' no declara uiViews`);
      }
      validateComposition(schema);
      return Object.entries(schema.uiViews).map(([name, view]) => {
        const descriptor = get('view', view.type);
        if (!descriptor) {
          throw new Error(
            `No existe descriptor kind:view type '${view.type}' para ${schema.id}.${name}`,
          );
        }
        const relativePath = view.path ?? '';
        if (
          relativePath.startsWith('/') ||
          relativePath.endsWith('/') ||
          (relativePath !== '' &&
            relativePath
              .split('/')
              .some((segment) => segment === '' || segment === '.' || segment === '..'))
        ) {
          throw new Error(`Ruta uiViews inválida en ${schema.id}.${name}: '${relativePath}'`);
        }
        const path = [schema.id, relativePath].filter(Boolean).join('/');
        const route: Route = {
          path,
          loadComponent: descriptor.load,
          canActivate: [roleGuard],
          data: {
            resourceId: schema.id,
            uiView: name,
            viewType: view.type,
          },
          /**
           * R9.9 · D1/D4 — el payload lleva SIEMPRE el `select` declarado
           * (cualquier mode) para que la hoja aplique la decision table; el
           * `emit` se liga aquí (contexto de inyección) a
           * `ViewNavigationService.dispatch`, que resuelve el target,
           * construye los segmentos y respeta guards + historial. Sólo un
           * binding `mode:'route'` lleva `emit`; `none`/`inline`/ausente ⇒
           * payload sin emisor.
           */
          resolve: {
            viewContext: () => {
              const base = {
                resourceId: schema.id,
                uiView: name,
                viewType: view.type,
                ...(view.select !== undefined ? { select: view.select } : {}),
              };
              const select = view.select;
              if (select?.mode !== 'route') return createViewContext(base);
              const nav = inject(ViewNavigationService);
              return createViewContext(base, (event) => {
                void nav.dispatch(select, event);
              });
            },
          },
        };
        if (view.type === 'form') route.canDeactivate = [unsavedChangesGuard];
        return route;
      });
    })
    .sort(compareRoutes);
}

/**
 * Las rutas del shell salen de `uiViews`, no de `ResourceSchema.views` (que
 * conserva los metadatos de consultas del backend). Añadir o cambiar una
 * página requiere una declaración y un descriptor `kind: 'view'`.
 */
export const shellRoutes: Routes = [
  {
    path: '',
    component: Layout,
    children: resourceRoutes(),
  },
];
