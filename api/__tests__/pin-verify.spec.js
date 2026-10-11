// api/__tests__/pin-verify.spec.js — Handler handlePinVerify (Fase 5 · R8.9).
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
//  10. R8.9 (D12): pedido ENTREGADO/CANCELADO → 403 (ya no admite retiro).
//  11. R8.9: filas en _pin sin pedido (inconsistencia) → 404 defensivo.
//  12. R8.9: PIN vencido (created_at + pin_ttl_hours default 24) → 410.
//  13. R8.9: pin_enabled = NO en pickpass_config → 404 (contrato sin cambio).
//  14. R8.9: pin_ttl_hours configurable desde pickpass_config (1 h vence → 410).
//
// Los stubs de readSheetData_ sirven las TRES hojas que el handler lee
// (_pin, orders vía endpointDecl.resource, y pickpass_config cuando la
// hoja existe): el handler de R8.9 resuelve el pedido real, no puede
// quedarse sólo con _pin.

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
const ORDER_HEADERS = ['ref', 'status'];
const CONFIG_HEADERS = ['key', 'value', 'type', 'note'];

/** Sello 'YYYY-MM-DD HH:mm:ss' local, `seconds` hacia atrás. */
function stampAgo(seconds) {
  const d = new Date(Date.now() - seconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// Fila activa (sin used_at) para el ref de prueba. `at` default: hace 1 min
// — DENTRO del TTL default de 24 h de R8.9 (el sello fijo anterior estaba
// vencido y reventaba el happy-path con 410).
function makeActiveRow(ref, hash, at) {
  return {
    at: 2,
    values: [ref, hash || TEST_PIN_HASH, at || stampAgo(60), ''],
  };
}

// Fila de intento fallido.
function makeFailedRow(ref, at) {
  return {
    at: 3,
    values: [ref, '__failed__', at || stampAgo(60), at || stampAgo(60)],
  };
}

// Fila ya usada.
function makeUsedRow(ref, hash) {
  return {
    at: 2,
    values: [ref, hash || TEST_PIN_HASH, stampAgo(300), stampAgo(60)],
  };
}

// Fila del pedido (hoja orders): status PENDIENTE salvo que se pida otro.
function makeOrderRow(ref, status) {
  return { at: 2, values: [ref, status || 'PENDIENTE'] };
}

// Fila de pickpass_config (KV).
function makeConfigRow(key, value) {
  return { at: 2, values: [key, value, 'select', ''] };
}

/** Construye el stub de ss con una hoja _pin mutable + hojas extra. */
function buildSsStub(rows, appendedRows, extraSheets) {
  const sheetStub = {
    appendRow: (row) => appendedRows && appendedRows.push(row),
    getRange: (_row, _col) => ({
      setValue: () => {},
    }),
  };
  return {
    getSheetByName: (name) => {
      if (name === '_pin') return sheetStub;
      if (extraSheets && name in extraSheets) return extraSheets[name];
      return null;
    },
  };
}

/**
 * Stub completo de las hojas que lee handlePinVerify: `_pin`, `orders` y
 * (sólo si hay configRows) `pickpass_config`. Devuelve el array `appended`
 * para inspeccionar appendRow.
 */
function stubSheets({ pinRows = [], orders = [], configRows = null, appended = [] } = {}) {
  globalThis.readSheetData_ = (_ss, name) => {
    if (name === '_pin') return { headers: HEADERS, rows: pinRows };
    if (name === 'orders') return { headers: ORDER_HEADERS, rows: orders };
    if (name === 'pickpass_config') return { headers: CONFIG_HEADERS, rows: configRows || [] };
    throw new Error('hoja inesperada: ' + name);
  };
  const extra = configRows ? { pickpass_config: {} } : undefined;
  globalThis.openSpreadsheet_ = () => buildSsStub(null, appended, extra);
  return appended;
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

describe('Fase 5 — Verificación de PIN (POST /p/pin/:ref)', () => {
  it('REGISTRY declara el endpoint pinVerify con access: public, method: POST y limits', () => {
    const ep = REGISTRY.endpoints.pinVerify;
    expect(ep).toBeDefined();
    expect(ep.route).toBe('/p/pin/:ref');
    expect(ep.method).toBe('POST');
    expect(ep.access).toBe('public');
    expect(ep.limits).toBe('5/min');
    expect(ep.handler).toBe('handlePinVerify');
  });

  it('REGISTRY expone el handler handlePinVerify', () => {
    expect(typeof REGISTRY.handlers.handlePinVerify).toBe('function');
  });

  it('PIN correcto → { ok: true, ref }', () => {
    const appended = stubSheets({
      pinRows: [makeActiveRow('ORD-001')],
      orders: [makeOrderRow('ORD-001')],
      appended: [],
    });

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

  it('PIN creado hace un minuto y leído desde Sheets como Date sigue vigente', () => {
    const createdAt = new Date(Date.now() - 60 * 1000);
    stubSheets({
      pinRows: [makeActiveRow('ORD-DATE', TEST_PIN_HASH, createdAt)],
      orders: [makeOrderRow('ORD-DATE')],
    });

    const origHash = globalThis.Props.hashText;
    globalThis.Props.hashText = () => TEST_PIN_HASH;

    let result;
    try {
      result = REGISTRY.handlers.handlePinVerify(
        { pin: TEST_PIN },
        { params: { ref: 'ORD-DATE' } },
      );
    } finally {
      globalThis.Props.hashText = origHash;
    }

    expect(result).toEqual({ ok: true, ref: 'ORD-DATE' });
  });

  it('PIN incorrecto → 401 y registra fila __failed__', () => {
    const appended = stubSheets({
      pinRows: [makeActiveRow('ORD-002')],
      orders: [makeOrderRow('ORD-002')],
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
    const failedRows = Array.from({ length: 5 }, (_, i) => makeFailedRow('ORD-003', stampAgo(i)));
    stubSheets({
      pinRows: [makeActiveRow('ORD-003'), ...failedRows],
      orders: [makeOrderRow('ORD-003')],
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
    const staleRows = Array.from({ length: 5 }, (_, i) =>
      makeFailedRow('ORD-004', stampAgo(1800 + i)),
    );
    const appended = stubSheets({
      pinRows: [makeActiveRow('ORD-004'), ...staleRows],
      orders: [makeOrderRow('ORD-004')],
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
    stubSheets({
      pinRows: [makeUsedRow('ORD-004')],
      orders: [makeOrderRow('ORD-004')],
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
    stubSheets({
      pinRows: [makeActiveRow('ORD-OTRO')],
      orders: [],
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
    stubSheets({ pinRows: [], orders: [] });

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

describe('R8.9 — Estado del pedido (403) y defensa de consistencia', () => {
  it('pedido ENTREGADO → 403 (ya no admite retiro)', () => {
    stubSheets({
      pinRows: [makeActiveRow('ORD-010')],
      orders: [makeOrderRow('ORD-010', 'ENTREGADO')],
    });

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: TEST_PIN }, { params: { ref: 'ORD-010' } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(403);
    expect(thrown.message).toMatch(/retiro/i);
  });

  it('pedido CANCELADO → 403', () => {
    stubSheets({
      pinRows: [makeActiveRow('ORD-011')],
      orders: [makeOrderRow('ORD-011', 'CANCELADO')],
    });

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: TEST_PIN }, { params: { ref: 'ORD-011' } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(403);
  });

  it('filas en _pin sin pedido correspondiente → 404 defensivo', () => {
    // Consistencia: si el pedido no existe, el PIN no verifica nada.
    stubSheets({
      pinRows: [makeActiveRow('ORD-FANTASMA')],
      orders: [],
    });

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: TEST_PIN }, { params: { ref: 'ORD-FANTASMA' } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(404);
  });
});

describe('R8.9 — TTL de vigencia del PIN (410)', () => {
  it('PIN creado hace más de 24 h (default) → 410', () => {
    stubSheets({
      pinRows: [makeActiveRow('ORD-020', TEST_PIN_HASH, stampAgo(25 * 3600))],
      orders: [makeOrderRow('ORD-020')],
    });

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: TEST_PIN }, { params: { ref: 'ORD-020' } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(410);
    expect(thrown.message).toMatch(/expir/i);
  });

  it('PIN creado hace 2 h con TTL default 24 h → sigue vigente (401 por hash, no 410)', () => {
    // Control: el TTL NO expira un PIN dentro de ventana — sólo lo hace el
    // hash incorrecto. Sin este test, un off-by-one de unidad pasaría callado.
    stubSheets({
      pinRows: [makeActiveRow('ORD-021', TEST_PIN_HASH, stampAgo(2 * 3600))],
      orders: [makeOrderRow('ORD-021')],
    });

    const origHash = globalThis.Props.hashText;
    globalThis.Props.hashText = () => 'hash-incorrecto';

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: '9999' }, { params: { ref: 'ORD-021' } });
    } catch (e) {
      thrown = e;
    } finally {
      globalThis.Props.hashText = origHash;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(401);
  });

  it('sello created_at ilegible → 410 (fail-closed, no regala vigencia)', () => {
    stubSheets({
      pinRows: [makeActiveRow('ORD-022', TEST_PIN_HASH, 'no-es-fecha')],
      orders: [makeOrderRow('ORD-022')],
    });

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: TEST_PIN }, { params: { ref: 'ORD-022' } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(410);
  });

  it('pin_ttl_hours = 1 en pickpass_config acorta la vigencia (2 h → 410)', () => {
    // Prueba de que el valor del KV se CONSUME: sin la config, 2 h estaría
    // vigente (test anterior); con TTL 1 h, vence.
    stubSheets({
      pinRows: [makeActiveRow('ORD-023', TEST_PIN_HASH, stampAgo(2 * 3600))],
      orders: [makeOrderRow('ORD-023')],
      configRows: [makeConfigRow('pin_ttl_hours', '1')],
    });

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: TEST_PIN }, { params: { ref: 'ORD-023' } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(410);
  });
});

describe('R8.9 — pin_enabled en pickpass_config (D12)', () => {
  it('pin_enabled = NO → 404 (mismo contrato que «sin PIN»)', () => {
    stubSheets({
      pinRows: [makeActiveRow('ORD-030')],
      orders: [makeOrderRow('ORD-030')],
      configRows: [makeConfigRow('pin_enabled', 'NO')],
    });

    let thrown;
    try {
      REGISTRY.handlers.handlePinVerify({ pin: TEST_PIN }, { params: { ref: 'ORD-030' } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown.apiStatus ?? thrown.status ?? thrown.code).toBe(404);
    expect(thrown.message).toMatch(/no hay pin/i);
  });

  it('pin_enabled = SI → verifica con normalidad (200)', () => {
    stubSheets({
      pinRows: [makeActiveRow('ORD-031')],
      orders: [makeOrderRow('ORD-031')],
      configRows: [makeConfigRow('pin_enabled', 'SI'), makeConfigRow('pin_ttl_hours', '24')],
    });

    const origHash = globalThis.Props.hashText;
    globalThis.Props.hashText = () => TEST_PIN_HASH;

    const result = REGISTRY.handlers.handlePinVerify(
      { pin: TEST_PIN },
      { params: { ref: 'ORD-031' } },
    );

    globalThis.Props.hashText = origHash;

    expect(result.ok).toBe(true);
    expect(result.ref).toBe('ORD-031');
  });
});
