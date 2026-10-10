// api/__tests__/list-pagination — R6.4: paginación de petición y el sobre
// estándar `{ items, nextCursor, total }` del listado.
//
// Lo que éste archivo cubre y ninguna otra parte cubre:
//
//  1. **El sobre es SIEMPRE el mismo.** `envelope: 'list'` responde
//     `{ items, nextCursor, total }` con y sin página pedida: una clave que
//     puede faltar obliga al consumidor a adivinar.
//  2. **`total` es el conjunto ANTES del corte** (los que coinciden con el
//     filtro/vista), no el largo de la página.
//  3. **Dos entradas, mutuamente excluyentes**: `page { size, offset }` para
//     la primera y `cursor` (el `nextCursor` devuelto) para seguir. Todo lo
//     que no cierra es **422 con `errors[]`**, con `path` relativo al
//     payload — igual que la validación de `input` del router.
//  4. **Lo que no se pagina responde 422 y no corta en silencio**: listado
//     sin `envelope: 'list'` (no hay dónde devolver el cursor) y vista
//     `aggregate` (devuelve UNA fila de resultado).
//
// Se entra por `dispatchResource_`, la puerta real: es la única forma de
// probar el orden validación ⇒ lectura ⇒ corte. La hoja es la fixture en
// memoria de `_sheets.js`.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let dispatchResource_;
let storageMap_;
let encodeCursor_;
let decodeCursor_;
let originalOpenSpreadsheet;
let seq = 0;

const SHEET = '__page_sheet__';

/** 5 filas: tres PEND y dos OK, para que el filtro de la vista se note. */
const GRID = [
  ['key', 'name', 'status', 'active'],
  ['r1', 'Uno', 'PEND', true],
  ['r2', 'Dos', 'PEND', true],
  ['r3', 'Tres', 'OK', true],
  ['r4', 'Cuatro', 'PEND', true],
  ['r5', 'Cinco', 'OK', true],
];

/**
 * Recurso de colección con `envelope: 'list'`. `extra` pisa lo que el caso
 * necesite probar en contra (otro `operations`, otras `views`, `listProjection`).
 */
function fixture_(extra = {}) {
  const id = '__page_' + ++seq;
  const resource = {
    id,
    kind: 'collection',
    sheet: SHEET,
    keyField: 'key',
    titleField: 'name',
    ordering: 'none',
    activeField: 'active',
    onDelete: 'none',
    dependents: [],
    listProjection: ['key', 'name'],
    imageFolder: null,
    views: {
      pendientes: {
        where: [{ field: 'status', op: 'eq', value: 'PEND' }],
        sort: [{ field: 'key', dir: 'asc' }],
      },
      cuantos: { aggregate: 'count' },
    },
    policies: { access: { read: 'admin', write: 'admin' }, lock: false },
    exposeToFront: false,
    operations: {
      list: { shape: { envelope: 'list', pick: ['key', 'name', 'status'] } },
      get: true,
    },
    fields: [
      { key: 'key', type: 'text', required: true, immutable: true },
      { key: 'name', type: 'text', required: true },
      { key: 'status', type: 'text', required: true },
      { key: 'active', type: 'boolean', required: true, default: true },
    ],
    ...extra,
  };
  REGISTRY.resources[id] = resource;
  const sheet = fakeSheet_(GRID);
  return { id, resource, map: storageMap_(resource), sheet, ss: fakeApp_({ [SHEET]: sheet }) };
}

/** El despacho real, con la hoja resuelta por la fixture. */
function call_(fixture, payload = {}) {
  globalThis.openSpreadsheet_ = () => fixture.ss;
  return dispatchResource_(fixture.resource, { method: 'GET', path: '/x', params: {}, payload });
}

/** Devuelve el error lanzado; si no lanza, devuelve null. */
function errorOf_(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}

/** El error 422 con `errors[]`; falla si no llegó. */
function expect422(fn) {
  const err = errorOf_(fn);
  expect(err, 'esperaba un 422').toBeDefined();
  expect(err.apiStatus).toBe(422);
  expect(err.apiErrors, 'el 422 lleva errors[]').toBeInstanceOf(Array);
  expect(err.apiErrors.length).toBeGreaterThan(0);
  return err;
}

beforeAll(() => {
  loadBackend();
  dispatchResource_ = globalThis.dispatchResource_;
  storageMap_ = globalThis.storageMap_;
  encodeCursor_ = globalThis.encodeCursor_;
  decodeCursor_ = globalThis.decodeCursor_;
});

beforeEach(() => {
  REGISTRY = globalThis.REGISTRY;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
});

afterEach(() => {
  globalThis.openSpreadsheet_ = originalOpenSpreadsheet;
  for (const id of Object.keys(REGISTRY.resources)) {
    if (id.startsWith('__page_')) delete REGISTRY.resources[id];
  }
});

// ── 1. El sobre estándar ───────────────────────────────────────────────────

describe('R6.4 · sobre estándar { items, nextCursor, total }', () => {
  it('sin página pedida el sobre es el mismo: nextCursor null y total = items', () => {
    const out = call_(fixture_());
    expect(Object.keys(out).sort()).toEqual(['items', 'nextCursor', 'total']);
    expect(out.items).toHaveLength(5);
    expect(out.nextCursor).toBeNull();
    expect(out.total).toBe(5);
  });

  it('`page` corta, devuelve nextCursor y `total` sigue midiendo el conjunto entero', () => {
    const out = call_(fixture_(), { page: { size: 2 } });
    expect(out.items.map((i) => i.key)).toEqual(['r1', 'r2']);
    expect(out.total).toBe(5); // no 2: total es antes del corte
    expect(typeof out.nextCursor).toBe('string');
    expect(out.nextCursor).not.toBe('');
  });

  it('`offset` corre la página sin cambiar el total', () => {
    const out = call_(fixture_(), { page: { size: 2, offset: 2 } });
    expect(out.items.map((i) => i.key)).toEqual(['r3', 'r4']);
    expect(out.total).toBe(5);
  });

  it('la continuación por `cursor` sigue exactamente donde quedó la anterior', () => {
    const fixture = fixture_();
    const primera = call_(fixture, { page: { size: 2 } });
    const segunda = call_(fixture, { cursor: primera.nextCursor });
    expect(segunda.items.map((i) => i.key)).toEqual(['r3', 'r4']);
    expect(segunda.total).toBe(5);

    const tercera = call_(fixture, { cursor: segunda.nextCursor });
    expect(tercera.items.map((i) => i.key)).toEqual(['r5']);
    expect(tercera.nextCursor).toBeNull(); // última página: no hay más
  });

  it('una página más allá del final queda vacía y sin cursor (no inventa filas)', () => {
    const out = call_(fixture_(), { page: { size: 2, offset: 10 } });
    expect(out.items).toEqual([]);
    expect(out.total).toBe(5);
    expect(out.nextCursor).toBeNull();
  });

  it('pagina el conjunto YA filtrado por la vista: `total` es lo que filtra', () => {
    const out = call_(fixture_(), { view: 'pendientes', page: { size: 2 } });
    expect(out.items.map((i) => i.key)).toEqual(['r1', 'r2']);
    expect(out.total).toBe(3); // las tres PEND, no las cinco de la hoja

    const fin = call_(fixture_(), { view: 'pendientes', cursor: out.nextCursor });
    expect(fin.items.map((i) => i.key)).toEqual(['r4']);
    expect(fin.nextCursor).toBeNull();
  });

  it('también pagina sobre un `filter` (where de la vista, sin sort)', () => {
    const out = call_(fixture_(), { filter: 'pendientes', page: { size: 1, offset: 1 } });
    expect(out.items.map((i) => i.key)).toEqual(['r2']);
    expect(out.total).toBe(3);
  });

  it('el cursor devuelve el MISMO tamaño de página con el que se emitió', () => {
    const fixture = fixture_();
    const primera = call_(fixture, { page: { size: 3 } });
    const segunda = call_(fixture, { cursor: primera.nextCursor });
    expect(segunda.items).toHaveLength(2); // 5 − 3: el cursor no pide page otra vez
    expect(segunda.total).toBe(5);
  });
});

// ── 2. Entradas que no cierran (422, no 500) ───────────────────────────────

describe('R6.4 · entradas de paginación inválidas (422)', () => {
  it('`page` y `cursor` a la vez es ambiguo ⇒ 422', () => {
    const fixture = fixture_();
    const cursor = call_(fixture, { page: { size: 2 } }).nextCursor;
    const err = expect422(() => call_(fixture, { page: { size: 2 }, cursor }));
    expect(err.apiErrors[0].path).toBe('page');
    expect(err.apiErrors[0].code).toBe('VALIDATION_PAGINATION');
  });

  it('`size` sin entero ≥ 1 ⇒ 422 con path page.size', () => {
    for (const size of [0, -1, 2.5, '2', null, undefined]) {
      const err = expect422(() => call_(fixture_(), { page: { size } }));
      expect(err.apiErrors.some((e) => e.path === 'page.size')).toBe(true);
    }
  });

  it('`offset` sin entero ≥ 0 ⇒ 422 con path page.offset', () => {
    for (const offset of [-1, 1.5, '1']) {
      const err = expect422(() => call_(fixture_(), { page: { size: 2, offset } }));
      expect(err.apiErrors.some((e) => e.path === 'page.offset')).toBe(true);
    }
  });

  it('una clave fuera de { size, offset } se RECHAZA, no se ignora', () => {
    const err = expect422(() => call_(fixture_(), { page: { size: 2, ofset: 3 } }));
    expect(err.apiErrors[0].path).toBe('page.ofset');
  });

  it('`page` que no es objeto ⇒ 422', () => {
    for (const page of [5, 'x', true, [2]]) {
      const err = expect422(() => call_(fixture_(), { page }));
      expect(err.apiErrors[0].path).toBe('page');
    }
  });

  it('cursor vacío, no-string o corrupto ⇒ 422 con path cursor', () => {
    const fixture = fixture_();
    for (const cursor of ['', 'no-es-base64!', 'eyJmb28iOjF9']) {
      const err = expect422(() => call_(fixture, { cursor }));
      expect(err.apiErrors[0].path).toBe('cursor');
      expect(err.apiErrors[0].code).toBe('VALIDATION_CURSOR');
    }
  });

  it('cursor de otra versión ⇒ 422 (el formato puede evolucionar sin adivinar)', () => {
    const fixture = fixture_();
    const viejo = Buffer.from(JSON.stringify({ v: 0, o: 2, s: 2 })).toString('base64url');
    const err = expect422(() => call_(fixture, { cursor: viejo }));
    expect(err.apiErrors[0].message).toContain('Versión de cursor no soportada');
  });

  it('cursor con `size` o `offset` malos dentro ⇒ 422 (fabricado a mano)', () => {
    const fixture = fixture_();
    const malOffset = Buffer.from(JSON.stringify({ v: 1, o: -3, s: 2 })).toString('base64url');
    expect(expect422(() => call_(fixture, { cursor: malOffset })).apiErrors).toHaveLength(1);
    const malSize = Buffer.from(JSON.stringify({ v: 1, o: 0, s: 0 })).toString('base64url');
    expect(expect422(() => call_(fixture, { cursor: malSize })).apiErrors[0].path).toBe('cursor');
  });

  it('los problemas se ACUMULAN en un solo 422', () => {
    const err = expect422(() => call_(fixture_(), { page: { size: 0, ofset: 1, offset: -1 } }));
    expect(err.apiErrors.length).toBeGreaterThanOrEqual(3);
  });
});

// ── 3. Lo que no se pagina ─────────────────────────────────────────────────

describe('R6.4 · sin sobre no hay cursor: 422 accionable', () => {
  it('listado sin `envelope: "list"` ⇒ 422 que nombra la declaración que falta', () => {
    const fixture = fixture_({ operations: { list: true, get: true } });
    const err = expect422(() => call_(fixture, { page: { size: 2 } }));
    expect(err.apiErrors[0].message).toContain('shape.envelope');
    expect(err.apiErrors[0].code).toBe('VALIDATION_PAGINATION');
  });

  it('ese mismo listado SIN página sigue respondiendo arreglo plano (regresión)', () => {
    const fixture = fixture_({ operations: { list: true, get: true } });
    const out = call_(fixture);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(5);
  });

  it('vista `aggregate` ⇒ 422: un agregado es UNA fila, no una lista', () => {
    const err = expect422(() => call_(fixture_(), { view: 'cuantos', page: { size: 1 } }));
    expect(err.apiErrors[0].message).toContain('agregado');
  });

  it('esa misma vista aggregate SIN página no tira 422 (sólo la paginación está prohibida)', () => {
    // Comportamiento previo a R6.4, acá para fijarlo: el sobre de listado
    // envuelve CUALQUIER arreglo, incluida la fila única del agregado. R6.4
    // no lo toca — sólo rechaza pedirle una página a eso.
    const out = call_(fixture_(), { view: 'cuantos' });
    expect(out.items).toEqual([{ value: 5 }]);
    expect(out.nextCursor).toBeNull();
  });
});

// ── 4. El cursor como caja negra ───────────────────────────────────────────

describe('R6.4 · cursor opaco', () => {
  it('codifica y decodifica con la misma clave que emite el back', () => {
    const cursor = encodeCursor_(4, 2);
    expect(typeof cursor).toBe('string');
    expect(cursor).not.toContain('=');
    expect(cursor).not.toContain('+');
    expect(cursor).not.toContain('/');
    expect(decodeCursor_(cursor)).toEqual({ v: 1, o: 4, s: 2 });
  });

  it('decodificar basura devuelve null (el caller lo traduce a 422)', () => {
    expect(decodeCursor_('@@@')).toBeNull();
    expect(decodeCursor_(Buffer.from('[1,2]').toString('base64url'))).toBeNull();
    expect(decodeCursor_(Buffer.from('"texto"').toString('base64url'))).toBeNull();
    expect(decodeCursor_(Buffer.from('null').toString('base64url'))).toBeNull();
  });
});
