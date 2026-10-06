// api/__tests__/dashboard — handler handleDashboard (Fase 3 §3.3).
//
// Prueba unitaria sin Sheets reales: usa el mismo patrón que
// crud-hooks.spec.js (fakeApp_ + fakeSheet_) pero llama directamente
// al handler a través del REGISTRY.
//
// El handler usa listCollection_ internamente, que pide un `ss`
// via openSpreadsheet_(). Como no podemos pisar un global de GAS en test,
// accedemos directamente a las funciones internas del motor (misma
// técnica que crud-hooks: llama resourceCreate_ directamente en lugar de
// dispatchResource_).
//
// Estrategia:
//   1) Cargar el backend (REGISTRY real, incluyendo orders.js y dashboard.js).
//   2) Parchear temporalmente REGISTRY.resources.orders para que apunte
//      a un recurso mínimo con las mismas views declaradas.
//   3) Parchear listCollection_ para devolver fixture en lugar de ir a Sheets.
//   4) Llamar al handler directamente: REGISTRY.handlers.handleDashboard().
//   5) Restaurar los originales en afterEach.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let REGISTRY;
let originalOrders;
let originalListCollection;
let originalOpenSpreadsheet;

// Recurso mínimo de orders (sólo lo que usa el handler + applyDeclaredView_).
const ORDERS_RESOURCE = {
  id: 'orders',
  kind: 'collection',
  sheet: 'orders',
  keyField: 'ref',
  titleField: 'customer_name',
  ordering: 'none',
  activeField: null,
  onDelete: 'restrict',
  dependents: [],
  imageFolder: 'orders',
  exposeToFront: true,
  listProjection: null,
  policies: { access: { read: 'admin', write: 'admin' } },
  checks: [],
  views: {
    pendientes: {
      where: [{ field: 'status', op: 'eq', value: 'PENDIENTE' }],
      aggregate: 'count',
    },
    entregados: {
      where: [{ field: 'status', op: 'eq', value: 'ENTREGADO' }],
      aggregate: 'count',
    },
    cancelados: {
      where: [{ field: 'status', op: 'eq', value: 'CANCELADO' }],
      aggregate: 'count',
    },
  },
  fields: [
    { key: 'ref', type: 'text', required: true, unique: true },
    { key: 'customer_name', type: 'text', required: true },
    {
      key: 'status',
      type: 'select',
      required: true,
      default: 'PENDIENTE',
      enum: ['PENDIENTE', 'ENTREGADO', 'CANCELADO'],
    },
  ],
};

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  originalListCollection = globalThis.listCollection_;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
});

afterEach(() => {
  // Restaurar el recurso y las funciones originales.
  if (originalOrders !== undefined) {
    REGISTRY.resources.orders = originalOrders;
    originalOrders = undefined;
  }
  globalThis.listCollection_ = originalListCollection;
  globalThis.openSpreadsheet_ = originalOpenSpreadsheet;
});

/**
 * Parchea openSpreadsheet_ y listCollection_ para evitar Sheets reales.
 * openSpreadsheet_ devuelve un sentinel null; listCollection_ ignora `ss`
 * y devuelve la fixture directamente — mismo patrón que crud-hooks.spec.js.
 */
function patchListCollection(items) {
  globalThis.openSpreadsheet_ = () => null; // evita PropertiesService.require
  globalThis.listCollection_ = (_ss, _resource, _map) => items;
}

/** Registra el recurso mínimo con vistas, preservando el original. */
function useMinimalOrders() {
  originalOrders = REGISTRY.resources.orders;
  REGISTRY.resources.orders = ORDERS_RESOURCE;
  // STORAGE_MAPS_ cachea por id: limpiar la entrada para que storageMap_
  // reconstruya con el nuevo schema.
  const maps = globalThis.STORAGE_MAPS_;
  if (maps) delete maps['orders'];
}

describe('handleDashboard', () => {
  it('REGISTRY expone handleDashboard (declarado en dashboard.js)', () => {
    expect(typeof REGISTRY.handlers.handleDashboard).toBe('function');
  });

  it('devuelve los tres contadores cuando hay pedidos en los tres estados', () => {
    useMinimalOrders();
    patchListCollection([
      { ref: 'R1', status: 'PENDIENTE' },
      { ref: 'R2', status: 'PENDIENTE' },
      { ref: 'R3', status: 'ENTREGADO' },
      { ref: 'R4', status: 'CANCELADO' },
      { ref: 'R5', status: 'CANCELADO' },
      { ref: 'R6', status: 'CANCELADO' },
    ]);

    const result = REGISTRY.handlers.handleDashboard();

    expect(result.pendientes).toBe(2);
    expect(result.entregados).toBe(1);
    expect(result.cancelados).toBe(3);
  });

  it('devuelve ceros cuando la colección está vacía', () => {
    useMinimalOrders();
    patchListCollection([]);

    const result = REGISTRY.handlers.handleDashboard();

    expect(result.pendientes).toBe(0);
    expect(result.entregados).toBe(0);
    expect(result.cancelados).toBe(0);
  });

  it('devuelve objeto vacío (fail-soft) si el recurso orders no está registrado', () => {
    // Simular recurso ausente sin tocar el recurso real del REGISTRY.
    const orig = REGISTRY.resources.orders;
    delete REGISTRY.resources.orders;

    const result = REGISTRY.handlers.handleDashboard();

    // Restaurar antes del expect para no corromper otros tests en caso de fallo.
    REGISTRY.resources.orders = orig;

    expect(result).toEqual({});
  });

  it('evalúa dinámicamente cualquier conjunto de vistas declaradas en el schema', () => {
    originalOrders = REGISTRY.resources.orders;
    REGISTRY.resources.orders = {
      ...ORDERS_RESOURCE,
      views: {
        total_pedidos: { aggregate: 'count' },
        pendientes: {
          where: [{ field: 'status', op: 'eq', value: 'PENDIENTE' }],
          aggregate: 'count',
        },
      },
    };
    const maps = globalThis.STORAGE_MAPS_;
    if (maps) delete maps['orders'];

    patchListCollection([
      { ref: 'R1', status: 'PENDIENTE' },
      { ref: 'R2', status: 'ENTREGADO' },
    ]);

    const result = REGISTRY.handlers.handleDashboard();

    expect(result.total_pedidos).toBe(2);
    expect(result.pendientes).toBe(1);
    expect(Object.keys(result).sort()).toEqual(['pendientes', 'total_pedidos']);
  });

  it('devuelve array de objetos con where, sort y limit para vistas tabulares (record-list)', () => {
    originalOrders = REGISTRY.resources.orders;
    REGISTRY.resources.orders = {
      ...ORDERS_RESOURCE,
      views: {
        pendientes_recientes: {
          where: [{ field: 'status', op: 'eq', value: 'PENDIENTE' }],
          sort: [{ field: 'created_at', dir: 'desc' }],
          limit: 2,
        },
      },
    };
    const maps = globalThis.STORAGE_MAPS_;
    if (maps) delete maps['orders'];

    patchListCollection([
      { ref: 'R1', customer_name: 'Ana', status: 'PENDIENTE', created_at: '2026-10-01' },
      { ref: 'R2', customer_name: 'Beto', status: 'ENTREGADO', created_at: '2026-10-02' },
      { ref: 'R3', customer_name: 'Carla', status: 'PENDIENTE', created_at: '2026-10-03' },
      { ref: 'R4', customer_name: 'Dario', status: 'PENDIENTE', created_at: '2026-10-04' },
    ]);

    const result = REGISTRY.handlers.handleDashboard();

    expect(Array.isArray(result.pendientes_recientes)).toBe(true);
    expect(result.pendientes_recientes.length).toBe(2);
    // Orden desc por created_at: Dario (10-04) primero, luego Carla (10-03)
    expect(result.pendientes_recientes[0].ref).toBe('R4');
    expect(result.pendientes_recientes[1].ref).toBe('R3');
  });

  it('devuelve array vacío si no hay coincidencias para una vista tabular', () => {
    originalOrders = REGISTRY.resources.orders;
    REGISTRY.resources.orders = {
      ...ORDERS_RESOURCE,
      views: {
        pendientes_recientes: {
          where: [{ field: 'status', op: 'eq', value: 'PENDIENTE' }],
        },
      },
    };
    const maps = globalThis.STORAGE_MAPS_;
    if (maps) delete maps['orders'];

    patchListCollection([{ ref: 'R1', status: 'ENTREGADO' }]);

    const result = REGISTRY.handlers.handleDashboard();

    expect(result.pendientes_recientes).toEqual([]);
  });
});
