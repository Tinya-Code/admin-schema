// api/__tests__/events.spec.js — Handler handleEvents (Fase 6).
//
// Verifica:
//   1. Declaración del endpoint events en REGISTRY.endpoints con access: 'admin'.
//   2. Handler handleEvents registrado en REGISTRY.handlers.
//   3. Evento válido → { ok: true } y appendRow con las columnas correctas.
//   4. Falta event → 400.
//   5. event demasiado largo → 400.
//   6. meta se serializa a JSON en el backend (nunca objeto crudo).
//   7. meta demasiado largo → se trunca a 512 bytes (no lanza error).
//   8. ref y session_id opcionales — se escriben vacíos si no vienen.
//   9. Hoja _events inexistente → 503.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let REGISTRY;
let originalOpenSpreadsheet;

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
});

afterEach(() => {
  globalThis.openSpreadsheet_ = originalOpenSpreadsheet;
});

/** Construye el stub de ss con una hoja _events que captura appendRow. */
function buildSsStub(appendedRows) {
  const sheetStub = {
    appendRow: (row) => appendedRows.push(row),
  };
  return {
    getSheetByName: (name) => (name === '_events' ? sheetStub : null),
  };
}

describe('Fase 6 — Eventos de uso (POST /admin/events)', () => {
  it('REGISTRY declara el endpoint events con access: admin, method: POST y limits', () => {
    const ep = REGISTRY.endpoints.events;
    expect(ep).toBeDefined();
    expect(ep.route).toBe('/admin/events');
    expect(ep.method).toBe('POST');
    expect(ep.access).toBe('admin');
    expect(ep.limits).toBe('60/min');
    expect(ep.handler).toBe('handleEvents');
  });

  it('REGISTRY expone el handler handleEvents', () => {
    expect(typeof REGISTRY.handlers.handleEvents).toBe('function');
  });

  it('evento válido → { ok: true } y escribe la fila correctamente', () => {
    const appended = [];
    globalThis.openSpreadsheet_ = () => buildSsStub(appended);

    const result = REGISTRY.handlers.handleEvents({
      event: 'order_viewed',
      ref: 'ORD-001',
      session_id: 'sess-abc',
      meta: { source: 'share_link' },
    });

    expect(result.ok).toBe(true);
    expect(appended).toHaveLength(1);
    const row = appended[0];
    // [timestamp, event, ref, session_id, meta]
    expect(row[1]).toBe('order_viewed');
    expect(row[2]).toBe('ORD-001');
    expect(row[3]).toBe('sess-abc');
    expect(row[4]).toBe('{"source":"share_link"}'); // JSON serializado en backend
  });

  it('falta event → 400', () => {
    const appended = [];
    globalThis.openSpreadsheet_ = () => buildSsStub(appended);

    let thrown;
    try {
      REGISTRY.handlers.handleEvents({ ref: 'ORD-001' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus).toBe(400);
    expect(appended).toHaveLength(0);
  });

  it('event vacío → 400', () => {
    const appended = [];
    globalThis.openSpreadsheet_ = () => buildSsStub(appended);

    let thrown;
    try {
      REGISTRY.handlers.handleEvents({ event: '   ' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus).toBe(400);
  });

  it('event demasiado largo (> 64 chars) → 400', () => {
    const appended = [];
    globalThis.openSpreadsheet_ = () => buildSsStub(appended);

    let thrown;
    try {
      REGISTRY.handlers.handleEvents({ event: 'a'.repeat(65) });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus).toBe(400);
    expect(appended).toHaveLength(0);
  });

  it('meta se serializa a JSON: nunca escribe un objeto crudo', () => {
    const appended = [];
    globalThis.openSpreadsheet_ = () => buildSsStub(appended);

    REGISTRY.handlers.handleEvents({ event: 'test', meta: { a: 1, b: [2, 3] } });

    expect(typeof appended[0][4]).toBe('string');
    expect(JSON.parse(appended[0][4])).toEqual({ a: 1, b: [2, 3] });
  });

  it('meta muy largo → se trunca a 512 bytes sin lanzar error', () => {
    const appended = [];
    globalThis.openSpreadsheet_ = () => buildSsStub(appended);

    const longString = 'x'.repeat(600);
    REGISTRY.handlers.handleEvents({ event: 'test', meta: longString });

    expect(appended[0][4].length).toBeLessThanOrEqual(512);
  });

  it('ref y session_id opcionales: se escriben como vacíos si no vienen', () => {
    const appended = [];
    globalThis.openSpreadsheet_ = () => buildSsStub(appended);

    REGISTRY.handlers.handleEvents({ event: 'page_load' });

    expect(appended).toHaveLength(1);
    expect(appended[0][2]).toBe(''); // ref
    expect(appended[0][3]).toBe(''); // session_id
  });

  it('hoja _events inexistente → 503', () => {
    globalThis.openSpreadsheet_ = () => ({
      getSheetByName: () => null,
    });

    let thrown;
    try {
      REGISTRY.handlers.handleEvents({ event: 'test' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus).toBe(503);
  });
});
