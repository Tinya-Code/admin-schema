// api/__tests__/op-policies — B8 · R7.4: política de acceso POR OPERACIÓN.
//
// El router sólo sabe `read`|`write` (umbral por grupo, §3.4); el nivel
// fino por operación (`policies.access.operations`) lo exige 24-crud, donde
// la operación ya se conoce. Este spec entra por `dispatchResource_` — la
// puerta real — y prueba que el override:
//
//  1. APRIETA: un `list: 'role:staff'` sobre umbral `session` deja pasar
//     al staff y frena al authenticated sin rol (403, NO 401 — §4.5);
//  2. es POR OPERACIÓN: el mismo staff que lista NO puede `get` si ése
//     pide `role:admin`;
//  3. es FAIL-CLOSED: sin identidad, 401 (un override declara QUIÉN puede);
//  4. sin mapa de overrides el umbral del grupo manda (control);
//  5. el mapa viaja al front en la proyección (R7.5 lo consume).
//
// La coherencia de la DECLARACIÓN (nivel válido, op encendida, no más
// suelta que el umbral) la juzga validate-registry al arranque.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

const ADMIN = { id: 'u_1', email: 'ana@x.com', role: 'admin', active: true };
const STAFF = { id: 'u_2', email: 'bob@x.com', role: 'staff', active: true };
const SIN_ROL = { id: 'u_3', email: 'caro@x.com', role: '', active: true };

const SHEET = '__op_sheet__';
const GRID = [
  ['key', 'name', 'active'],
  ['r1', 'Uno', true],
  ['r2', 'Dos', true],
];

let REGISTRY;
let dispatchResource_;
let projectPolicies_;
let seq = 0;
let originalOpenSpreadsheet;

/** Colección con `read: session` y overrides: list ⇒ staff, get ⇒ admin. */
function fixture_(extra = {}) {
  const id = '__op_' + ++seq;
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
    policies: {
      access: {
        read: 'session',
        write: 'admin',
        operations: { list: 'role:staff', get: 'role:admin' },
      },
      lock: false,
    },
    exposeToFront: false,
    operations: { list: true, get: true },
    fields: [
      { key: 'key', type: 'text', required: true, immutable: true },
      { key: 'name', type: 'text', required: true },
      { key: 'active', type: 'boolean', required: true, default: true },
    ],
    ...extra,
  };
  REGISTRY.resources[id] = resource;
  const sheet = fakeSheet_(GRID);
  return { id, resource, ss: fakeApp_({ [SHEET]: sheet }) };
}

/** Despacho real con identidad opcional (la pone la cadena de §3.4). */
function call_(fixture, { method = 'GET', params = {}, user } = {}) {
  globalThis.openSpreadsheet_ = () => fixture.ss;
  return dispatchResource_(fixture.resource, {
    method,
    path: '/x',
    params,
    payload: {},
    user,
  });
}

/** El error lanzado (apiStatus) o null si no lanzó nada. */
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
  projectPolicies_ = globalThis.projectPolicies_;
});

beforeEach(() => {
  REGISTRY = globalThis.REGISTRY;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
});

afterEach(() => {
  globalThis.openSpreadsheet_ = originalOpenSpreadsheet;
  for (const id of Object.keys(REGISTRY.resources)) {
    if (id.startsWith('__op_')) delete REGISTRY.resources[id];
  }
});

describe('B8 · R7.4 — políticas por operación en el dispatcher', () => {
  it('el staff lista (override list: role:staff sobre umbral session)', () => {
    const f = fixture_();
    const res = call_(f, { user: STAFF });
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);
  });

  it('el mismo staff NO puede get: role:admin lo frena con 403, no 401', () => {
    const f = fixture_();
    // §4.5: 403 = «sin permiso» SIN cerrar sesión; 401 mandaría a login.
    expectStatus_(() => call_(f, { params: { key: 'r1' }, user: STAFF }), 403);
  });

  it('el admin sí puede get (rank 20 ≥ 20)', () => {
    const f = fixture_();
    const res = call_(f, { params: { key: 'r1' }, user: ADMIN });
    expect(res.key).toBe('r1');
  });

  it('authenticated sin rol: 403 en list (no alcanza role:staff)', () => {
    const f = fixture_();
    expectStatus_(() => call_(f, { user: SIN_ROL }), 403);
  });

  it('sin identidad: 401 fail-closed — un override declara QUIÉN puede', () => {
    const f = fixture_();
    expectStatus_(() => call_(f, { user: null }), 401);
  });

  it('control: sin mapa de overrides el umbral del grupo manda (list pasa)', () => {
    const f = fixture_({
      policies: { access: { read: 'session', write: 'admin' }, lock: false },
    });
    const res = call_(f, { user: STAFF });
    expect(res.length).toBe(2);
  });

  it('el mapa de overrides viaja en la proyección de policies', () => {
    const f = fixture_();
    const proy = projectPolicies_(f.resource);
    expect(proy.access.operations).toEqual({ list: 'role:staff', get: 'role:admin' });
  });

  it('recurso sin policies: la proyección publica operations vacío', () => {
    const f = fixture_({ policies: undefined });
    expect(projectPolicies_(f.resource).access.operations).toEqual({});
  });
});
