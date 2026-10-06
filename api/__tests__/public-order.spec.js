// api/__tests__/public-order.spec.js — Endpoint público de solo lectura (Fase 4).
//
// Verifica:
//   1. Declaración del endpoint en REGISTRY.endpoints.publicOrder con access: 'public'.
//   2. Handler handlePublicOrder con whitelist estricta (excluye customer_notes y authorized_notes).
//   3. Retorno 404 ante ref inexistente.
//   4. Retorno 400 si falta el parámetro ref.
//   5. Despacho y resolución de ruta parametrizada /p/orders/:ref en el router.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let REGISTRY;
let originalOrders;
let originalListCollection;
let originalOpenSpreadsheet;
let originalReadSheetData;

const MOCK_ORDER = {
  ref: 'ORD-789',
  customer_name: 'Juan Pérez',
  description: 'Paquete frágil 2kg',
  pickup_date: '2026-10-10',
  status: 'PENDIENTE',
  reference_photo: 'https://res.cloudinary.com/demo/image/upload/v1/orders/ref1.jpg',
  customer_notes: 'CLIENTE VIP - LLAMAR ANTES', // CONFIDENCIAL / INTERNO
  authorized_name: 'María Gómez',
  authorized_photo: 'https://res.cloudinary.com/demo/image/upload/v1/orders/auth1.jpg',
  authorized_notes: 'DNI verificado en counter', // CONFIDENCIAL / INTERNO
  auth_state: 'ACTIVA',
  created_at: '2026-10-05T10:00:00Z',
  updated_at: '2026-10-05T10:00:00Z',
  history: [
    { at: '2026-10-05T10:00:00Z', action: 'PEDIDO_CREADO', detail: 'Creado por mostrador' },
  ],
};

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  originalListCollection = globalThis.listCollection_;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
  originalReadSheetData = globalThis.readSheetData_;
});

afterEach(() => {
  if (originalOrders !== undefined) {
    REGISTRY.resources.orders = originalOrders;
    originalOrders = undefined;
  }
  globalThis.listCollection_ = originalListCollection;
  globalThis.openSpreadsheet_ = originalOpenSpreadsheet;
  globalThis.readSheetData_ = originalReadSheetData;
  globalThis.ROUTE_TABLE_ = null;
});

describe('Fase 4 — Endpoint público de solo lectura (/p/orders/:ref)', () => {
  it('REGISTRY declara el endpoint publicOrder con access: public y limits', () => {
    const endpoint = REGISTRY.endpoints.publicOrder;
    expect(endpoint).toBeDefined();
    expect(endpoint.route).toBe('/p/orders/:ref');
    expect(endpoint.method).toBe('GET');
    expect(endpoint.access).toBe('public');
    expect(endpoint.limits).toBe('60/min');
    expect(endpoint.handler).toBe('handlePublicOrder');
  });

  it('REGISTRY expone el handler handlePublicOrder', () => {
    expect(typeof REGISTRY.handlers.handlePublicOrder).toBe('function');
  });

  it('proyecta exclusivamente los campos públicos y oculta notas internas', () => {
    globalThis.openSpreadsheet_ = () => null;
    globalThis.readDetail_ = (_ss, _resource, _map, key) => {
      if (key === 'ORD-789') return { ...MOCK_ORDER };
      throw globalThis.apiError_(404, 'No existe: ' + key);
    };

    const request = {
      method: 'GET',
      path: '/p/orders/ORD-789',
      params: { ref: 'ORD-789' },
    };

    const res = REGISTRY.handlers.handlePublicOrder({}, request);

    expect(res.ref).toBe('ORD-789');
    expect(res.customer_name).toBe('Juan Pérez');
    expect(res.description).toBe('Paquete frágil 2kg');
    expect(res.pickup_date).toBe('2026-10-10');
    expect(res.status).toBe('PENDIENTE');
    expect(res.reference_photo).toBe(
      'https://res.cloudinary.com/demo/image/upload/v1/orders/ref1.jpg',
    );
    expect(res.authorized_name).toBe('María Gómez');
    expect(res.authorized_photo).toBe(
      'https://res.cloudinary.com/demo/image/upload/v1/orders/auth1.jpg',
    );
    expect(res.auth_state).toBe('ACTIVA');
    expect(res.created_at).toBe('2026-10-05T10:00:00Z');
    expect(res.updated_at).toBe('2026-10-05T10:00:00Z');
    expect(res.history).toEqual([
      { at: '2026-10-05T10:00:00Z', action: 'PEDIDO_CREADO', detail: 'Creado por mostrador' },
    ]);

    // WHITELIST: no debe exponer notas internas
    expect(res.customer_notes).toBeUndefined();
    expect(res.authorized_notes).toBeUndefined();
  });

  it('devuelve 404 si el ref del pedido no existe', () => {
    globalThis.openSpreadsheet_ = () => null;
    globalThis.readDetail_ = (_ss, _resource, _map, key) => {
      throw globalThis.apiError_(404, 'No existe: ' + key);
    };

    const request = {
      method: 'GET',
      path: '/p/orders/NO-EXISTE',
      params: { ref: 'NO-EXISTE' },
    };

    expect(() => REGISTRY.handlers.handlePublicOrder({}, request)).toThrowError(/No existe/);
  });

  it('devuelve 400 si falta el parámetro ref', () => {
    const request = {
      method: 'GET',
      path: '/p/orders',
      params: {},
    };

    expect(() => REGISTRY.handlers.handlePublicOrder({}, request)).toThrowError(
      /Falta la referencia/,
    );
  });

  it('el router resuelve la ruta parametrizada /p/orders/:ref con acceso público', () => {
    globalThis.openSpreadsheet_ = () => null;
    globalThis.readDetail_ = (_ss, _resource, _map, key) => {
      if (key === 'ORD-789') return { ...MOCK_ORDER };
      throw globalThis.apiError_(404, 'No existe: ' + key);
    };

    const resRaw = globalThis.doPost({
      postData: {
        contents: JSON.stringify({
          method: 'GET',
          path: '/p/orders/ORD-789',
        }),
      },
    });

    const res = JSON.parse(resRaw.getContent());
    expect(res.ref).toBe('ORD-789');
    expect(res.customer_name).toBe('Juan Pérez');
    expect(res.customer_notes).toBeUndefined();
  });
});
