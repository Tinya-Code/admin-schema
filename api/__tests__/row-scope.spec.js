// api/__tests__/row-scope — B8 · R7.4c: scope POR FILA.
//
//   policies.access.scope = { '<nivel>': [where] }   (niveles de §4.4)
//
// Qué filas ve cada rol, con la MISMA gramática where de las vistas. Sin
// declaración ⇒ sin filtro; con declaración, la fila necesita la entrada
// MÁS ESPECÍFICA que la identidad satisfaga (admin > staff > session >
// public) y debe pasar su where. Sin entrada ⇒ la fila NO pasa (fail-closed).
//
// Este spec entra por `dispatchResource_` — la puerta real — y prueba:
//
//  1. el listado filtra por la entrada del rol (admin ve todo, staff lo
//     suyo) y la cachea base no se envenena entre roles;
//  2. la entrada más específica manda (admin no cae en la de staff);
//  3. fail-closed: rol sin entrada ⇒ vacío; sin identidad ⇒ vacío;
//     entrada 'session' deja pasar a cualquier activo;
//  4. fila con clave fuera de scope ⇒ 404 honesto en get, update y remove
//     (no existe para esa identidad, sin oráculo de existencia);
//  5. condición anclada en `$item.<campo>` resuelve contra la propia fila
//     (ctx.self por ítem);
//  6. recurso sin scope declarado ⇒ comportamiento intacto (control).
//
// La coherencia de la DECLARACIÓN la juzga validate-registry (describe 8).

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

const ADMIN = { id: 'u_1', email: 'ana@x.com', role: 'admin', active: true };
const STAFF = { id: 'u_2', email: 'bob@x.com', role: 'staff', active: true };
const SIN_ROL = { id: 'u_3', email: 'caro@x.com', role: '', active: true };

const SHEET = '__rs_sheet__';
const GRID = [
  ['key', 'name', 'owner', 'active'],
  ['r1', 'Uno', 'bob', true],
  ['r2', 'Dos', 'ana', true],
  ['r3', 'Tres', 'bob', true],
];

let REGISTRY;
let dispatchResource_;
let seq = 0;
let originalOpenSpreadsheet;
let originalCacheService;

/** Colección con scope: admin ve todo, staff sólo lo de `owner: bob`. */
function fixture_(extra = {}) {
  const id = '__rs_' + ++seq;
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
    listProjection: ['key', 'name', 'owner'],
    imageFolder: null,
    views: {},
    policies: {
      access: {
        read: 'session',
        write: 'admin',
        scope: {
          'role:admin': [],
          'role:staff': [{ field: 'owner', op: 'eq', value: 'bob' }],
        },
      },
      lock: false,
    },
    exposeToFront: false,
    operations: { list: true, get: true, create: true, update: true, remove: true },
    fields: [
      { key: 'key', type: 'text', required: true, immutable: true },
      { key: 'name', type: 'text', required: true },
      { key: 'owner', type: 'text' },
      { key: 'active', type: 'boolean', required: true, default: true },
    ],
    ...extra,
  };
  REGISTRY.resources[id] = resource;
  const sheet = fakeSheet_(GRID);
  return { id, resource, ss: fakeApp_({ [SHEET]: sheet }) };
}

function call_(fixture, { method = 'GET', params = {}, payload = {}, user } = {}) {
  globalThis.openSpreadsheet_ = () => fixture.ss;
  return dispatchResource_(fixture.resource, { method, path: '/x', params, payload, user });
}

function errorOf_(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}

function expectStatus_(fn, status) {
  const err = errorOf_(fn);
  expect(err, `esperaba un ${status}`).toBeDefined();
  expect(err.apiStatus).toBe(status);
  return err;
}

beforeAll(() => {
  loadBackend();
  dispatchResource_ = globalThis.dispatchResource_;
});

beforeEach(() => {
  REGISTRY = globalThis.REGISTRY;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
  originalCacheService = globalThis.CacheService;
  // Cache REAL (Map): el filtro de scope corre sobre la base cacheada y
  // debe devolver SIEMPRE la vista del rol actual.
  const cache = new Map();
  globalThis.CacheService = {
    getScriptCache: () => ({
      get: (k) => (cache.has(k) ? cache.get(k) : null),
      put: (k, v) => cache.set(k, v),
      remove: (k) => cache.delete(k),
    }),
  };
});

afterEach(() => {
  globalThis.openSpreadsheet_ = originalOpenSpreadsheet;
  globalThis.CacheService = originalCacheService;
  for (const id of Object.keys(REGISTRY.resources)) {
    if (id.startsWith('__rs_')) delete REGISTRY.resources[id];
  }
});

describe('B8 · R7.4c — el listado filtra por el scope del rol', () => {
  it('admin ve todo (entrada role:admin con where vacío) y staff sólo lo suyo', () => {
    const f = fixture_();
    expect(call_(f, { user: ADMIN }).map((i) => i.key)).toEqual(['r1', 'r2', 'r3']);
    expect(call_(f, { user: STAFF }).map((i) => i.key)).toEqual(['r1', 'r3']);
  });

  it('la base cacheada no se envenena entre roles', () => {
    const f = fixture_();
    expect(call_(f, { user: ADMIN }).length).toBe(3);
    expect(call_(f, { user: STAFF }).length).toBe(2);
    expect(call_(f, { user: ADMIN }).length).toBe(3);
  });

  it('fail-closed: rol sin entrada y sin identidad ven vacío', () => {
    const f = fixture_();
    expect(call_(f, { user: SIN_ROL })).toEqual([]);
    expect(call_(f, { user: null })).toEqual([]);
  });

  it("entrada 'session' deja pasar a cualquier autenticado activo", () => {
    const f = fixture_({
      policies: {
        access: {
          read: 'session',
          write: 'admin',
          scope: { session: [{ field: 'owner', op: 'eq', value: 'bob' }] },
        },
        lock: false,
      },
    });
    expect(call_(f, { user: SIN_ROL }).map((i) => i.key)).toEqual(['r1', 'r3']);
    expect(call_(f, { user: null })).toEqual([]);
  });

  it('control: recurso sin scope declarado ve todo, identidad mediante', () => {
    const f = fixture_({ policies: { access: { read: 'session', write: 'admin' }, lock: false } });
    expect(call_(f, { user: STAFF }).length).toBe(3);
    expect(call_(f, { user: null }).length).toBe(3);
  });

  it('condición anclada en $item: la fila se juzga contra sí misma', () => {
    const f = fixture_({
      policies: {
        access: {
          read: 'session',
          write: 'admin',
          scope: {
            'role:admin': [],
            'role:staff': [{ field: 'owner', op: 'eq', from: '$item.owner' }],
          },
        },
        lock: false,
      },
    });
    // Trivialmente verdadera para cualquier fila… hasta que el ancla cambia.
    expect(call_(f, { user: STAFF }).length).toBe(3);

    const g = fixture_({
      policies: {
        access: {
          read: 'session',
          write: 'admin',
          scope: {
            'role:admin': [],
            'role:staff': [{ field: 'owner', op: 'eq', from: '$item.name' }],
          },
        },
        lock: false,
      },
    });
    // owner === name no ocurre en ninguna fila ⇒ nadie ve nada (y admin
    // sigue viendo todo por su entrada).
    expect(call_(g, { user: STAFF })).toEqual([]);
    expect(call_(g, { user: ADMIN }).length).toBe(3);
  });
});

describe('B8 · R7.4c — fila con clave fuera de scope: 404 honesto', () => {
  it('get: la fila no existe para esa identidad', () => {
    const f = fixture_();
    expect(call_(f, { params: { key: 'r1' }, user: STAFF }).key).toBe('r1');
    expectStatus_(() => call_(f, { params: { key: 'r2' }, user: STAFF }), 404);
    expect(call_(f, { params: { key: 'r2' }, user: ADMIN }).key).toBe('r2');
  });

  it('update: fuera de scope no se actualiza (404)', () => {
    const f = fixture_();
    const err = expectStatus_(
      () =>
        call_(f, { method: 'PATCH', params: { key: 'r2' }, payload: { name: 'x' }, user: STAFF }),
      404,
    );
    expect(err.message).toContain('No existe');
    // La fila de su scope sí se actualiza (y responde con lo suyo).
    const ok = call_(f, {
      method: 'PATCH',
      params: { key: 'r1' },
      payload: { name: 'UnoX' },
      user: STAFF,
    });
    expect(ok.name).toBe('UnoX');
  });

  it('remove: fuera de scope no se borra (404); dentro, sí', () => {
    const f = fixture_();
    expectStatus_(() => call_(f, { method: 'DELETE', params: { key: 'r2' }, user: STAFF }), 404);
    expect(call_(f, { params: { key: 'r2' }, user: ADMIN }).key).toBe('r2'); // intacta

    call_(f, { method: 'DELETE', params: { key: 'r1' }, user: STAFF });
    expectStatus_(() => call_(f, { params: { key: 'r1' }, user: ADMIN }), 404); // borrada
  });
});
