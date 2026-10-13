import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { roleGuard } from '../guards/auth.guard';
import type { NavigationTarget, SelectionBinding } from '../models/schema.model';
import { AuthService } from '../services/auth.service';
import {
  buildSegments,
  targetRoutePattern,
  ViewNavigationService,
} from './view-navigation.service';

@Component({ standalone: true, template: 'lista' })
class ListaStub {}

@Component({ standalone: true, template: 'detalle' })
class DetalleStub {}

/** Target declarado sobre el schema real `orders` (registry front). */
const target: NavigationTarget = { resource: 'orders', view: 'detail', params: ['key'] };

function rutaBinding(mode: 'route'): SelectionBinding {
  return { on: 'open', mode, target };
}

describe('buildSegments (key-only, sin concat de strings)', () => {
  it('sustituye :key por la clave COMPLETA sin partirla (clave A/B)', () => {
    expect(buildSegments(['orders', ':key'], 'A/B')).toEqual(['orders', 'A/B']);
  });

  it('sustituye params en posición media y mantiene literales', () => {
    expect(buildSegments(['orders', ':key', 'edit'], '7')).toEqual(['orders', '7', 'edit']);
  });

  it('param distinto de :key ⇒ falla ruido (sin fuente declarada)', () => {
    expect(() => buildSegments(['orders', ':otro'], 'x')).toThrow('sin fuente declarada');
  });
});

describe('targetRoutePattern (misma fuente que el validador)', () => {
  it('resuelve el patrón de la ruta destino desde la registry', () => {
    expect(targetRoutePattern({ resource: 'orders', view: 'detail', params: ['key'] })).toEqual([
      'orders',
      ':key',
    ]);
  });

  it('recurso o vista destino inexistente ⇒ undefined (nada navega)', () => {
    expect(targetRoutePattern({ resource: 'nope', view: 'detail' })).toBeUndefined();
    expect(targetRoutePattern({ resource: 'orders', view: 'nope' })).toBeUndefined();
  });
});

describe('ViewNavigationService.dispatch', () => {
  function servicio(auth = { isAuthenticated: () => true, canAccess: () => true }) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'orders',
            component: ListaStub,
            data: { resourceId: 'orders' },
            canActivate: [roleGuard],
          },
          {
            path: 'orders/:key',
            component: DetalleStub,
            data: { resourceId: 'orders' },
            canActivate: [roleGuard],
          },
        ]),
        { provide: AuthService, useValue: auth },
      ],
    });
    return {
      nav: TestBed.inject(ViewNavigationService),
      router: TestBed.inject(Router),
    };
  }

  it('target declarado ⇒ navega con la clave codificada y el guard corre', async () => {
    const { nav, router } = servicio();
    const ok = await nav.dispatch(rutaBinding('route'), {
      resource: 'orders',
      key: 'A/B',
      action: 'open',
    });
    expect(ok).toBe(true);
    // El router serializa :key ⇒ '/' de la clave queda codificado, sin partir
    expect(router.url).toBe('/orders/A%2FB');
  });

  it('patrón sin params navega a los segmentos literales', async () => {
    const { nav, router } = servicio();
    const ok = await nav.dispatch(
      { on: 'open', mode: 'route', target: { resource: 'orders', view: 'create' } },
      { resource: 'orders', key: 'ignorada', action: 'open' },
    );
    expect(ok).toBe(true);
    expect(router.url).toBe('/orders/new');
  });

  it('acción que no es la declarada ⇒ sin navegación (scope del target)', async () => {
    const { nav, router } = servicio();
    const espia = vi.spyOn(router, 'navigate');
    await nav.dispatch(rutaBinding('route'), { resource: 'orders', key: '1', action: 'select' });
    expect(espia).not.toHaveBeenCalled();
    expect(router.url).toBe('/');
  });

  it('sin binding declarado ⇒ inerte aunque el evento pida mutar', async () => {
    const { nav, router } = servicio();
    const espia = vi.spyOn(router, 'navigate');
    await nav.dispatch(undefined, { resource: 'orders', key: '1', action: 'move' });
    expect(espia).not.toHaveBeenCalled();
  });

  it('mode inline/none ⇒ sin navegación (comportamiento local del leaf)', async () => {
    const { nav, router } = servicio();
    const espia = vi.spyOn(router, 'navigate');
    await nav.dispatch(
      { on: 'open', mode: 'inline' },
      { resource: 'orders', key: '1', action: 'open' },
    );
    await nav.dispatch(
      { on: 'open', mode: 'none' },
      { resource: 'orders', key: '1', action: 'open' },
    );
    expect(espia).not.toHaveBeenCalled();
  });

  it('target sin recurso/vista declarado en el registry ⇒ falla ruido, no navega', async () => {
    const { nav, router } = servicio();
    const espia = vi.spyOn(router, 'navigate');
    await expect(
      nav.dispatch(
        { on: 'open', mode: 'route', target: { resource: 'no-existe', view: 'x' } },
        { resource: 'no-existe', key: '1', action: 'open' },
      ),
    ).rejects.toThrow('no existe');
    expect(espia).not.toHaveBeenCalled();
  });

  it('guard bloquea (sin permiso) ⇒ URL intacta y sin payload del registro', async () => {
    const { nav, router } = servicio({ isAuthenticated: () => true, canAccess: () => false });
    const espia = vi.spyOn(router, 'navigate');
    const ok = await nav.dispatch(rutaBinding('route'), {
      resource: 'orders',
      key: 'A/B',
      action: 'open',
    });
    expect(ok).toBe(false);
    expect(espia).toHaveBeenCalledWith(['/', 'orders', 'A/B']);
    expect(router.url).toBe('/'); // ningún dato del registro llegó a la URL
    // guard bloqueado ⇒ el origen NO queda registrado (nada que volver a ver)
    await nav.back();
    expect(router.url).toBe('/');
  });
});

describe('ViewNavigationService.back (D4)', () => {
  function servicio() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'orders', component: ListaStub, data: { resourceId: 'orders' } },
          { path: 'orders/:key', component: DetalleStub, data: { resourceId: 'orders' } },
        ]),
        { provide: AuthService, useValue: { isAuthenticated: () => true, canAccess: () => true } },
      ],
    });
    return {
      nav: TestBed.inject(ViewNavigationService),
      router: TestBed.inject(Router),
    };
  }

  it('con dispatch previo ⇒ vuelve al origen registrado', async () => {
    const { nav, router } = servicio();
    await nav.dispatch(rutaBinding('route'), { resource: 'orders', key: '9', action: 'open' });
    expect(router.url).toBe('/orders/9');
    await nav.back();
    expect(router.url).toBe('/');
  });

  it('returnPath declarado ⇒ navega ahí (gana sobre el origen)', async () => {
    const { nav, router } = servicio();
    await nav.dispatch(rutaBinding('route'), { resource: 'orders', key: '9', action: 'open' });
    await nav.back('orders');
    expect(router.url).toBe('/orders');
  });

  it('deep link sin dispatch ⇒ cae a la raíz del recurso de la ruta', async () => {
    const { nav, router } = servicio();
    await router.navigate(['/orders/XYZ']); // entrada directa: no hay origen en memoria
    expect(router.url).toBe('/orders/XYZ');
    await nav.back();
    expect(router.url).toBe('/orders'); // raíz declarada del resourceId de la ruta
  });
});
