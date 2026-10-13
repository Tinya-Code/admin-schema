import { describe, expect, it } from 'vitest';

import type {
  DataSource,
  NavigationTarget,
  ResourceSchema,
  SelectionBinding,
  UiViewTabs,
  ViewChildNode,
} from '../models/schema.model';
import {
  MAX_DEPTH,
  MAX_NODES,
  SchemaCompositionError,
  validateComposition,
} from './composition-validator';

/** Schema sintético mínimo para ejercitar el validador (D2 · R9.9.2). */
function esquemaCon(uiViews: NonNullable<ResourceSchema['uiViews']>): ResourceSchema {
  return {
    id: 'orders',
    label: 'Pedidos',
    labelPlural: 'Pedidos',
    kind: 'collection',
    endpoint: {},
    keyField: 'id',
    titleField: 'title',
    listColumns: [],
    fields: [],
    uiViews,
  };
}

function tabs(children: ViewChildNode[]): UiViewTabs {
  return { type: 'tabs', path: 'panel', config: { children } };
}

function hijo(id: string, type = 'list'): ViewChildNode {
  return { id, label: `Hijo ${id}`, type };
}

/** Exige un `SchemaCompositionError` cuyo mensaje nombra todos los fragmentos. */
function expectaError(fn: () => void, ...fragmentos: string[]): void {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(error, 'se esperaba un SchemaCompositionError').toBeInstanceOf(SchemaCompositionError);
  for (const fragmento of fragmentos) {
    expect((error as Error).message).toContain(fragmento);
  }
}

describe('composition-validator', () => {
  it('acepta una composición heterogénea válida', () => {
    const schema = esquemaCon({
      panel: tabs([
        {
          id: 'cal',
          label: 'Calendario',
          type: 'calendar',
          config: { startField: 'pickup_date', titleField: 'customer_name' },
        },
        {
          id: 'board',
          label: 'Tablero',
          type: 'kanban',
          config: { groupField: 'status', columns: [] },
        },
        { id: 'rows', label: 'Filas', type: 'list' },
      ]),
      list: { type: 'list' },
    });

    expect(() => validateComposition(schema)).not.toThrow();
  });

  it('deja pasar un schema sin composición (uiViews base)', () => {
    const schema = esquemaCon({
      list: { type: 'list' },
      create: { type: 'form', path: 'new' },
      detail: { type: 'detail', path: ':key' },
    });

    expect(() => validateComposition(schema)).not.toThrow();
  });

  it('falla con id duplicado nombrando contenedor e id', () => {
    const schema = esquemaCon({ panel: tabs([hijo('cal'), hijo('cal')]) });

    expectaError(() => validateComposition(schema), 'orders.panel', 'cal', 'duplicado');
  });

  it('falla con un hijo sin id nombrando el contenedor', () => {
    const sinId = { label: 'Sin id', type: 'list' } as ViewChildNode;
    const schema = esquemaCon({ panel: tabs([sinId]) });

    expectaError(() => validateComposition(schema), 'orders.panel', 'sin id');
  });

  it('falla con tipo de hijo sin descriptor nombrando recurso, contenedor e hijo (get, no resolve)', () => {
    const schema = esquemaCon({ panel: tabs([hijo('cal', 'heatmap')]) });

    expectaError(() => validateComposition(schema), 'orders', 'panel', 'cal', 'heatmap');
  });

  // ── Ciclos y refs (R9.9.2 · los `ref` hacen posible el ciclo) ──────────────

  it('detecta un ciclo directo por ref nombrando hijo y contenedor', () => {
    const schema = esquemaCon({
      panel: tabs([{ id: 'self', label: 'Autorreferencia', ref: 'panel' }]),
    });

    expectaError(() => validateComposition(schema), 'orders.panel', 'self', 'ciclo');
  });

  it('detecta un ciclo transitivo por ref', () => {
    const schema = esquemaCon({
      a: tabs([{ id: 'ab', label: 'AB', ref: 'b' }]),
      b: tabs([{ id: 'ba', label: 'BA', ref: 'a' }]),
    });

    expectaError(() => validateComposition(schema), 'ba', 'ciclo');
  });

  it('falla con un ref roto nombrando el hijo y el destino inexistente', () => {
    const schema = esquemaCon({
      panel: tabs([{ id: 'rows', label: 'Filas', ref: 'no-existe' }]),
    });

    expectaError(() => validateComposition(schema), 'orders.panel', 'rows', 'no-existe');
  });

  // ── Topes configurables (D2: MAX_DEPTH / MAX_NODES) ────────────────────────

  it('acepta un anidamiento justo en el límite de profundidad', () => {
    // a → b → c: los hijos de `c` quedan en profundidad MAX_DEPTH.
    const schema = esquemaCon({
      a: tabs([{ id: 'n1', label: 'N1', ref: 'b' }]),
      b: tabs([{ id: 'n2', label: 'N2', ref: 'c' }]),
      c: tabs([{ id: 'n3', label: 'N3', type: 'list' }]),
    });

    expect(() => validateComposition(schema)).not.toThrow();
  });

  it('falla con profundidad sobre el límite nombrando el hijo y la profundidad observada', () => {
    const schema = esquemaCon({
      a: tabs([{ id: 'n1', label: 'N1', ref: 'b' }]),
      b: tabs([{ id: 'n2', label: 'N2', ref: 'c' }]),
      c: tabs([{ id: 'n3', label: 'N3', ref: 'd' }]),
      d: tabs([{ id: 'n4', label: 'N4', type: 'list' }]),
    });

    expectaError(() => validateComposition(schema), 'n4', '4', String(MAX_DEPTH));
  });

  it('valida la profundidad ANIDADA dentro de un contenedor inline (no sólo vía ref)', () => {
    // panel → n1 → n2 → n3 (todos tabs inline) ⇒ los hijos de n3 están en
    // profundidad 4 y deben reventar ANTES del render (D2).
    const schema = esquemaCon({
      panel: tabs([
        {
          id: 'n1',
          label: 'N1',
          type: 'tabs',
          config: {
            children: [
              {
                id: 'n2',
                label: 'N2',
                type: 'tabs',
                config: {
                  children: [
                    {
                      id: 'n3',
                      label: 'N3',
                      type: 'tabs',
                      config: { children: [hijo('n4')] },
                    },
                  ],
                },
              },
            ],
          },
        },
      ]),
    });

    expectaError(() => validateComposition(schema), 'n4', 'profundidad', String(MAX_DEPTH));
  });

  it('detecta un ciclo que atraviesa un contenedor inline (D2)', () => {
    const schema = esquemaCon({
      panel: tabs([
        {
          id: 'hijo',
          label: 'Hijo',
          type: 'tabs',
          config: { children: [{ id: 'loop', label: 'Loop', ref: 'panel' }] },
        },
      ]),
    });

    expectaError(() => validateComposition(schema), 'ciclo', 'panel');
  });

  it('acepta una composición con exactamente MAX_NODES nodos', () => {
    const hijos = Array.from({ length: MAX_NODES }, (_, i) => hijo(`n${i}`));
    const schema = esquemaCon({ panel: tabs(hijos) });

    expect(() => validateComposition(schema)).not.toThrow();
  });

  it('falla al superar MAX_NODES nombrando el tope', () => {
    const hijos = Array.from({ length: MAX_NODES + 1 }, (_, i) => hijo(`n${i}`));
    const schema = esquemaCon({ panel: tabs(hijos) });

    expectaError(() => validateComposition(schema), 'límite de', String(MAX_NODES));
  });

  // ── Destino de navegación (spec view-navigation: URL cruda rechazada) ──────

  it('rechaza una URL cruda como destino nombrando recurso, contenedor e hijo', () => {
    const schema = esquemaCon({
      panel: tabs([
        {
          id: 'rows',
          label: 'Filas',
          type: 'list',
          select: {
            on: 'open',
            mode: 'route',
            target: 'https://evil.com/x' as unknown as NavigationTarget,
          },
        },
      ]),
    });

    expectaError(
      () => validateComposition(schema),
      'orders.panel',
      'rows',
      'URL cruda',
      'https://evil.com/x',
    );
  });

  it('rechaza una URL cruda declarada en una uiView raíz', () => {
    const schema = esquemaCon({
      list: {
        type: 'list',
        select: {
          on: 'open',
          mode: 'route',
          target: '/dashboard' as unknown as NavigationTarget,
        },
      },
    });

    expectaError(() => validateComposition(schema), 'orders.list', 'URL cruda', '/dashboard');
  });

  function esquemaConSelect(target: NavigationTarget): ResourceSchema {
    return esquemaCon({
      list: { type: 'list', select: { on: 'open', mode: 'route', target } },
    });
  }

  it('valida que el destino nombre un recurso y una uiView declarados', () => {
    expectaError(
      () => validateComposition(esquemaConSelect({ resource: 'fantasma', view: 'detail' })),
      'orders.list',
      'fantasma',
    );
    expectaError(
      () => validateComposition(esquemaConSelect({ resource: 'orders', view: 'no-existe' })),
      'orders.list',
      'no-existe',
    );
  });

  it('valida los params declarados contra la ruta del destino', () => {
    // Param que la ruta del destino no tiene.
    expectaError(
      () =>
        validateComposition(
          esquemaConSelect({ resource: 'orders', view: 'detail', params: ['nope'] }),
        ),
      'nope',
    );
    // Falta declarar el param que la ruta `orders/:key` exige.
    expectaError(
      () => validateComposition(esquemaConSelect({ resource: 'orders', view: 'detail' })),
      'key',
    );
  });

  it('acepta un destino declarado con resource + view + params válidos', () => {
    const schema = esquemaConSelect({
      resource: 'orders',
      view: 'detail',
      params: ['key'],
    });

    expect(() => validateComposition(schema)).not.toThrow();
  });

  // ── Fuente de filas incompatible (R9.9.2 · "incompatible sources") ─────────

  function esquemaConSource(source: DataSource): ResourceSchema {
    return esquemaCon({
      panel: tabs([
        {
          id: 'cal',
          label: 'Calendario',
          type: 'calendar',
          config: { startField: 'pickup_date', titleField: 'customer_name', source },
        },
      ]),
    });
  }

  it('falla con una source sobre un recurso no declarado', () => {
    expectaError(
      () => validateComposition(esquemaConSource({ resource: 'fantasma' })),
      'orders.panel',
      'cal',
      'fantasma',
    );
  });

  it('falla con una source sobre una vista no declarada del recurso', () => {
    expectaError(
      () => validateComposition(esquemaConSource({ resource: 'orders', view: 'vista-fantasma' })),
      'vista-fantasma',
    );
  });

  it('acepta una source con recurso declarado y sin vista', () => {
    expect(() => validateComposition(esquemaConSource({ resource: 'orders' }))).not.toThrow();
  });

  it('un binding mode none/inline no exige target', () => {
    const schema = esquemaCon({
      list: { type: 'list', select: { on: 'open', mode: 'inline' } satisfies SelectionBinding },
    });

    expect(() => validateComposition(schema)).not.toThrow();
  });
});
