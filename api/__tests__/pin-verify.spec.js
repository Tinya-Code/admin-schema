// api/__tests__/pin-verify.spec.js — Handler handlePinVerify (Fase 5).
//
// Verifica:
//   1. Declaración del endpoint pinVerify con access: 'public' y method: 'POST'.
//   2. Handler registrado en REGISTRY.handlers.handlePinVerify.
//   3. PIN correcto → 200 { ok: true, ref }.
//   4. PIN incorrecto → 401 (y registra fila __failed__ en _pin).
//   5. Intentos agotados (≥ PIN_MAX_ATTEMPTS_ filas __failed__ DENTRO de la
//      ventana de 60 s) → 429 · los caídos fuera de la ventana no bloquean.
//   6. PIN ya utilizado (used_at presente) → 409.
//   7. Sin PIN configurado para el ref → 404.
//   8. Falta ref → 400. Falta pin → 400.
//   9. Hoja _pin inexistente → 503.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let REGISTRY;
let originalOpenSpreadsheet;
let originalReadSheetData;

// PIN de prueba y su SHA-256 pre-calculado.
// SHA-256('1234') = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
const TEST_PIN = '1234';
const TEST_PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';

const HEADERS = ['ref', 'pin_hash', 'created_at', 'used_at'];

// Fila activa (sin used_at) para el ref de prueba.
function makeActiveRow(ref, hash, at) {
  return {
    at: 2,
    values: [ref, hash || TEST_PIN_HASH, at || '2026-10-05 10:00:00', ''],
  };
}

// Fila de intento fallido.
function makeFailedRow(ref, at) {
  return {
    at: 3,
    values: [ref, '__failed__', at || '2026-10-05 10:01:00', '2026-10-05 10:01:00'],
  };
}

// Fila ya usada.
function makeUsedRow(ref, hash) {
  return {
    at: 2,
    values: [ref, hash || TEST_PIN_HASH, '2026-10-05 10:00:00', '2026-10-05 10:05:00'],
  };
}

/** Sello 'YYYY-MM-DD HH:mm:ss' local, `seconds` hacia atrás. */
function stampAgo(seconds) {
  const d = new Date(Date.now() - seconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Construye el stub de ss con una hoja _pin mutable. */
function buildSsStub(rows, appendedRows) {
  const sheetStub = {
    appendRow: (row) => appendedRows && appendedRows.push(row),
    getRange: (_row, _col) => ({
      setValue: () => {},
    }),
  };
  return {
    getSheetByName: (name) => (name === '_pin' ? sheetStub : null),
  };
}

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
  originalReadSheetData = globalThis.readSheetData_;
});

afterEach(() => {
  globalThis.openSpreadsheet_ = originalOpenSpreadsheet;
  globalThis.readSheetData_ = originalReadSheetData;
});

describe('Fase 5 — Verificación de PIN (POST /p/orders/:ref/pin)', () => {
  it('REGISTRY declara el endpoint pinVerify con access: public, method: POST y limits', () => {
    const ep = REGISTRY.endpoints.pinVerify;
    expect(ep).toBeDefined();
    expect(ep.route).toBe('/p/orders/:ref/pin');
    expect(ep.method).toBe('POST');
    expect(ep.access).toBe('public');
    expect(ep.limits).toBe('5/min');
    expect(ep.handler).toBe('handlePinVerify');
  });

  it('REGISTRY expone el handler handlePinVerify', () => {
    expect(typeof REGISTRY.handlers.handlePinVerify).toBe('function');
  });

  it('PIN correcto → { ok: true, ref }', () => {
    const appended = [];
    const ssStub = buildSsStub(null, appended);

    globalThis.openSpreadsheet_ = () => ssStub;
    globalThis.readSheetData_ = (_ss, name) => {
      if (name !== '_pin') throw new Error('hoja inesperada: ' + name);
      return { headers: HEADERS, rows: [makeActiveRow('ORD-001')] };
    };

    // Props.hashText debe devolver el hash real para que la comparación funcione.
    // En el harness, Utilities es un stub inerte — parcheamos Props.hashText.
    const origHash = globalThis.Props.hashText;
    globalThis.Props.hashText = () => TEST_PIN_HASH;

    const result = REGISTRY.handlers.handlePinVerify(
      { pin: TEST_PIN },
      { params: { ref: 'ORD-001' } },
    );

    globalThis.Props.hashText = origHash;

    expect(result.ok).toBe(true);
    expect(result.ref).toBe('ORD-001');
    // No debe haber registrado ningún intento fallido.
    expect(appended).toHaveLength(0);
  });

  it('PIN incorrecto → 401 y registra fila __failed__', () => {
    const appended = [];
    const ssStub = buildSsStub(null, appended);

    globalThis.openSpreadsheet_ = () => ssStub;
    globalThis.readSheetData_ = (_ss, _name) => ({
      headers: HEADERS,
      rows: [makeActiveRow('ORD-002')],
    });

    const origHash = globalThis.Props.hashText;
    globalThis.Props.hashText = () => 'hash-incorrecto';

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: '9999' }, { params: { ref: 'ORD-002' } });
    } catch (e) {
      thrown = e;
    } finally {
      globalThis.Props.hashText = origHash;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(401);
    // Debe haber registrado el intento fallido.
    expect(appended).toHaveLength(1);
    expect(appended[0][1]).toBe('__failed__');
  });

  it('intentos agotados (≥ 5 filas __failed__) → 429', () => {
    const appended = [];
    const ssStub = buildSsStub(null, appended);

    globalThis.openSpreadsheet_ = () => ssStub;

    const failedRows = Array.from({ length: 5 }, (_, i) => makeFailedRow('ORD-003', stampAgo(i)));
    globalThis.readSheetData_ = (_ss, _name) => ({
      headers: HEADERS,
      rows: [makeActiveRow('ORD-003'), ...failedRows],
    });

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: '0000' }, { params: { ref: 'ORD-003' } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(429);
  });

  it('los intentos fallidos fuera de la ventana NO bloquean (401, no 429)', () => {
    // 5 fallos, pero de hace media hora: pasó la ventana de `limits: '5/min'`
    // y el pedido vuelve a aceptar intentos sin tocar `_pin` a mano.
    const appended = [];
    const ssStub = buildSsStub(null, appended);

    globalThis.openSpreadsheet_ = () => ssStub;

    const staleRows = Array.from({ length: 5 }, (_, i) =>
      makeFailedRow('ORD-004', stampAgo(1800 + i)),
    );
    globalThis.readSheetData_ = (_ss, _name) => ({
      headers: HEADERS,
      rows: [makeActiveRow('ORD-004'), ...staleRows],
    });

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: '9999' }, { params: { ref: 'ORD-004' } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(401);
    // El intento nuevo sí quedó registrado.
    expect(appended.length).toBe(1);
    expect(appended[0][1]).toBe('__failed__');
  });

  it('PIN ya utilizado → 409', () => {
    const ssStub = buildSsStub(null, []);

    globalThis.openSpreadsheet_ = () => ssStub;
    globalThis.readSheetData_ = (_ss, _name) => ({
      headers: HEADERS,
      rows: [makeUsedRow('ORD-004')],
    });

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: TEST_PIN }, { params: { ref: 'ORD-004' } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(409);
  });

  it('sin PIN configurado para el ref → 404', () => {
    const ssStub = buildSsStub(null, []);

    globalThis.openSpreadsheet_ = () => ssStub;
    // La hoja existe pero no tiene filas para este ref.
    globalThis.readSheetData_ = (_ss, _name) => ({
      headers: HEADERS,
      rows: [makeActiveRow('ORD-OTRO')],
    });

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: '1234' }, { params: { ref: 'ORD-SIN-PIN' } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(404);
  });

  it('falta ref → 400', () => {
    expect(() => REGISTRY.handlers.handlePinVerify({ pin: '1234' }, { params: {} })).toThrowError(
      /referencia/i,
    );
  });

  it('falta pin → 400', () => {
    const ssStub = buildSsStub(null, []);
    globalThis.openSpreadsheet_ = () => ssStub;
    globalThis.readSheetData_ = (_ss, _name) => ({ headers: HEADERS, rows: [] });

    expect(() =>
      REGISTRY.handlers.handlePinVerify({}, { params: { ref: 'ORD-001' } }),
    ).toThrowError(/pin/i);
  });

  it('hoja _pin inexistente → 503', () => {
    globalThis.openSpreadsheet_ = () => ({
      getSheetByName: () => null,
    });

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: '1234' }, { params: { ref: 'ORD-001' } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(503);
  });
});
