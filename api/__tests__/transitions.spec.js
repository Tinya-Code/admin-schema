// api/__tests__/transitions — B3 · R5.5: máquinas de estado por campo.
//
// Lo que cubre acá y ninguna otra parte cubre:
//
//  1. **El motor juzga el CAMBIO, no el valor.** Un update que no toca el
//     campo pasa por alto; un cambio al mismo valor tampoco es cambio; un
//     salto fuera del mapa es **409**, y un valor actual SIN entrada no
//     cambia a nada (fail-closed).
//  2. **Create queda fuera:** no hay «desde dónde». El valor inicial lo
//     decide el `default` del schema.
//  3. **El 422 manda sobre el 409:** un payload mal formado se pinta campo a
//     campo; el conflicto de estado sólo se plantea con un payload sano.
//  4. **La declaración se juzga al ARRANQUE:** campo inexistente, máquina
//     vacía, reglas que no son listas y — sobre todo — valores que no viven
//     en el `enum` del campo son ROJO, porque esa máquina jamás se cumpliría.
//
// Ningún recurso declara `transitions` todavía (D54): el mecanismo llega
// antes que el caso de producto, igual que `remove.mode: 'soft'` y
// `actions`.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let originalOpenSpreadsheet;
let originalVerifySession;
let seq = 0;

const SHEET = '__trans_sheet__';

const MAQUINA = {
  status: {
    PENDIENTE: ['ENTREGADO', 'CANCELADO'],
    ENTREGADO: ['ENTREGADO'],
    CANCELADO: ['PENDIENTE'],
  },
};

/** Colección mínima con la máquina de `orders` pero con filas de juguete. */
function fixture_(transitions = MAQUINA, extra = {}) {
  const id = '__tr_' + ++seq;
  const resource = {
    id,
    kind: 'collection',
    sheet: SHEET,
    keyField: 'ref',
    immutableKey: true,
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
    operations: { list: true, get: true, create: true, update: true, remove: true },
    transitions,
    fields: [
      { key: 'ref', type: 'text', required: true, immutable: true },
      { key: 'name', type: 'text', required: true },
      {
        key: 'status',
        type: 'select',
        required: true,
        default: 'PENDIENTE',
        enum: ['PENDIENTE', 'ENTREGADO', 'CANCELADO'],
      },
    ],
    ...extra,
  };
  REGISTRY.resources[id] = resource;
  const sheet = fakeSheet_([
    ['ref', 'name', 'status'],
    ['o1', 'Uno', 'PENDIENTE'],
    ['o2', 'Dos', 'ENTREGADO'],
    ['o3', 'Tres', 'CANCELADO'],
  ]);
  globalThis.openSpreadsheet_ = () => fakeApp_({ [SHEET]: sheet });
  globalThis.ROUTE_TABLE_ = null;
  return { id, resource, sheet, path: `/admin/${id}` };
}

function put_(path, payload) {
  const raw = globalThis.doPost({
    postData: {
      contents: JSON.stringify({ method: 'PUT', path, payload, token: 'tk' }),
    },
  });
  const body = JSON.parse(raw.getContent());
  return body && body.error ? body.error : body;
}

function post_(path, payload) {
  const raw = globalThis.doPost({
    postData: {
      contents: JSON.stringify({ method: 'POST', path, payload, token: 'tk' }),
    },
  });
  const body = JSON.parse(raw.getContent());
  return body && body.error ? body.error : body;
}

beforeAll(() => {
  loadBackend();
});

beforeEach(() => {
  REGISTRY = globalThis.REGISTRY;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
  originalVerifySession = globalThis.verifySession_;
  globalThis.verifySession_ = () => ({
    payload: { sid: 'sid-test' },
    user: { active: true, role: 'admin', id: 'u1', email: 'u@test' },
  });
});

afterEach(() => {
  globalThis.openSpreadsheet_ = originalOpenSpreadsheet;
  globalThis.verifySession_ = originalVerifySession;
  globalThis.ROUTE_TABLE_ = null;
  for (const id of Object.keys(REGISTRY.resources)) {
    if (id.startsWith('__tr_')) delete REGISTRY.resources[id];
  }
});

// ── 1. El motor: juzga el cambio ──────────────────────────────────────────

describe('assertTransitions_ — el motor', () => {
  const base = () => ({ transitions: MAQUINA });
  const call = (resource, current, incoming) =>
    globalThis.assertTransitions_(resource, current, incoming);

  it('permite un salto declarado y bloquea uno que no lo está', () => {
    expect(() => call(base(), { status: 'PENDIENTE' }, { status: 'ENTREGADO' })).not.toThrow();
    expect(() => call(base(), { status: 'ENTREGADO' }, { status: 'CANCELADO' })).toThrow(
      /Cambio de 'status' no permitido: ENTREGADO → CANCELADO/,
    );
  });

  it('un valor actual SIN entrada no cambia a nada (fail-closed)', () => {
    expect(() => call(base(), { status: 'LEGADO' }, { status: 'ENTREGADO' })).toThrow(
      /no permitido: LEGADO → ENTREGADO/,
    );
    // …pero sí puede quedarse como está.
    expect(() => call(base(), { status: 'LEGADO' }, { status: 'LEGADO' })).not.toThrow();
  });

  it('el cambio se compara como TEXTO (el sheet guarda strings)', () => {
    expect(() => call(base(), { status: 'PENDIENTE' }, { status: 'PENDIENTE' })).not.toThrow();
  });

  it('un update que no toca el campo no se juzga', () => {
    expect(() => call(base(), { status: 'ENTREGADO' }, { name: 'Otro' })).not.toThrow();
  });

  it('create no se juzga: no hay «desde dónde»', () => {
    expect(() => call(base(), null, { status: 'CANCELADO' })).not.toThrow();
  });

  it('un recurso sin máquina pasa por alto', () => {
    expect(() => call({}, { status: 'ENTREGADO' }, { status: 'CANCELADO' })).not.toThrow();
  });

  it('un campo con máquina vacía no deja pasar nada', () => {
    expect(() =>
      call({ transitions: { status: {} } }, { status: 'PENDIENTE' }, { status: 'ENTREGADO' }),
    ).toThrow(/no permitido/);
  });
});

// ── 2. De punta a punta ───────────────────────────────────────────────────

describe('PUT /admin/<recurso>/<clave> — con máquina declarada', () => {
  it('acepta los saltos declarados y escribe el nuevo estado', () => {
    const fixture = fixture_();
    const body = put_(`${fixture.path}/o1`, { status: 'CANCELADO' });
    expect(body.status).toBe('CANCELADO');
    expect(fixture.sheet.rows()[1]).toEqual(['o1', 'Uno', 'CANCELADO']);
  });

  it('un salto prohibido responde 409 y la fila NO cambia', () => {
    const fixture = fixture_();
    expect(put_(`${fixture.path}/o2`, { status: 'CANCELADO' })).toMatchObject({
      status: 409,
      message: expect.stringContaining("Cambio de 'status' no permitido"),
    });
    expect(fixture.sheet.rows()[2]).toEqual(['o2', 'Dos', 'ENTREGADO']);
  });

  it('un update que no toca el estado pasa igual', () => {
    const fixture = fixture_();
    expect(put_(`${fixture.path}/o2`, { name: 'Renombrado' }).name).toBe('Renombrado');
    expect(fixture.sheet.rows()[2]).toEqual(['o2', 'Renombrado', 'ENTREGADO']);
  });

  it('el mismo valor no es un cambio', () => {
    const fixture = fixture_();
    expect(put_(`${fixture.path}/o2`, { status: 'ENTREGADO' }).status).toBe('ENTREGADO');
  });

  it('create no se juzga: el valor inicial lo decide el schema', () => {
    const fixture = fixture_();
    const created = post_(`${fixture.path}`, { ref: 'o9', name: 'Nuevo', status: 'CANCELADO' });
    expect(created.status).toBe('CANCELADO');
    expect(fixture.sheet.rows()[4]).toEqual(['o9', 'Nuevo', 'CANCELADO']);
  });

  it('el 422 (payload mal formado) manda sobre el 409 (estado)', () => {
    const fixture = fixture_();
    // status es `required`: vacío + salto prohibido ⇒ se pinta el 422.
    expect(put_(`${fixture.path}/o2`, { status: '' })).toMatchObject({ status: 422 });
  });
});

// ── 3. La declaración se juzga al ARRANQUE ────────────────────────────────

describe('validateRegistry_ — la declaración de `transitions`', () => {
  const base = () => ({
    id: '__tr_valid',
    kind: 'collection',
    sheet: 'sheet',
    keyField: 'ref',
    titleField: 'name',
    ordering: 'none',
    activeField: null,
    onDelete: 'none',
    dependents: [],
    listProjection: null,
    imageFolder: null,
    views: {},
    policies: { access: { read: 'admin', write: 'admin' } },
    exposeToFront: false,
    fields: [
      { key: 'ref', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
      { key: 'status', type: 'select', required: true, enum: ['PENDIENTE', 'ENTREGADO'] },
    ],
  });

  function issuesOf_(resource) {
    REGISTRY.resources.__tr_valid = resource;
    try {
      return globalThis
        .validateRegistry_()
        .filter((issue) => issue.indexOf('resources.__tr_valid') === 0);
    } finally {
      delete REGISTRY.resources.__tr_valid;
    }
  }

  it('la declaración real sigue limpia', () => {
    expect(globalThis.validateRegistry_()).toEqual([]);
  });

  it('la máquina sólo puede nombrar campos que existen', () => {
    expect(issuesOf_({ ...base(), transitions: { nope: { a: ['b'] } } })[0]).toMatch(
      /transitions\.nope: campo inexistente/,
    );
  });

  it('cada regla es «valor actual → lista de permitidos»', () => {
    expect(issuesOf_({ ...base(), transitions: { status: {} } })[0]).toMatch(/máquina vacía/);
    expect(
      issuesOf_({ ...base(), transitions: { status: { PENDIENTE: 'ENTREGADO' } } })[0],
    ).toMatch(/debe ser un array de estados permitidos/);
    expect(issuesOf_({ ...base(), transitions: 'PENDIENTE' })[0]).toMatch(
      /debe ser un objeto de máquinas por campo/,
    );
  });

  it('todo valor referenciado tiene que vivir en el `enum` del campo', () => {
    expect(issuesOf_({ ...base(), transitions: { status: { PENDIENTE: ['ENTREGADO'] } } })).toEqual(
      [],
    );
    expect(issuesOf_({ ...base(), transitions: { status: { FUTURO: ['PENDIENTE'] } } })[0]).toMatch(
      /transitions\.status\.FUTURO: no es un valor del enum/,
    );
    expect(
      issuesOf_({ ...base(), transitions: { status: { PENDIENTE: ['INVENTADO'] } } })[0],
    ).toMatch(/destino no declarado en el enum \(INVENTADO\)/);
  });

  it('sin `enum` no hay vocabulario que violar', () => {
    const recurso = base();
    recurso.fields[2] = { key: 'status', type: 'text', required: true };
    expect(issuesOf_({ ...recurso, transitions: { status: { cualquiera: ['otro'] } } })).toEqual(
      [],
    );
  });
});
