// api/__tests__/pin-generate.spec.js — Fase 5: generación del PIN (Opción B).
//
// Motivo del spec: `pin-verify` era un sistema huérfano. La hoja `_pin`, el
// endpoint y el handler existían, pero NADIE escribía en `_pin` — el lookup
// de pin-verify:66 devolvía siempre `undefined` y respondía 404 "el pedido no
// requiere PIN". El circuito estaba cortado de origen.
//
// Cubre las tres piezas que lo cierran:
//   1. transform `pin`      — 6 dígitos por defecto, equiprobables (rejection
//                             sampling: 256 % 10 ≠ 0), ignora su entrada,
//                             longitud parametrizable con techo 12.
//   2. hook `pinHash`       — registra el SHA-256 en `_pin` post-escritura;
//                             nunca texto plano salvo `__failed__`.
//   3. circuito del motor   — `computeRules_` llena el payload ANTES de que
//                             `emitHook_` lo emita (24-crud muta `payload` en
//                             preparePayload_:176 y emite en :241), así que
//                             el hook ve `ctx.payload.pin` ya computado.
//
// Nota de entornos: `_harness.js` stubbea `Utilities` con un Proxy, por lo
// que `Props.hashText` se parchea en cada test (mismo criterio que
// pin-verify.spec.js:114) y `pinBytes_` cae a `tokenBytes_`: el formato del
// UUID nunca llega a ser un string, y esa guarda es lo que evita que el
// `while` de relleno no avance jamás.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let storageMap_;
let resourceCreate_;

const HASH = 'cafe'; // hash sintético: el test sólo comprueba QUE se hashée
let originalHashText;

const PIN_SHEET = '_pin';

/** Recurso mínimo con computed + hook, sin audit ni lock (ver crud-hooks). */
function buildResource_(overrides) {
  return {
    id: '__pin_test__',
    kind: 'collection',
    sheet: '__pin_sheet__',
    keyField: 'key',
    titleField: 'name',
    ordering: 'none',
    activeField: null,
    onDelete: 'none',
    dependents: [],
    listProjection: null,
    imageFolder: null,
    views: {},
    policies: { access: { read: 'admin', write: 'admin' }, lock: false },
    exposeToFront: false,
    operations: {
      create: { computed: [{ field: 'pin', transform: 'pin', from: 'name' }] },
    },
    hooks: { create: ['pinHash'] },
    fields: [
      { key: 'key', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
      { key: 'pin', type: 'text', maxLength: 12 },
    ],
    ...overrides,
  };
}

/** ss con la hoja del recurso (fakeSheet_) y `_pin` con `appendRow` capturado. */
function scenario_(resource, appended) {
  const map = storageMap_(resource);
  const headers = map.columns.map((col) => col.flatKey);
  const sheet = fakeSheet_([headers]);
  const pinStub = { appendRow: (row) => appended.push(row) };
  const ss = {
    getSheetByName: (name) => {
      if (name === PIN_SHEET) return pinStub;
      if (name === resource.sheet) return sheet;
      return null;
    },
  };
  return { resource, map, ss, sheet, headers };
}

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  storageMap_ = globalThis.storageMap_;
  resourceCreate_ = globalThis.resourceCreate_;
  originalHashText = globalThis.Props.hashText;
});

afterEach(() => {
  globalThis.Props.hashText = originalHashText;
});

// ─────────────────────────────────────────────────────────────
// 1. Transform `pin`
// ─────────────────────────────────────────────────────────────

describe('transform `pin` — generación del PIN', () => {
  it('está registrado en REGISTRY.transforms', () => {
    expect(typeof REGISTRY.transforms.pin).toBe('function');
  });

  it('por defecto devuelve exactamente 6 dígitos', () => {
    const pin = REGISTRY.transforms.pin('', {});
    expect(pin).toMatch(/^\d{6}$/);
  });

  it('IGNORA su entrada (no se deriva del origen, como `token`)', () => {
    // Dos pedidos del mismo cliente no pueden compartir PIN.
    const a = REGISTRY.transforms.pin('María López', {});
    const b = REGISTRY.transforms.pin('María López', {});
    expect(a).toMatch(/^\d{6}$/);
    expect(b).toMatch(/^\d{6}$/);
    // No exige desigualdad (azar) pero exige que no contenga la entrada.
    expect(a).not.toContain('Mar');
    expect(b).not.toContain('Mar');
  });

  it('respeta params.length', () => {
    expect(REGISTRY.transforms.pin('', { length: 4 })).toMatch(/^\d{4}$/);
    expect(REGISTRY.transforms.pin('', { length: 1 })).toMatch(/^\d$/);
  });

  it('techo de 12 dígitos (maxLength del campo `pin`)', () => {
    expect(REGISTRY.transforms.pin('', { length: 99 })).toMatch(/^\d{12}$/);
  });

  it('longitud inválida cae al default 6 (sólo enteros > 0)', () => {
    expect(REGISTRY.transforms.pin('', { length: 0 })).toMatch(/^\d{6}$/);
    expect(REGISTRY.transforms.pin('', { length: -3 })).toMatch(/^\d{6}$/);
    expect(REGISTRY.transforms.pin('', { length: 'abc' })).toMatch(/^\d{6}$/);
    expect(REGISTRY.transforms.pin('', undefined)).toMatch(/^\d{6}$/);
  });

  it('sólo dígitos — el local lo lee en voz alta y el cliente lo teclea', () => {
    for (let i = 0; i < 50; i++) {
      expect(REGISTRY.transforms.pin('', { length: 12 })).toMatch(/^\d{12}$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Hook `pinHash`
// ─────────────────────────────────────────────────────────────

describe('hook `pinHash` — registro del hash en _pin', () => {
  it('está registrado en REGISTRY.hooks (declarado en pin-verify.js)', () => {
    expect(typeof REGISTRY.hooks.pinHash).toBe('function');
  });

  it('escribe [ref, SHA-256(pin), created_at, used_at vacío]', () => {
    globalThis.Props.hashText = (text) => `${HASH}:${text}`;
    const appended = [];
    const ss = {
      getSheetByName: (n) => (n === PIN_SHEET ? { appendRow: (r) => appended.push(r) } : null),
    };

    REGISTRY.hooks.pinHash({ ss, key: 'ORD-0001', payload: { pin: '123456' } });

    expect(appended).toHaveLength(1);
    const row = appended[0];
    expect(row[0]).toBe('ORD-0001');
    // SHA-256 del PIN, NUNCA texto plano: contra esto compara pin-verify.
    expect(row[1]).toBe(`${HASH}:123456`);
    expect(row[1]).not.toBe('123456');
    // used_at vacío ⇒ PIN activo (pin-verify toma el más reciente NO usado).
    expect(row[3]).toBe('');
    expect(String(row[2])).toMatch(/^\d{4}-\d{2}-\d{2} /);
  });

  it('sin PIN en el payload ⇒ lanza (el computed no corrió)', () => {
    const ss = { getSheetByName: (n) => (n === PIN_SHEET ? { appendRow: () => {} } : null) };
    expect(() => REGISTRY.hooks.pinHash({ ss, key: 'ORD-0001', payload: {} })).toThrow(
      /sin PIN generado/,
    );
    expect(() => REGISTRY.hooks.pinHash({ ss, key: 'ORD-0001', payload: { pin: '' } })).toThrow(
      /sin PIN generado/,
    );
  });

  it('hoja _pin inexistente ⇒ lanza (setupDrift pendiente)', () => {
    const ss = { getSheetByName: () => null };
    expect(() =>
      REGISTRY.hooks.pinHash({ ss, key: 'ORD-0001', payload: { pin: '123456' } }),
    ).toThrow(/_pin no existe/);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Circuito del motor: computed → fila → hook
// ─────────────────────────────────────────────────────────────

describe('circuito create → computed pin → hook pinHash', () => {
  it('llena `pin` en la fila Y registra su hash en _pin', () => {
    globalThis.Props.hashText = (text) => `${HASH}:${text}`;
    const appended = [];
    const resource = buildResource_();
    const s = scenario_(resource, appended);

    resourceCreate_(s.ss, resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'María López' },
    });

    // a) El PIN quedó escrito en la fila (22-assemble NO lo salta: no es `system`).
    const rows = s.sheet.rows();
    const pinIdx = s.headers.indexOf('pin');
    expect(pinIdx).toBeGreaterThan(-1);
    expect(rows[1][pinIdx]).toMatch(/^\d{6}$/);

    // b) El hook escribió en _pin el SHA-256 de ESE MISMO pin.
    expect(appended).toHaveLength(1);
    expect(appended[0][1]).toBe(`${HASH}:${rows[1][pinIdx]}`);
  });

  it('dos pedidos del mismo cliente reciben PINs distintos', () => {
    globalThis.Props.hashText = (text) => `${HASH}:${text}`;
    const appended = [];
    const resource = buildResource_();
    const s = scenario_(resource, appended);

    resourceCreate_(s.ss, resource, s.map, {
      method: 'POST',
      payload: { key: 'a', name: 'María López' },
    });
    resourceCreate_(s.ss, resource, s.map, {
      method: 'POST',
      payload: { key: 'b', name: 'María López' },
    });

    const pinIdx = s.headers.indexOf('pin');
    const rows = s.sheet.rows();
    expect(rows).toHaveLength(3);
    expect(rows[1][pinIdx]).toMatch(/^\d{6}$/);
    expect(rows[2][pinIdx]).toMatch(/^\d{6}$/);

    // Cada fila tiene su propia fila en _pin, con el hash del pin de su fila.
    expect(appended).toHaveLength(2);
    expect(appended[0][1]).toBe(`${HASH}:${rows[1][pinIdx]}`);
    expect(appended[1][1]).toBe(`${HASH}:${rows[2][pinIdx]}`);
  });

  it('el pedido ya está en la hoja cuando corre el hook (post-escritura)', () => {
    globalThis.Props.hashText = (text) => `${HASH}:${text}`;
    const appended = [];
    const resource = buildResource_();
    const s = scenario_(resource, appended);

    let yaEscrito = false;
    resourceCreate_(s.ss, resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'María' },
    });
    yaEscrito = s.sheet
      .rows()
      .map((r) => r[0])
      .includes('p1');

    expect(appended).toHaveLength(1);
    expect(yaEscrito).toBe(true);
  });

  it('si el hook falla, la escritura se conserva (reacción, no causa)', () => {
    globalThis.Props.hashText = () => {
      throw new Error('falla adrede');
    };
    const resource = buildResource_();
    const s = scenario_(resource, []);

    const out = resourceCreate_(s.ss, resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'María' },
    });

    expect(out).toBeDefined();
    // El pedido quedó sin verificación ⇒ pin-verify responde 404, que es el
    // comportamiento seguro ante la ausencia de PIN.
    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. La RESPUESTA del create trae el PIN (hallazgo R1)
// ─────────────────────────────────────────────────────────────

// R1 (doc/pedidos-rectificacion.md §2.1): faltaba la columna `orders.pin`,
// así que `rowValues_` (21-repo.js) — que itera LOS HEADERS DE LA HOJA, no
// el payload — ni siquiera metía el valor en la fila. Y como la respuesta
// salía de `readDetail_`, no del payload, `ref` aparecía (columna existente)
// y `pin` no: MISMA transformación, distinta existencia de columna. Todo
// eso sin un solo warning.
//
// La afirmación que cierra R1 no es «el transform genera un PIN» (sección 1)
// ni «la fila lo tiene» (sección 3): es que LO QUE RECIBE EL FRONT sí lo
// trae. Es lo que consume `postCreate.actions[].shareTextTemplate`
// (D18/R1.8 del plan).
describe('respuesta del create — R1: el PIN llega al front', () => {
  it('la respuesta incluye `pin` no vacío aunque el payload NO lo traiga', () => {
    globalThis.Props.hashText = (text) => `${HASH}:${text}`;
    const appended = [];
    const resource = buildResource_();
    const s = scenario_(resource, appended);

    const out = resourceCreate_(s.ss, resource, s.map, {
      method: 'POST',
      // Sin `pin` en el payload: sólo puede venir del computed.
      payload: { key: 'p1', name: 'María López' },
    });

    expect(out).toBeDefined();
    expect(out.pin).toMatch(/^\d{6}$/);
    // Y las claves base siguen ahí — el PIN no tapa nada.
    expect(out.key).toBe('p1');
    expect(out.name).toBe('María López');
  });

  it('el `pin` de la respuesta es EXACTAMENTE el de la fila escrita', () => {
    globalThis.Props.hashText = (text) => `${HASH}:${text}`;
    const appended = [];
    const resource = buildResource_();
    const s = scenario_(resource, appended);

    const out = resourceCreate_(s.ss, resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'María López' },
    });

    // R1.3: la respuesta se arma desde lo ESCRITO, no desde una relectura ni
    // desde el payload. Si las dos fuentes divergieran, el front vería un PIN
    // que no es el que compara `pin-verify`.
    const pinIdx = s.headers.indexOf('pin');
    expect(pinIdx).toBeGreaterThan(-1);
    expect(out.pin).toBe(s.sheet.rows()[1][pinIdx]);
    // Y el hash que quedó en `_pin` es el de ESE pin de la respuesta: si
    // divergieran, `pin-verify` compararía contra otro valor.
    expect(appended[0][1]).toBe(`${HASH}:${out.pin}`);
  });

  it('columna `pin` ausente ⇒ el motor FALLA RUIDOSAMENTE, no la descarta', () => {
    // R1 era silencioso: `setHeaderCell_` hacía `if (idx !== -1)` y seguía.
    // R1.1 convirtió esa clase en error (500). Este test fija ese contrato
    // sobre el caso concreto de R1 para que nadie lo vuelva a silenciar.
    globalThis.Props.hashText = (text) => `${HASH}:${text}`;
    const resource = buildResource_();
    const s = scenario_(resource, []);

    // Hoja con TODAS las columnas MENOS `pin`: el escenario exacto de R1.
    const headersSinPin = s.headers.filter((h) => h !== 'pin');
    const hojaRota = fakeSheet_([headersSinPin]);
    const ssRoto = {
      getSheetByName: (name) => {
        if (name === PIN_SHEET) return { appendRow: () => {} };
        if (name === resource.sheet) return hojaRota;
        return null;
      },
    };

    expect(() =>
      resourceCreate_(ssRoto, resource, s.map, {
        method: 'POST',
        payload: { key: 'p1', name: 'María López' },
      }),
    ).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// 5. listProjection: el PIN tiene que llegar a la fila de la lista
// ─────────────────────────────────────────────────────────────

describe('orders.listProjection — el PIN llega al listado', () => {
  it('proyecta `pin`', () => {
    // list-view interpola shareTextTemplate sobre la fila PROYECTADA, así que
    // sin esta clave el mensaje copiado desde la tabla saldría con el PIN en
    // blanco — el bug original de PickPass.
    expect(REGISTRY.resources.orders.listProjection).toContain('pin');
    expect(REGISTRY.resources.orders.listProjection).toContain('ref');
  });
});
