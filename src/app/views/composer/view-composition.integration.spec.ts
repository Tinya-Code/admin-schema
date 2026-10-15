import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';

import { API_URL } from '@tinya-code/gas-admin-ui';
import { validateComposition } from '@tinya-code/gas-admin-ui';
import { ApiService } from '@tinya-code/gas-admin-ui';
import { DataSourceService } from '@tinya-code/gas-admin-ui';
import { ordersSchema } from '../../schemas/orders.schema';
import { resourceRoutes } from '@tinya-code/gas-admin-ui';
import { ComposerHost } from '@tinya-code/gas-admin-ui';
import '../../schemas/seed-catalog';

type Fixture = ReturnType<TestBed['createComponent']>;

/**
 * El `import()` dinámico de cada descriptor no es microtask puro y
 * `whenStable` en TestBed no lo espera: ceder macrotarea + detectar hasta
 * que el DOM avance (mismo helper que `composer-host.spec`).
 */
async function flush(fixture: Fixture, cond?: () => boolean): Promise<Fixture> {
  const ciclosMax = cond === undefined ? 4 : 30;
  for (let ciclo = 0; ciclo < ciclosMax; ciclo += 1) {
    if (cond?.()) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  }
  return fixture;
}

async function montar(api?: {
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}): Promise<Fixture> {
  const apiService = api ?? {
    list: vi.fn(() => of({ items: [], total: 0 })),
    get: vi.fn(() => of(null)),
    request: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ActivatedRoute,
        useValue: {
          data: of({
            schema: ordersSchema,
            resourceId: 'orders',
            uiView: 'resumen',
            viewType: 'tabs',
          }),
        },
      },
      { provide: API_URL, useValue: '/api' },
      // Router fake (NO provideRouter: pisaría el ActivatedRoute del test).
      {
        provide: Router,
        useValue: {
          url: '/',
          navigate: vi.fn().mockResolvedValue(true),
          navigateByUrl: vi.fn().mockResolvedValue(true),
          routerState: { snapshot: { root: { data: {}, firstChild: null } } },
        },
      },
      // Hojas reales: `DataSourceService` para calendar/kanban, `ApiService`
      // para ResourcePage/ListView (mismo doble que sus specs unitarias).
      { provide: DataSourceService, useValue: { rows: vi.fn(() => Promise.resolve([])) } },
      { provide: ApiService, useValue: apiService },
    ],
  });

  const fixture = TestBed.createComponent(ComposerHost);
  fixture.detectChanges();
  await flush(fixture);
  return fixture;
}

function dom(fixture: Fixture): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function labelsDe(fixture: Fixture): string[] {
  return [...dom(fixture).querySelectorAll<HTMLElement>('[role="tab"]')].map(
    (t) => t.textContent?.trim() ?? '',
  );
}

function clic(fixture: Fixture, indice: number): void {
  [...dom(fixture).querySelectorAll<HTMLElement>('[role="tab"]')][indice].click();
}

describe('view-composition — integración con la fixture real de orders', () => {
  it('la fixture valida y la ruta `orders/resumen` declara el descriptor tabs', () => {
    expect(() => validateComposition(ordersSchema)).not.toThrow();

    const ruta = resourceRoutes([ordersSchema]).find((r) => r.path === 'orders/resumen');
    expect(ruta?.data).toMatchObject({
      resourceId: 'orders',
      uiView: 'resumen',
      viewType: 'tabs',
    });
    expect(typeof ruta?.loadComponent).toBe('function');
    expect(ruta?.canActivate).toHaveLength(1);
  });

  it('monta la composición: pestañas en orden declarado con la inicial (board)', async () => {
    const fixture = await montar();
    await flush(fixture, () => !!dom(fixture).querySelector('app-kanban-view'));

    expect(labelsDe(fixture)).toEqual(['Calendario', 'Tablero', 'Pedidos', 'Paneles']);

    const activa = [...dom(fixture).querySelectorAll<HTMLElement>('[role="tab"]')].filter(
      (t) => t.getAttribute('aria-selected') === 'true',
    );
    expect(activa.map((t) => t.textContent?.trim())).toEqual(['Tablero']);

    // El panel activo es el kanban con SU config por instancia (columnas de
    // `status` de la fixture, no las de otra hoja).
    expect(dom(fixture).querySelector('app-kanban-view')).toBeTruthy();
    expect(dom(fixture).textContent).toContain('Pendiente');
    expect(dom(fixture).textContent).toContain('Entregado');
  });

  it('cada hoja recibe su propia config al activarse (calendar vs kanban)', async () => {
    const fixture = await montar();

    clic(fixture, 0); // Calendario
    await flush(fixture, () => !!dom(fixture).querySelector('app-calendar-view'));
    expect(dom(fixture).querySelector('app-calendar-view')).toBeTruthy();
    // El kanban no retenido se destruyó: la config de la otra hoja no puede
    // mezclarse con la de esta instancia.
    expect(dom(fixture).querySelector('app-kanban-view')).toBeFalsy();
    expect(dom(fixture).textContent).not.toContain('Pendiente');

    clic(fixture, 1); // Tablero
    await flush(fixture, () => !!dom(fixture).querySelector('app-kanban-view'));
    expect(dom(fixture).querySelector('app-kanban-view')).toBeTruthy();
    expect(dom(fixture).textContent).toContain('Pendiente');
    expect(dom(fixture).querySelector('app-calendar-view')).toBeFalsy();
  });

  it('anida tabs dentro del límite: la pestaña Paneles monta el tabs nieto', async () => {
    const fixture = await montar();

    clic(fixture, 3); // Paneles
    await flush(fixture, () => dom(fixture).querySelectorAll('[role="tablist"]').length === 2);

    // Pestaña activa en el nivel raíz + tablist interno del nieto.
    expect(labelsDe(fixture)).toContain('Agenda interna');
    expect(dom(fixture).querySelectorAll('[role="tablist"]').length).toBe(2);
  });

  it('la composición sólo pide endpoints declarados en el schema', async () => {
    const api = {
      list: vi.fn(() => of({ items: [], total: 0 })),
      get: vi.fn(() => of(null)),
      request: vi.fn(() => of({})),
    };
    // Pre-carga el chunk (ver el test anterior: los ciclos de flush no
    // esperan el import() frío del descriptor list).
    await import('@tinya-code/gas-admin-ui');
    const fixture = await montar(api);

    clic(fixture, 2); // Pedidos ⇒ ResourcePage/ListView pide su listado
    await flush(fixture, () => !!dom(fixture).querySelector('app-resource-page'));

    const declarados = Object.values(ordersSchema.endpoint ?? {}).filter(
      (e): e is string => typeof e === 'string',
    );
    expect(api.list.mock.calls.length).toBeGreaterThan(0);

    // Toda ruta /admin/… que salga de cualquier llamada debe pertenecer a
    // `orders.endpoint` — ningún componente puede pedir un endpoint que el
    // schema no declara.
    const pedidas = api.list.mock.calls
      .flatMap((args) => JSON.stringify(args).match(/\/admin\/[a-z_]+/g) ?? [])
      .filter((ruta, i, arr) => arr.indexOf(ruta) === i);
    expect(pedidas.length).toBeGreaterThan(0);
    for (const ruta of pedidas) {
      expect(
        declarados.some(
          (e) =>
            ruta === e || e.startsWith(`${ruta}/`) || ruta === e.split('/').slice(0, 3).join('/'),
        ),
        `ruta pedida '${ruta}' no está en orders.endpoint`,
      ).toBe(true);
    }
    expect(api.get).not.toHaveBeenCalled();
    expect(api.request).not.toHaveBeenCalled();
  });

  it('la hoja list (Pedidos) monta ResourcePage por el descriptor registrado', async () => {
    // Pre-carga el chunk: el `import()` dinámico del descriptor tarda ms de
    // disco y los ciclos de `flush` (macrotareas inmediatas) no lo esperan.
    await import('@tinya-code/gas-admin-ui');
    const fixture = await montar();

    clic(fixture, 2); // Pedidos
    await flush(fixture, () => !!dom(fixture).querySelector('app-resource-page'));

    expect(dom(fixture).querySelector('app-resource-page')).toBeTruthy();
    expect(dom(fixture).querySelector('app-kanban-view')).toBeFalsy();
  });
});
