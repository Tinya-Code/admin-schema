// api/__tests__/field-access — B8 · R7.4b: acceso fino POR CAMPO.
//
//   field.access = { read?, write? }   (niveles del vocabulario de §4.4)
//     read  → sin el nivel, el campo NO viaja en la respuesta
//     write → sin el nivel, escribirlo es 422 con su ruta (nunca en silencio)
//
// Este spec entra por `dispatchResource_` — la puerta real — y prueba que el
// filtro:
//
//  1. quita el campo leído sin nivel y lo devuelve con nivel (get y list),
//     con contraste 'public' vs 'role:admin' en la misma respuesta;
//  2. es FAIL-CLOSED: sin identidad o sin rol sólo pasan los campos
//     alcanzables;
//  3. NO ENVENENA la caché: la respuesta filtrada no muta el dato crudo
//     (otro rol después ve su propia vista; y el primero, al volver, la
//     suya) — el cache fake acá es REAL (Map), no el proxy inerte;
//  4. el write denegado es 422 VALIDATION_FIELD_ACCESS con su ruta, y con
//     permiso (o sin el campo) el assert deja pasar;
//  5. anida en group y list (prueba directa del filtro, sin hojas hijas);
//  6. proyecta `access` al front (R7.5 lo consume), filtrando valores rotos;
//  7. recurso sin `access`: datos intactos, MISMA referencia (cero copia).
//
// La coherencia de la DECLARACIÓN la juzga validate-registry al arranque
// (spec hermano: validate-registry describe 7).

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

const ADMIN = { id: 'u_1', email: 'ana@x.com', role: 'admin', active: true };
const STAFF = { id: 'u_2', email: 'bob@x.com', role: 'staff', active: true };
const SIN_ROL = { id: 'u_3', email: 'caro@x.com', role: '', active: true };

const SHEET = '__fa_sheet__';
const GRID = [
  ['key', 'name', 'active', 'budget', 'public_note', 'owner_note'],
  ['r1', 'Uno', true, '1000', 'abierto', 'solo-admin'],
  ['r2', 'Dos', true, '2000', 'también', 'otra'],
];

let REGISTRY;
let dispatchResource_;
let projectField_;
let filterFieldsByAccess_;
let filterAccessNode_;
let assertWritableFields_;
let seq = 0;
let originalOpenSpreadsheet;
let originalCacheService;

/**
 * Colección con `budget` restringido en LECTURA (role:admin), un
 * `public_note` de lectura pública como contraste, y `owner_note`
 * restringido en ESCRITURA (role:admin).
 */
function fixture_(extra = {}) {
  const id = '__fa_' + ++seq;
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
    listProjection: ['key', 'name', 'budget'],
    imageFolder: null,
    views: {},
    policies: { access: { read: 'admin', write: 'admin' }, lock: false },
    exposeToFront: false,
    operations: { list: true, get: true, create: true, update: true },
    fields: [
      { key: 'key', type: 'text', required: true, immutable: true },
      { key: 'name', type: 'text', required: true },
      { key: 'active', type: 'boolean', required: true, default: true },
      { key: 'budget', type: 'text', access: { read: 'role:admin' } },
      { key: 'public_note', type: 'text', access: { read: 'public' } },
      { key: 'owner_note', type: 'text', access: { write: 'role:admin' } },
    ],
    ...extra,
  };
  REGISTRY.resources[id] = resource;
  const sheet = fakeSheet_(GRID);
  return { id, resource, ss: fakeApp_({ [SHEET]: sheet }) };
}

/** Despacho real con identidad opcional (la pone la cadena de §3.4). */
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
  projectField_ = globalThis.projectField_;
  filterFieldsByAccess_ = globalThis.filterFieldsByAccess_;
  filterAccessNode_ = globalThis.filterAccessNode_;
  assertWritableFields_ = globalThis.assertWritableFields_;
});

beforeEach(() => {
  REGISTRY = globalThis.REGISTRY;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
  originalCacheService = globalThis.CacheService;
  // Cache REAL (Map): la coherencia con la caché cruda es parte del
  // contrato del filtro, y el proxy inerte del harness no la ejercita.
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
    if (id.startsWith('__fa_')) delete REGISTRY.resources[id];
  }
});

describe('B8 · R7.4b — el campo con access no viaja a quien no lo alcanza', () => {
  it('get: budget sólo para admin; public_note viaja para todos', () => {
    const f = fixture_();
    const admin = call_(f, { params: { key: 'r1' }, user: ADMIN });
    expect(admin.budget).toBe('1000');
    expect(admin.public_note).toBe('abierto');

    const staff = call_(f, { params: { key: 'r1' }, user: STAFF });
    expect(staff.budget).toBeUndefined();
    expect(staff.public_note).toBe('abierto');
    expect(staff.name).toBe('Uno'); // el resto del registro intacto
  });

  it('fail-closed: sin identidad o sin rol el campo admin no viaja', () => {
    const f = fixture_();
    const sinIdentidad = call_(f, { params: { key: 'r1' }, user: null });
    expect(sinIdentidad.budget).toBeUndefined();
    expect(sinIdentidad.public_note).toBe('abierto');

    const sinRol = call_(f, { params: { key: 'r1' }, user: SIN_ROL });
    expect(sinRol.budget).toBeUndefined();
  });

  it('list: el filtro corre por cada ítem', () => {
    const f = fixture_();
    const staff = call_(f, { user: STAFF });
    expect(staff.length).toBe(2);
    for (const item of staff) {
      expect(item.budget).toBeUndefined();
      expect(item.key).toBeDefined();
    }
    const admin = call_(f, { user: ADMIN });
    expect(admin.map((i) => i.budget)).toEqual(['1000', '2000']);
  });

  it('la caché guarda el dato crudo: filtrar una respuesta no envenena la siguiente', () => {
    const f = fixture_();
    expect(call_(f, { params: { key: 'r1' }, user: ADMIN }).budget).toBe('1000');
    // El admin ya cacheó el detalle; el staff no debe heredar su vista…
    expect(call_(f, { params: { key: 'r1' }, user: STAFF }).budget).toBeUndefined();
    // …ni el admin perder la suya al volver (la caché no quedó filtrada).
    expect(call_(f, { params: { key: 'r1' }, user: ADMIN }).budget).toBe('1000');
  });
});

describe('B8 · R7.4b — write: escribir lo denegado es 422, nunca en silencio', () => {
  it('create con owner_note sin nivel: 422 con ruta y código', () => {
    const f = fixture_();
    const err = expectStatus_(
      () =>
        call_(f, {
          method: 'POST',
          payload: { key: 'r9', name: 'Nuevo', owner_note: 'x' },
          user: STAFF,
        }),
      422,
    );
    expect(err.apiErrors).toHaveLength(1);
    expect(err.apiErrors[0].path).toBe('owner_note');
    expect(err.apiErrors[0].code).toBe('VALIDATION_FIELD_ACCESS');
  });

  it('update (PATCH) con el campo denegado: mismo 422', () => {
    const f = fixture_();
    expectStatus_(
      () =>
        call_(f, {
          method: 'PATCH',
          params: { key: 'r1' },
          payload: { owner_note: 'y' },
          user: SIN_ROL,
        }),
      422,
    );
  });

  it('con permiso el assert deja pasar; sin el campo también', () => {
    const f = fixture_();
    expect(() =>
      assertWritableFields_(f.resource, { key: 'r9', name: 'Nuevo', owner_note: 'x' }, ADMIN),
    ).not.toThrow();
    expect(() =>
      assertWritableFields_(f.resource, { key: 'r9', name: 'Nuevo' }, STAFF),
    ).not.toThrow();
  });
});

describe('B8 · R7.4b — el filtro anida y se proyecta', () => {
  it('group y list: el subcampo denegado se quita recursivamente', () => {
    const tree = { meta: { child: { secret: { access: { read: 'role:admin' } } } } };
    const data = { meta: { code: 'x', secret: 's' }, other: 1 };

    expect(filterAccessNode_(tree, data, STAFF)).toEqual({ meta: { code: 'x' }, other: 1 });
    expect(filterAccessNode_(tree, data, ADMIN).meta.secret).toBe('s');

    // Tipo list: el mismo árbol sobre un arreglo de ítems.
    const rows = [{ meta: { code: 'a', secret: 's1' } }, { meta: { code: 'b', secret: 's2' } }];
    expect(filterAccessNode_(tree, rows, STAFF)).toEqual([
      { meta: { code: 'a' } },
      { meta: { code: 'b' } },
    ]);
  });

  it('la proyección publica access al front y filtra valores rotos', () => {
    const proy = projectField_({
      key: 'k',
      type: 'text',
      access: { read: 'role:admin', write: 'admin' },
    });
    expect(proy.access).toEqual({ read: 'role:admin', write: 'admin' });

    const roto = projectField_({ key: 'k', type: 'text', access: { read: 123 } });
    expect(roto.access).toBeUndefined();
  });

  it('control: recurso sin access, datos intactos y MISMA referencia', () => {
    const f = fixture_({
      fields: [
        { key: 'key', type: 'text', required: true, immutable: true },
        { key: 'name', type: 'text', required: true },
      ],
    });
    const data = { key: 'r1', name: 'Uno' };
    expect(filterFieldsByAccess_(f.resource, data, null)).toBe(data);
  });
});
