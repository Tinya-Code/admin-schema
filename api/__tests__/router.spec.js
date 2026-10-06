// api/__tests__/router.spec.js — Resolución de rutas (core/10-router).
//
// Cubre la colisión que rompía el panel: el endpoint `dashboard`
// (`/admin/dashboard` → handleDashboard) y el recurso `dashboard`
// (descriptor sin storage) declaramos la MISMA ruta. `routeTable_` carga
// los endpoints PRIMERO y los resources DESPUÉS, así que el recurso
// sobrescribía la entrada del endpoint y la llamada terminaba en un listado
// sobre una hoja `null`: 500 "Falta la hoja: null" y el panel en blanco.

import { beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let resolveRoute_;

beforeAll(() => {
  loadBackend();
  resolveRoute_ = globalThis.resolveRoute_;
});

describe('resolveRoute_', () => {
  it('/admin/dashboard resuelve al ENDPOINT (handleDashboard), no al recurso', () => {
    const route = resolveRoute_('/admin/dashboard');

    expect(route).not.toBeNull();
    expect(route.kind).toBe('handler');
    expect(route.handler).toBe('handleDashboard');
  });

  it('el recurso dashboard no publica ruta: sin storage no hay filas', () => {
    // Si alguien volviera a meter el descriptor en la tabla, el test anterior
    // lo atrapa; éste deja la regla explícita.
    const dashboard = globalThis.REGISTRY.resources.dashboard;
    expect(dashboard.sheet).toBeNull();

    const route = resolveRoute_('/admin/dashboard');
    expect(route.resource).toBeUndefined();
  });

  it('las rutas de colección siguen resolviendo al recurso', () => {
    for (const [path, id] of [
      ['/admin/orders', 'orders'],
      ['/admin/pickpass', 'pickpass'],
      ['/admin/site', 'site'],
    ]) {
      const route = resolveRoute_(path);
      expect(route, `falta la ruta ${path}`).not.toBeNull();
      expect(route.kind).toBe('resource');
      expect(route.resource.id).toBe(id);
      expect(route.resource.sheet).toBeTruthy();
    }
  });

  it('una ruta sin dueño sigue devolviendo null (404 en el router)', () => {
    expect(resolveRoute_('/admin/esto-no-existe')).toBeNull();
  });
});
