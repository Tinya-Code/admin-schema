// api/__tests__/secret-leak — R7.6/R7.7: los campos `secret` JAMÁS viajan.
//
// auth.md §4.1/§4.2: las respuestas nunca contienen `pass_hash`,
// `pass_salt` ni `token_version`. Desde R7.6 `users` SÍ es un recurso del
// motor (gestión de usuarios), así que este spec es la PRUEBA DE FUGA:
// entra por la puerta real (`dispatchResource_` y `handleSchema_`) con el
// recurso `users` declarado y una hoja `_users` que lleva los tres
// secretos, y verifica que:
//
//  1. get, list y update (incluso para ADMIN) no traen ninguno de los tres;
//  2. /admin/schema no publica los campos secret (ni siquiera el tipo);
//  3. un listProjection que nombre un campo secret es rojo al arranque;
//  4. la caché no envenena: el dato crudo en la caché no resucita los
//     secretos en la respuesta siguiente;
//  5. el resto de columnas SÍ llega (el filtro no apaga la respuesta).
//
// Si algún día un refactor mete un `JSON.stringify` crudo de la fila en la
// respuesta, este spec se pone rojo.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

const ADMIN = { id: 'u_1', email: 'ana@x.com', role: 'admin', active: true };
const STAFF = { id: 'u_2', email: 'bob@x.com', role: 'staff', active: true };

const SECRETOS = ['pass_hash', 'pass_salt', 'token_version'];

const SHEET = '_users';
// Fila con los tres secretos bien visibles — si el filtro falla, estallan.
const GRID = [
  [
    'id',
    'email',
    'name',
    'role',
    'active',
    'token_version',
    'pass_hash',
    'pass_salt',
    'last_login_at',
    'created_at',
  ],
  [
    'u_1',
    'ana@x.com',
    'Ana',
    'admin',
    true,
    '3',
    'HASH-ANA',
    'SALT-ANA',
    '2026-10-01',
    '2026-01-01',
  ],
  [
    'u_2',
    'bob@x.com',
    'Bob',
    'staff',
    true,
    '1',
    'HASH-BOB',
    'SALT-BOB',
    '2026-10-02',
    '2026-02-01',
  ],
];

let REGISTRY;
let dispatchResource_;
let handleSchema;
let validateRegistry_;
let seq = 0;
let originalOpenSpreadsheet;
let originalCacheService;

function call_(resource, { method = 'GET', params = {}, payload = {}, user } = {}) {
  globalThis.openSpreadsheet_ = () => fakeApp_({ [SHEET]: fakeSheet_(GRID) });
  return dispatchResource_(resource, { method, path: '/admin/users', params, payload, user });
}

function expectSinSecretos_(obj, contexto) {
  const texto = JSON.stringify(obj);
  for (const secreto of SECRETOS) {
    expect(texto, `${contexto}: se filtró ${secreto}`).not.toContain(secreto);
  }
}

beforeAll(() => {
  loadBackend();
  dispatchResource_ = globalThis.dispatchResource_;
  handleSchema = globalThis.handleSchema;
  validateRegistry_ = globalThis.validateRegistry_;
});

beforeEach(() => {
  REGISTRY = globalThis.REGISTRY;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
  originalCacheService = globalThis.CacheService;
  // Cache REAL (Map): el dato crudo con secretos queda cacheado — la
  // respuesta filtrada no debe envenenarla ni resucitarlos.
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
    if (id.startsWith('__')) delete REGISTRY.resources[id];
  }
});

describe('prueba de fuga: secretos jamás viajan (R7.7)', () => {
  it('get de users no trae pass_hash, pass_salt ni token_version (admin incluido)', () => {
    const res = call_(REGISTRY.resources.users, {
      method: 'GET',
      params: { id: 'u_1' },
      user: ADMIN,
    });
    expect(res.id).toBe('u_1');
    expect(res.name).toBe('Ana');
    expectSinSecretos_(res, 'get admin');
  });

  it('list tampoco — ni para admin, ni para staff', () => {
    const adminList = call_(REGISTRY.resources.users, { method: 'GET', user: ADMIN });
    expectSinSecretos_(adminList, 'list admin');
    const staffList = call_(REGISTRY.resources.users, { method: 'GET', user: STAFF });
    expectSinSecretos_(staffList, 'list staff');
  });

  it('update responde sin secretos y el resto de columnas sí llega', () => {
    const res = call_(REGISTRY.resources.users, {
      method: 'PUT',
      params: { id: 'u_1' },
      payload: { name: 'Ana García' },
      user: ADMIN,
    });
    expect(res.name).toBe('Ana García');
    expect(res.email).toBe('ana@x.com'); // lo legible SÍ viaja
    expectSinSecretos_(res, 'update admin');
  });

  it('/admin/schema no publica los campos secret de users', () => {
    const schema = handleSchema();
    const users = schema.resources.users;
    expect(users, 'users no está en /admin/schema').toBeTruthy();
    const keys = users.fields.map((f) => f.key);
    for (const secreto of SECRETOS) {
      expect(keys, `${secreto} aparece en /admin/schema`).not.toContain(secreto);
    }
    // Y lo legible SÍ está: el recurso no quedó vacío.
    expect(keys).toContain('email');
    expect(keys).toContain('name');
    expectSinSecretos_(users, '/admin/schema');
  });

  it('la caché cruda no resucita los secretos en la respuesta siguiente', () => {
    // Primera llamada llena la caché con la fila cruda (con secretos).
    call_(REGISTRY.resources.users, { method: 'GET', params: { id: 'u_1' }, user: ADMIN });
    // Segunda llamada (cache hit) — misma garantía.
    const res = call_(REGISTRY.resources.users, {
      method: 'GET',
      params: { id: 'u_1' },
      user: ADMIN,
    });
    expectSinSecretos_(res, 'cache hit');
  });

  it('validate-registry vuelve ROJO un listProjection que nombre un secret', () => {
    const users = REGISTRY.resources.users;
    const original = users.listProjection;
    users.listProjection = ['id', 'email', 'pass_hash'];
    try {
      const issues = validateRegistry_();
      const hit = issues.filter((i) => String(i).indexOf('secret') !== -1);
      expect(hit.length, 'el arranque no detectó pass_hash en listProjection').toBeGreaterThan(0);
    } finally {
      users.listProjection = original;
    }
  });
});
