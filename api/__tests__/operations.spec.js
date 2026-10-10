// api/__tests__/operations — B3 · R5.3: CRUD configurable por recurso.
//
// Lo que éste archivo cubre y ninguna otra parte cubre:
//
//  1. **Fail-closed en el despacho.** Una operación que el recurso no declaró
//     (o declaró `false`) responde **405**, aunque el motor sepa ejecutarla.
//     Los specs del CRUD llaman a `resourceCreate_`/`resourcePut_` a pelo, así
//     que NINGUNO de ellos prueba éste portazo: acá se entra por
//     `dispatchResource_`, que es la puerta real.
//  2. **La tabla método ⇒ operación** (`operationFor_`): GET con/sin clave,
//     singleton, POST, PUT/PATCH, reorder y DELETE. PATCH no es operación
//     propia: cae en `update`.
//  3. **`remove.mode`**: `hard` (por defecto) borra la fila; `soft` la
//     conserva con `activeField = false`; `forbidden` es 405.
//  4. **La declaración se juzga al arranque**: `mode` inválido, `reorder`
//     sin `ordering: 'positioned'`, `soft` sin `activeField` boolean y
//     `bulk` (no implementado) son ROJO en `validateRegistry_()`, no un
//     descubrimiento en producción.
//
// La hoja es la fixture en memoria de `_sheets.js`; `openSpreadsheet_` se
// parchea para que el despacho no dispare SpreadsheetApp real.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let dispatchResource_;
let operationFor_;
let storageMap_;
let originalOpenSpreadsheet;
let seq = 0;

const SHEET = '__ops_sheet__';

/** Recurso mínimo con operaciones declaradas a mano; hoja de 2 filas. */
function fixture_(operations, extra = {}) {
  const id = '__ops_' + ++seq;
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
    listProjection: null,
    imageFolder: null,
    views: {},
    policies: { access: { read: 'admin', write: 'admin' }, lock: false },
    exposeToFront: false,
    operations,
    fields: [
      { key: 'key', type: 'text', required: true, immutable: true },
      { key: 'name', type: 'text', required: true },
      { key: 'active', type: 'boolean', required: true, default: true },
    ],
    ...extra,
  };
  REGISTRY.resources[id] = resource;
  const sheet = fakeSheet_([
    ['key', 'name', 'active'],
    ['a1', 'Uno', true],
    ['a2', 'Dos', true],
  ]);
  return { id, resource, map: storageMap_(resource), sheet, ss: fakeApp_({ [SHEET]: sheet }) };
}

/** El despacho real, con la hoja resuelta por la fixture. */
function call_(fixture, request) {
  globalThis.openSpreadsheet_ = () => fixture.ss;
  return dispatchResource_(fixture.resource, request);
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

beforeAll(() => {
  loadBackend();
  dispatchResource_ = globalThis.dispatchResource_;
  operationFor_ = globalThis.operationFor_;
  storageMap_ = globalThis.storageMap_;
});

beforeEach(() => {
  REGISTRY = globalThis.REGISTRY;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
});

afterEach(() => {
  globalThis.openSpreadsheet_ = originalOpenSpreadsheet;
  for (const id of Object.keys(REGISTRY.resources)) {
    if (id.startsWith('__ops_')) delete REGISTRY.resources[id];
  }
});

// ── 1. La tabla método ⇒ operación ────────────────────────────────────────

describe('operationFor_ — método lógico ⇒ operación del motor', () => {
  const ALL = { list: true, get: true, create: true, update: true, remove: true, reorder: true };

  it('GET sin clave = list · GET con clave = get', () => {
    const { resource, map } = fixture_(ALL);
    expect(operationFor_(resource, map, { method: 'GET', params: {}, payload: {} })).toBe('list');
    expect(
      operationFor_(resource, map, { method: 'GET', params: { key: 'a1' }, payload: {} }),
    ).toBe('get');
  });

  it('un singleton siempre es get, tenga o no clave', () => {
    const { resource, map } = fixture_(ALL, { kind: 'singleton' });
    expect(operationFor_(resource, map, { method: 'GET', params: {}, payload: {} })).toBe('get');
    expect(operationFor_(resource, map, { method: 'GET', params: { key: 'x' }, payload: {} })).toBe(
      'get',
    );
  });

  it('POST = create · PUT/PATCH con clave = update', () => {
    const { resource, map } = fixture_(ALL);
    expect(operationFor_(resource, map, { method: 'POST', params: {}, payload: {} })).toBe(
      'create',
    );
    expect(
      operationFor_(resource, map, {
        method: 'PUT',
        params: { key: 'a1' },
        payload: { name: 'x' },
      }),
    ).toBe('update');
    expect(
      operationFor_(resource, map, {
        method: 'PATCH',
        params: { key: 'a1' },
        payload: { name: 'x' },
      }),
    ).toBe('update');
  });

  it('PUT sin clave + payload.reorder = reorder (sólo eso, y sólo en colección)', () => {
    const { resource, map } = fixture_(ALL);
    expect(
      operationFor_(resource, map, {
        method: 'PUT',
        params: {},
        payload: { reorder: { key: 'a1', position: 2 } },
      }),
    ).toBe('reorder');

    // Con clave en la ruta manda el registro, no la intención de ordenar.
    expect(
      operationFor_(resource, map, {
        method: 'PUT',
        params: { key: 'a1' },
        payload: { reorder: { position: 2 } },
      }),
    ).toBe('update');

    // Sin payload no hay reorder que interpretar.
    expect(operationFor_(resource, map, { method: 'PUT', params: {}, payload: {} })).toBe('update');
  });

  it('DELETE = remove · método desconocido = 400', () => {
    const { resource, map } = fixture_(ALL);
    expect(
      operationFor_(resource, map, { method: 'DELETE', params: { key: 'a1' }, payload: {} }),
    ).toBe('remove');
    const err = errorOf_(() =>
      operationFor_(resource, map, { method: 'TRACE', params: {}, payload: {} }),
    );
    expect(err.apiStatus).toBe(400);
  });
});

// ── 2. Fail-closed en el despacho ─────────────────────────────────────────

describe('dispatchResource_ — lo no declarado responde 405', () => {
  it('una operación ausente del bloque `operations` no existe', () => {
    // Paridad con `orders`: create con computed, el resto sin declarar.
    const fixture = fixture_({ create: true });
    const err = errorOf_(() =>
      call_(fixture, { method: 'GET', path: '/x', params: {}, payload: {} }),
    );
    expect(err.apiStatus).toBe(405);
    expect(err.message).toContain("La operación 'list' no está declarada");
    expect(err.message).toContain(fixture.id);
  });

  it('`false` apaga igual de seguro que ausente', () => {
    const fixture = fixture_({ list: true, get: true, remove: false });
    const err = errorOf_(() =>
      call_(fixture, { method: 'DELETE', path: '/x/a1', params: { key: 'a1' }, payload: {} }),
    );
    expect(err.apiStatus).toBe(405);
    expect(err.message).toContain("La operación 'remove' no está declarada");
  });

  it('un recurso SIN bloque `operations` no tiene ninguna encendida', () => {
    const fixture = fixture_(undefined);
    const err = errorOf_(() =>
      call_(fixture, { method: 'GET', path: '/x', params: {}, payload: {} }),
    );
    expect(err.apiStatus).toBe(405);
  });

  it("remove: { mode: 'forbidden' } está declarado pero prohibido", () => {
    const fixture = fixture_({ list: true, get: true, remove: { mode: 'forbidden' } });
    const err = errorOf_(() =>
      call_(fixture, { method: 'DELETE', path: '/x/a1', params: { key: 'a1' }, payload: {} }),
    );
    expect(err.apiStatus).toBe(405);
    expect(err.message).toContain("'forbidden'");
  });

  it('paridad: las 7 declaraciones reales encienden exactamente lo de hoy', () => {
    const esperado = {
      categories: ['create', 'get', 'list', 'remove', 'reorder', 'update'],
      orders: ['create', 'get', 'list', 'remove', 'update'],
      products: ['create', 'get', 'list', 'remove', 'update'],
      legal: ['get', 'update'],
      site: ['get', 'update'],
      pickpass: ['get', 'update'],
    };
    for (const [id, ops] of Object.entries(esperado)) {
      const declared = REGISTRY.resources[id].operations || {};
      const encendidas = Object.keys(declared)
        .filter((op) => declared[op] !== false)
        .sort();
      expect(encendidas, id).toEqual(ops);
    }
    // dashboard no tiene storage: el router no le rutas, así que no declara.
    expect(REGISTRY.resources.dashboard.operations).toBeUndefined();
  });
});

// ── 3. remove.mode: hard | soft | forbidden ───────────────────────────────

describe('remove.mode — hard borra, soft conserva', () => {
  it('hard (por defecto) saca la fila de la hoja', () => {
    const fixture = fixture_({ list: true, get: true, remove: true });
    const out = call_(fixture, {
      method: 'DELETE',
      path: '/x/a1',
      params: { key: 'a1' },
      payload: {},
    });
    expect(out.deleted).toBe('a1');
    expect(out.mode).toBeUndefined();
    // El fake deja la fila borrada como vacía (clearContent), no la recorta:
    // comparamos sólo las filas con datos.
    expect(
      fixture.sheet
        .rows()
        .filter((r) => r.some((c) => c !== ''))
        .map((r) => r[0]),
    ).toEqual(['key', 'a2']);
  });

  it('soft escribe `activeField = false` y la fila SIGUE ahí', () => {
    const fixture = fixture_({ list: true, get: true, remove: { mode: 'soft' } });
    const out = call_(fixture, {
      method: 'DELETE',
      path: '/x/a1',
      params: { key: 'a1' },
      payload: {},
    });
    expect(out).toEqual({ deleted: 'a1', mode: 'soft' });
    expect(fixture.sheet.rows()).toEqual([
      ['key', 'name', 'active'],
      ['a1', 'Uno', false], // la fila se conserva: es baja lógica
      ['a2', 'Dos', true],
    ]);
  });

  it('soft deja intactas las demás filas', () => {
    const fixture = fixture_({ list: true, get: true, remove: { mode: 'soft' } });
    call_(fixture, { method: 'DELETE', path: '/x/a1', params: { key: 'a1' }, payload: {} });
    expect(fixture.sheet.rows()[2]).toEqual(['a2', 'Dos', true]);
  });
});

// ── 3b. `remove.shape` y la proyección pública ────────────────────────────

describe('remove.shape y /admin/schema', () => {
  it('un `remove.shape` declarado SÍ envuelve la respuesta', () => {
    // Regresión del bug de vocabulario: el motor llamaba a
    // `shapeResponse_(resource, 'delete', …)` y `operations.delete` no es una
    // clave válida, así que un `remove.shape` se ignoraba en silencio.
    // pick ['mode'] sobre un borrado HARD (que responde {deleted}) sólo puede
    // devolver {} si el shape CORRIÓ.
    const fixture = fixture_({
      list: true,
      get: true,
      remove: { shape: { pick: ['mode'] } },
    });
    expect(
      call_(fixture, { method: 'DELETE', path: '/x/a1', params: { key: 'a1' }, payload: {} }),
    ).toEqual({});

    const soft = fixture_({
      list: true,
      get: true,
      remove: { mode: 'soft', shape: { pick: ['mode'] } },
    });
    expect(
      call_(soft, { method: 'DELETE', path: '/x/a1', params: { key: 'a1' }, payload: {} }),
    ).toEqual({ mode: 'soft' });
  });

  it('sólo lo encendido viaja a /admin/schema', () => {
    const fixture = fixture_(
      { list: true, get: true, create: true, remove: false },
      {
        exposeToFront: true,
      },
    );
    const projected = globalThis.handleSchema().resources[fixture.id];
    expect(Object.keys(projected.operations).sort()).toEqual(['create', 'get', 'list']);
    expect(projected.operations.remove).toBeUndefined();
  });
});

// ── 4. La declaración se juzga al ARRANQUE ────────────────────────────────

describe('validateRegistry_ — la declaración de `operations`', () => {
  /** Registra un recurso sintético y devuelve sólo los issues que le tocan. */
  function issuesOf_(resource) {
    REGISTRY.resources.__ops_valid = resource;
    try {
      return globalThis
        .validateRegistry_()
        .filter((issue) => issue.indexOf('resources.__ops_valid') === 0);
    } finally {
      delete REGISTRY.resources.__ops_valid;
    }
  }

  const base = () => ({
    id: '__ops_valid',
    kind: 'collection',
    sheet: 'sheet',
    keyField: 'key',
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
      { key: 'key', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
      { key: 'active', type: 'boolean', required: true, default: true },
    ],
  });

  it('la declaración real de los recursos no tiene ni un problema', () => {
    expect(globalThis.validateRegistry_()).toEqual([]);
  });

  it('una operación desconocida o un valor raro rompen el arranque', () => {
    expect(issuesOf_({ ...base(), operations: { borrar: true } })[0]).toMatch(
      /operación desconocida 'borrar'/,
    );
    expect(issuesOf_({ ...base(), operations: { list: 'si' } })[0]).toMatch(
      /operations\.list: debe ser true, false u objeto/,
    );
    expect(issuesOf_({ ...base(), operations: 'todo' })[0]).toMatch(
      /operations: debe ser un objeto/,
    );
  });

  it('`remove.mode` sólo acepta hard | soft | forbidden', () => {
    expect(issuesOf_({ ...base(), operations: { remove: { mode: 'harc' } } })[0]).toMatch(
      /mode inválido 'harc' \(hard \| soft \| forbidden\)/,
    );
    expect(issuesOf_({ ...base(), operations: { remove: { mode: 'hard' } } })).toEqual([]);
    expect(issuesOf_({ ...base(), operations: { remove: { mode: 'forbidden' } } })).toEqual([]);
  });

  it('`soft` exige un `activeField` boolean declarado', () => {
    expect(issuesOf_({ ...base(), operations: { remove: { mode: 'soft' } } })[0]).toMatch(
      /mode 'soft' exige activeField/,
    );
    expect(
      issuesOf_({
        ...base(),
        activeField: 'name', // existe pero no es boolean
        operations: { remove: { mode: 'soft' } },
      })[0],
    ).toMatch(/activeField 'name' debe ser un campo boolean/);
    expect(
      issuesOf_({ ...base(), activeField: 'active', operations: { remove: { mode: 'soft' } } }),
    ).toEqual([]);
  });

  it('`reorder` sólo puede encenderse en un recurso positioned', () => {
    expect(issuesOf_({ ...base(), operations: { reorder: true } })[0]).toMatch(
      /'reorder' exige ordering: 'positioned'/,
    );
    expect(
      issuesOf_({
        ...base(),
        ordering: 'positioned',
        orderStep: 1000,
        operations: { reorder: { shape: {} } },
      }),
    ).toEqual([]);
  });

  it('`bulk` no se puede encender: el motor no lo implementa', () => {
    expect(issuesOf_({ ...base(), operations: { bulk: true } })[0]).toMatch(
      /'bulk' no está implementado/,
    );
    // `update` además no es clave válida de declaración: salen DOS issues.
    expect(
      issuesOf_({ ...base(), operations: { bulk: { update: ['name'] } } }).some((issue) =>
        /'bulk' no está implementado/.test(issue),
      ),
    ).toBe(true);
    expect(issuesOf_({ ...base(), operations: { bulk: false } })).toEqual([]);
  });
});
