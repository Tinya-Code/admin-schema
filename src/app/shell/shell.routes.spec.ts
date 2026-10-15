import type { Route } from '@angular/router';
import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ResourceSchema } from '@tinya-code/gas-admin-ui';
import { SchemaCompositionError } from '@tinya-code/gas-admin-ui';
import { schemas } from '../schemas/registry';
import { resourceRoutes, shellRoutes } from '@tinya-code/gas-admin-ui';
import '../schemas/seed-catalog';

/**
 * `shellRoutes` construye sus hijos AL NAVIGARSE (loadChildren), no en la
 * evaluación del módulo: en producción el barrel se importa antes de que
 * `provideGasAdmin` siembre el catálogo y un build eager congelaría `[]`.
 */
let generated: Route[] = [];

beforeAll(async () => {
  const hijos = (await shellRoutes[0].loadChildren!()) as Route[];
  generated = hijos.find((route) => route.path === '')?.children ?? [];
});

function routeFor(path: string): Route | undefined {
  return generated.find((route) => route.path === path);
}

/** Schema de prueba cuya composición viola el contrato: `id` duplicado. */
const esquemaComposicionInvalida: ResourceSchema = {
  id: 'demo',
  label: 'Demo',
  labelPlural: 'Demos',
  kind: 'collection',
  endpoint: {},
  keyField: 'id',
  titleField: 'name',
  listColumns: [],
  fields: [],
  uiViews: {
    panel: {
      type: 'tabs',
      config: {
        children: [
          { id: 'rows', label: 'Filas A', type: 'list' },
          { id: 'rows', label: 'Filas B', type: 'list' },
        ],
      },
    },
  },
};

describe('shellRoutes declarativas', () => {
  it('genera una ruta protegida por cada uiView declarada', () => {
    for (const schema of schemas) {
      for (const [name, view] of Object.entries(schema.uiViews ?? {})) {
        const path = [schema.id, view.path ?? ''].filter(Boolean).join('/');
        const route = routeFor(path);

        expect(route, `${schema.id}.${name} (${path})`).toBeDefined();
        expect(route?.data).toMatchObject({
          resourceId: schema.id,
          uiView: name,
          viewType: view.type,
        });
        expect(route?.canActivate).toHaveLength(1);
        expect(typeof route?.canActivate?.[0]).toBe('function');
      }
    }
  });

  it('preserva las rutas públicas de navegación del shell', () => {
    expect(routeFor('dashboard')?.data).toMatchObject({ viewType: 'dashboard' });
    expect(routeFor('orders')?.data).toMatchObject({ viewType: 'list' });
    expect(routeFor('orders/new')?.data).toMatchObject({ viewType: 'form' });
    expect(routeFor('orders/:key')?.data).toMatchObject({ viewType: 'detail' });
    expect(routeFor('orders/:key/edit')?.canDeactivate).toHaveLength(1);
    expect(routeFor('site')?.data).toMatchObject({ resourceId: 'site', viewType: 'form' });
  });
});

describe('resourceRoutes valida la composición al construir (D3)', () => {
  it('mantiene intacto el set de rutas válidas de los schemas reales (golden)', () => {
    const rutasEsperadas = [
      'dashboard',
      'categories',
      'categories/new',
      'categories/:key/edit',
      'products',
      'products/new',
      'products/:key/edit',
      'orders',
      'orders/new',
      'orders/:key',
      'orders/:key/edit',
      'orders/calendario',
      'orders/tablero',
      'orders/resumen',
      'pickpass',
      'site',
      'legal',
      'users',
      'users/new',
      'users/:key/edit',
    ];

    expect(generated.map((route) => route.path).sort()).toEqual(rutasEsperadas.sort());
    expect(
      resourceRoutes()
        .map((route) => route.path)
        .sort(),
    ).toEqual(rutasEsperadas.sort());
  });

  it('acepta cada schema real de la registry', () => {
    for (const schema of schemas) {
      expect(() => resourceRoutes([schema]), schema.id).not.toThrow();
    }
  });

  it('lanza SchemaCompositionError al construir rutas de un schema con composición inválida', () => {
    expect(() => resourceRoutes([esquemaComposicionInvalida])).toThrow(SchemaCompositionError);
    expect(() => resourceRoutes([esquemaComposicionInvalida])).toThrow(/duplicado 'rows'/);
  });
});

describe('resolve:{viewContext} liga emit en contexto de inyección (R9.9 · D1)', () => {
  const fuente: ResourceSchema = {
    id: 'fuente',
    label: 'Fuente',
    labelPlural: 'Fuentes',
    kind: 'collection',
    endpoint: {},
    keyField: 'id',
    titleField: 'name',
    listColumns: [],
    fields: [],
    uiViews: {
      ruta: {
        type: 'list',
        path: 'ruta',
        select: {
          on: 'open',
          mode: 'route',
          target: { resource: 'orders', view: 'detail', params: ['key'] },
        },
      },
      local: { type: 'list', path: 'local', select: { on: 'open', mode: 'inline' } },
      plain: { type: 'list', path: 'plain' },
    },
  };

  function resolverDe(path: string): () => unknown {
    const ruta = resourceRoutes([fuente]).find((r) => r.path === path);
    expect(ruta?.resolve?.['viewContext'], `resolve en ${path}`).toBeTypeOf('function');
    return ruta!.resolve!['viewContext'] as unknown as () => unknown;
  }

  it("select mode:'route' ⇒ payload con emit que navega al destino declarado con matriz de comandos", () => {
    const navigate = vi.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { navigate } }] });
    const ctx = TestBed.runInInjectionContext(resolverDe('fuente/ruta')) as {
      resourceId: string;
      emit?: (e: { resource: string; key: string; action: string }) => void;
    };

    expect(ctx.resourceId).toBe('fuente');
    expect(typeof ctx.emit).toBe('function');
    ctx.emit?.({ resource: 'orders', key: 'A/B', action: 'open' });
    expect(navigate).toHaveBeenCalledWith(['/', 'orders', 'A/B']);
  });

  it('el payload declara `select` (cualquier mode) para la decision table de la hoja', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: { navigate: vi.fn() } }],
    });
    const conRoute = TestBed.runInInjectionContext(resolverDe('fuente/ruta')) as {
      select?: unknown;
    };
    const conInline = TestBed.runInInjectionContext(resolverDe('fuente/local')) as {
      select?: unknown;
    };
    const sinDeclare = TestBed.runInInjectionContext(resolverDe('fuente/plain')) as {
      select?: unknown;
    };
    expect(conRoute.select).toEqual({
      on: 'open',
      mode: 'route',
      target: { resource: 'orders', view: 'detail', params: ['key'] },
    });
    expect(conInline.select).toEqual({ on: 'open', mode: 'inline' });
    expect('select' in sinDeclare).toBe(false);
  });

  it("select mode:'inline' o ausente ⇒ payload SIN emit (inerte)", () => {
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: { navigate: vi.fn() } }],
    });
    for (const path of ['fuente/local', 'fuente/plain']) {
      const ctx = TestBed.runInInjectionContext(resolverDe(path)) as { emit?: unknown };
      expect(ctx.emit, path).toBeUndefined();
    }
  });
});
