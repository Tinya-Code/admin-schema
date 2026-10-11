// api/__tests__/pin-regenerate.spec.js — Acción regenerate-pin (R8.8 · D14).
//
// Cierra el hueco de operación: el PIN perdido/reciclado no tenía remedio
// salvo recrear el pedido a mano. La acción:
//   · se declara en `orders.actions['regenerate-pin']` (escape hatch §6),
//   · corre `handlePinRegenerate` (capabilities/handlers/pin-regenerate),
//   · transacciona bajo el lock de política del recurso,
//   · rehace el mismo circuito que el create: transform `pin` → hash en
//     `_pin` → fila del pedido con el PIN nuevo → sustitución (las filas
//     activas viejas de ESTE ref quedan usadas).
//
// R8.8: el dispatch le pasa `request.resource` al escape hatch — sin eso el
// handler no puede tomar el lock, auditar ni invalidar caché. El test de
// integración (§4) es el que fija ese contrato.
//
// Entorno: igual que pin-generate.spec.js — Utilities es un Proxy inerte,
// Props.hashText se parchea y `__failed__` jamás se toca.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeSheet_ } from './_sheets.js';

let REGISTRY;
let storageMap_;
let dispatchAction_;

const HASH = (text) => `H:${text}`;
let originalHashText;

const PIN_HEADERS = ['ref', 'pin_hash', 'created_at', 'used_at'];
const ORDER_HEADERS = ['ref', 'customer_name', 'pin', 'status'];

/** ss stub: `_pin` (appendRow + getRange.setValue capturados) y pedidos. */
function scenario_({ pinRows = [], orderRows = [], pinSheet = true } = {}) {
  const appended = [];
  const marked = [];
  const orderSheet = fakeSheet_([ORDER_HEADERS, ...orderRows.map((r) => r.values)]);

  const pinStub = pinSheet
    ? {
        appendRow: (row) => appended.push(row),
        getRange: (row, col) => ({
          setValue: (value) => marked.push({ row, col, value }),
        }),
      }
    : null;

  const ss = {
    getSheetByName: (name) => {
      if (name === '_pin') return pinStub;
      if (name === 'orders') return orderSheet;
      return null;
    },
  };

  globalThis.openSpreadsheet_ = () => ss;
  globalThis.readSheetData_ = (_ss, name) => {
    if (name === '_pin') {
      return { sheet: pinStub, headers: PIN_HEADERS, rows: pinRows };
    }
    if (name === 'orders') {
      return { sheet: orderSheet, headers: ORDER_HEADERS, rows: orderRows };
    }
    throw new Error('hoja inesperada: ' + name);
  };

  return { appended, marked, orderSheet };
}

function makePinRow(ref, hash, { at = 2, used = '' } = {}) {
  return { at, values: [ref, hash, '2026-10-10 09:00:00', used] };
}

function makeOrderRow(ref, pin, { at = 2 } = {}) {
  return { at, values: [ref, 'María López', pin, 'PENDIENTE'] };
}

/** Llama al handler como lo haría el dispatch, con el registro ya resuelto. */
function callHandler(resource, record) {
  return REGISTRY.handlers.handlePinRegenerate(
    {},
    { resource, record, action: 'regenerate-pin', payload: {} },
  );
}

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  storageMap_ = globalThis.storageMap_;
  dispatchAction_ = globalThis.dispatchAction_;
  originalHashText = globalThis.Props.hashText;
});

afterEach(() => {
  globalThis.Props.hashText = originalHashText;
});

describe('R8.8 — declaración y registro de la acción', () => {
  it('orders declara actions["regenerate-pin"] con handler', () => {
    const action = REGISTRY.resources.orders.actions['regenerate-pin'];
    expect(action).toBeDefined();
    expect(action.handler).toBe('handlePinRegenerate');
    // Escape hatch puro: SIN set declarativo (XOR validado por validate-registry).
    expect(action.set).toBeUndefined();
  });

  it('el router publica la ruta declarada para el ref del pedido', () => {
    globalThis.ROUTE_TABLE_ = null;

    const route = globalThis.resolveRoute_('/admin/orders/55HL6P/actions/regenerate-pin');

    expect(route).toMatchObject({
      kind: 'resource',
      resource: REGISTRY.resources.orders,
      action: 'regenerate-pin',
      params: { ref: '55HL6P' },
    });
  });

  it('REGISTRY expone el handler handlePinRegenerate', () => {
    expect(typeof REGISTRY.handlers.handlePinRegenerate).toBe('function');
  });

  it('sin request.resource ⇒ 500 ruidoso (contrato de R8.8, no fallback mudo)', () => {
    scenario_({});
    expect(() => REGISTRY.handlers.handlePinRegenerate({}, { record: { ref: 'ORD-1' } })).toThrow(
      /recurso/i,
    );
  });
});

describe('R8.8 — transacción: PIN nuevo, fila actualizada, sustitución', () => {
  it('regenera: hash nuevo en _pin, fila con PIN nuevo, vieja marcada usada', () => {
    globalThis.Props.hashText = HASH;
    const s = scenario_({
      pinRows: [makePinRow('ORD-1', 'H:viejo', { at: 2 })],
      orderRows: [makeOrderRow('ORD-1', '111111', { at: 2 })],
    });
    const resource = REGISTRY.resources.orders;

    const out = callHandler(resource, { ref: 'ORD-1' });

    expect(out.ok).toBe(true);
    expect(out.ref).toBe('ORD-1');
    // PIN nuevo en claro, 6 dígitos (mismo generador que el create).
    expect(out.pin).toMatch(/^\d{6}$/);

    // 1) El hash del NUEVO pin quedó en _pin (nunca texto plano).
    expect(s.appended).toHaveLength(1);
    expect(s.appended[0][0]).toBe('ORD-1');
    expect(s.appended[0][1]).toBe(HASH(out.pin));
    expect(s.appended[0][1]).not.toBe(out.pin);
    expect(s.appended[0][3]).toBe(''); // used_at vacío ⇒ activo

    // 2) La fila del pedido quedó con el PIN nuevo.
    const map = storageMap_(resource);
    const pinIdx = ORDER_HEADERS.indexOf('pin');
    expect(s.orderSheet.rows()[1][pinIdx]).toBe(out.pin);

    // 3) La fila activa vieja (fila física 2, used_at = col 4) quedó usada.
    expect(s.marked).toHaveLength(1);
    expect(s.marked[0]).toEqual({
      row: 2,
      col: 4,
      value: expect.stringMatching(/^\d{4}-\d{2}-\d{2} /),
    });

    // map es el del recurso real — sanity de que el keyField resuelto es `ref`.
    expect(map.keyField).toBe('ref');
  });

  it('las filas usadas, __failed__ y de OTROS refs no se tocan', () => {
    globalThis.Props.hashText = HASH;
    const s = scenario_({
      pinRows: [
        makePinRow('ORD-1', 'H:activa', { at: 2 }),
        makePinRow('ORD-1', 'H:usada', { at: 3, used: '2026-10-10 09:30:00' }),
        makePinRow('ORD-1', '__failed__', { at: 4, used: '2026-10-10 09:31:00' }),
        makePinRow('ORD-OTRO', 'H:otro', { at: 5 }),
      ],
      orderRows: [makeOrderRow('ORD-1', '111111', { at: 2 })],
    });

    callHandler(REGISTRY.resources.orders, { ref: 'ORD-1' });

    // Sólo la fila 2 (activa de ESTE ref) fue marcada: usada, __failed__ y
    // la de otro pedido quedan intactas.
    expect(s.marked).toHaveLength(1);
    expect(s.marked[0].row).toBe(2);
  });

  it('dos regeneraciones seguidas: cada una sustituye a la anterior', () => {
    globalThis.Props.hashText = HASH;
    const s = scenario_({
      pinRows: [makePinRow('ORD-1', 'H:primera', { at: 2 })],
      orderRows: [makeOrderRow('ORD-1', '111111', { at: 2 })],
    });

    const first = callHandler(REGISTRY.resources.orders, { ref: 'ORD-1' });
    const second = callHandler(REGISTRY.resources.orders, { ref: 'ORD-1' });

    expect(first.pin).not.toBe(second.pin);
    expect(s.appended).toHaveLength(2);
    // Cada hash corresponde a su PIN, en orden.
    expect(s.appended[0][1]).toBe(HASH(first.pin));
    expect(s.appended[1][1]).toBe(HASH(second.pin));
    // Y la fila del pedido quedó con el ÚLTIMO.
    expect(s.orderSheet.rows()[1][ORDER_HEADERS.indexOf('pin')]).toBe(second.pin);
  });
});

describe('R8.8 — defensas', () => {
  it('fila del pedido inexistente ⇒ 404', () => {
    scenario_({ pinRows: [], orderRows: [] });
    expect(() => callHandler(REGISTRY.resources.orders, { ref: 'ORD-NODE' })).toThrow(/existe/i);
  });

  it('hoja _pin inexistente ⇒ 503 (setupDrift pendiente)', () => {
    scenario_({ pinSheet: false, orderRows: [makeOrderRow('ORD-1', '111111')] });
    expect(() => callHandler(REGISTRY.resources.orders, { ref: 'ORD-1' })).toThrow(
      /PIN no está configurado/i,
    );
  });

  it('columna pin ausente en la hoja del pedido ⇒ 500', () => {
    const orderSheet = fakeSheet_([
      ['ref', 'customer_name', 'status'],
      ['ORD-1', 'María', 'PENDIENTE'],
    ]);
    globalThis.openSpreadsheet_ = () => ({
      getSheetByName: (name) =>
        name === '_pin' ? { appendRow: () => {} } : name === 'orders' ? orderSheet : null,
    });
    globalThis.readSheetData_ = (_ss, name) => {
      if (name === '_pin') return { sheet: null, headers: PIN_HEADERS, rows: [] };
      // La fila SÍ existe (el handler la encuentra) pero la hoja no tiene
      // la columna `pin`: el fallo tiene que ser el de R1.1, no un 404 previo.
      return {
        sheet: orderSheet,
        headers: ['ref', 'customer_name', 'status'],
        rows: [{ at: 2, values: ['ORD-1', 'María', 'PENDIENTE'] }],
      };
    };
    expect(() => callHandler(REGISTRY.resources.orders, { ref: 'ORD-1' })).toThrow(/pin/i);
  });
});

describe('R8.8 — integración: dispatchAction_ entrega request.resource', () => {
  it('POST /admin/orders/:ref/actions/regenerate-pin ⇒ result con PIN y fila mutada', () => {
    globalThis.Props.hashText = HASH;
    const s = scenario_({
      pinRows: [makePinRow('ORD-7', 'H:viejo', { at: 2 })],
      orderRows: [makeOrderRow('ORD-7', '111111', { at: 2 })],
    });

    const out = dispatchAction_(REGISTRY.resources.orders, {
      action: 'regenerate-pin',
      params: { ref: 'ORD-7' },
      payload: {},
      user: { roles: ['admin'] },
    });

    expect(out.action).toBe('regenerate-pin');
    expect(out.affected).toBe('ORD-7');
    expect(out.handler).toBe('handlePinRegenerate');
    expect(out.result.ok).toBe(true);
    expect(out.result.pin).toMatch(/^\d{6}$/);
    // La transacción corrió COMPLETA: hash nuevo + fila actualizada.
    expect(s.appended[0][1]).toBe(HASH(out.result.pin));
    expect(s.orderSheet.rows()[1][ORDER_HEADERS.indexOf('pin')]).toBe(out.result.pin);
  });

  it('acción no declarada ⇒ 404 del dispatch (el handler ni se invoca)', () => {
    const s = scenario_({ orderRows: [makeOrderRow('ORD-7', '111111')] });
    expect(() =>
      dispatchAction_(REGISTRY.resources.orders, {
        action: 'no-existe',
        params: { ref: 'ORD-7' },
        payload: {},
      }),
    ).toThrow(/No existe la acción/);
    expect(s.appended).toHaveLength(0);
  });
});
