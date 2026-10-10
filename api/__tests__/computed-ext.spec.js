// api/__tests__/computed-ext — `computed` extensible (B10 · R5.7).
//
// Lo que cubre acá y ninguna otra parte cubre:
//
//  1. **El set del plan está registrado con argsSchema**: `slugify` (el
//     `slug(from)` del plan — D58), `sequence(prefix)`, `uuid`,
//     `hash(field)`, `copy(field)`, `now`, `currentUser`,
//     `lookup(resource, field)`. Además `token`/`pin` siguen intactos.
//  2. **Transforms con contexto:** los nuevos reciben
//     `(value, params, ctx)` — `ctx.ss` para leer hojas (sequence, lookup),
//     `ctx.user` para la identidad AUTENTICADA del request (currentUser),
//     `ctx.field` para el destino (sequence escanea esa columna).
//  3. **Declarado por operación:** `operations.update.computed` rellena el
//     destino sólo si la fila guardada TAMBIÉN lo tiene vacío — un slug ya
//     escrito no se rederiva nunca (inmutabilidad de facto de
//     products/categories) — con origen fusionado (entrante ∪ guardado).
//  4. **Vacío no llena destino** y recurso inexistente en `lookup` ⇒ 500
//     (§16), el mismo criterio del resto del motor.
//
// `write-response.spec.js` ya cubre el caso sin declaración update (slug no
// se recalcula en un PUT mudo); acá se cubre el caso CON declaración.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let storageMap_;
let resourceCreate_;
let resourcePut_;
let validateRegistry_;
let apiError_;

const SHEET = '__comp_sheet__';
const CLIENTES = '__comp_clientes__';
const RESOURCE_ID = '__comp_test__';

/** Recurso mínimo; `extra` pisa/agrega claves (operations, fields, …). */
function buildResource_(extra = {}) {
  return {
    id: RESOURCE_ID,
    kind: 'collection',
    sheet: SHEET,
    keyField: 'ref',
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
    fields: [
      { key: 'ref', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
      { key: 'out', type: 'text' },
    ],
    ...extra,
  };
}

function scenario_(resource, rows, extraSheets) {
  const map = storageMap_(resource);
  const headers = map.columns.map((col) => col.flatKey);
  const sheets = { [SHEET]: fakeSheet_([headers, ...(rows || [])]) };
  if (extraSheets) Object.assign(sheets, extraSheets);
  return { resource, map, ss: fakeApp_(sheets), sheet: sheets[SHEET] };
}

function create_(s, payload, requestExtra = {}) {
  return resourceCreate_(s.ss, s.resource, s.map, {
    method: 'POST',
    payload,
    ...requestExtra,
  });
}

let clientes;

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  storageMap_ = globalThis.storageMap_;
  resourceCreate_ = globalThis.resourceCreate_;
  resourcePut_ = globalThis.resourcePut_;
  validateRegistry_ = globalThis.validateRegistry_;
  apiError_ = globalThis.apiError_;
});

beforeEach(() => {
  clientes = {
    id: '__comp_clientes__',
    kind: 'collection',
    sheet: CLIENTES,
    keyField: 'id',
    titleField: 'nombre',
    ordering: 'none',
    activeField: null,
    onDelete: 'none',
    dependents: [],
    listProjection: null,
    imageFolder: null,
    views: {},
    policies: { access: { read: 'admin', write: 'admin' }, lock: false },
    exposeToFront: false,
    fields: [
      { key: 'id', type: 'text', required: true },
      { key: 'nombre', type: 'text', required: true },
    ],
  };
  REGISTRY.resources[clientes.id] = clientes;
});

afterEach(() => {
  // Por prefijo: `storageMap_` cachea por id y el map EMBEDE los flags del
  // schema con el que se construyó — un id reutilizado con otros `required`
  // heredaría el map viejo (y validatePayload_ juzga contra el map).
  Object.keys(REGISTRY.resources).forEach((id) => {
    if (id.startsWith(RESOURCE_ID) || id === clientes.id) delete REGISTRY.resources[id];
  });
});

// ── 1. El registro del plan ────────────────────────────────────────────────

describe('registro — el set del plan (B10)', () => {
  it('los 8 nombres del plan están registrados con argsSchema', () => {
    const caps = REGISTRY.capabilities.computed;
    // slug(from) del plan = slugify (D58: no se duplica el id).
    ['slugify', 'sequence', 'uuid', 'hash', 'copy', 'now', 'currentUser', 'lookup'].forEach(
      (id) => {
        expect(caps[id], id).toBeDefined();
        expect(typeof caps[id].run).toBe('function');
        expect(caps[id].argsSchema).toBeTypeOf('object');
      },
    );
    // Los de PickPass siguen intactos.
    expect(caps.token).toBeDefined();
    expect(caps.pin).toBeDefined();
  });
});

// ── 2. sequence ────────────────────────────────────────────────────────────

describe('sequence(prefix)', () => {
  const conSecuencia = (params) =>
    buildResource_({
      operations: {
        create: { computed: [{ field: 'out', transform: 'sequence', from: 'name', params }] },
      },
    });

  it('el primer create arranca en 1 con el prefijo y el padding declarados', () => {
    const s = scenario_(conSecuencia({ prefix: 'PED-' }));
    create_(s, { ref: 'p1', name: 'Pan' });
    expect(s.sheet.rows()[1][2]).toBe('PED-0001');
  });

  it('el máximo existente manda: sigue donde quedó la columna', () => {
    const s = scenario_(conSecuencia({ prefix: 'PED-' }), [['p0', 'Viejo', 'PED-0007']]);
    create_(s, { ref: 'p1', name: 'Pan' });
    expect(s.sheet.rows()[2][2]).toBe('PED-0008');
  });

  it('pad es declarable', () => {
    const s = scenario_(conSecuencia({ prefix: 'A', pad: 2 }));
    create_(s, { ref: 'p1', name: 'Pan' });
    expect(s.sheet.rows()[1][2]).toBe('A01');
  });

  it('sólo cuenta valores con el MISMO prefijo: otro prefijo no infla la serie', () => {
    // Si el escaneo ignorara el prefijo, 'OTRO-99' (99 > 7) mandaría y la
    // siguiente serie PED- sería 'PED-100' en vez de 'PED-0008'.
    const s = scenario_(conSecuencia({ prefix: 'PED-' }), [
      ['p0', 'Viejo', 'PED-0007'],
      ['p1', 'Ajeno', 'OTRO-99'],
    ]);
    create_(s, { ref: 'p2', name: 'Pan' });
    expect(s.sheet.rows()[3][2]).toBe('PED-0008');
  });
});

// ── 3. uuid ────────────────────────────────────────────────────────────────

describe('uuid', () => {
  it('dos creates dan dos identificadores distintos', () => {
    const s = scenario_(
      buildResource_({
        operations: { create: { computed: [{ field: 'out', transform: 'uuid', from: 'name' }] } },
      }),
    );
    create_(s, { ref: 'p1', name: 'Pan' });
    create_(s, { ref: 'p2', name: 'Focaccia' });
    const [a, b] = [s.sheet.rows()[1][2], s.sheet.rows()[2][2]];
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

// ── 4. hash ────────────────────────────────────────────────────────────────

describe('hash(field)', () => {
  const conHash = (params) =>
    buildResource_({
      operations: {
        create: { computed: [{ field: 'out', transform: 'hash', from: 'name', params }] },
      },
    });

  it('es determinista y distingue entradas distintas', () => {
    const s = scenario_(conHash());
    create_(s, { ref: 'p1', name: 'Pan' });
    create_(s, { ref: 'p2', name: 'Pan' });
    create_(s, { ref: 'p3', name: 'Focaccia' });
    const [a, b, c] = s.sheet
      .rows()
      .slice(1)
      .map((row) => row[2]);
    expect(a).toBeTruthy();
    expect(a).toBe(b); // misma entrada ⇒ mismo hash
    expect(a).not.toBe(c); // distinta entrada ⇒ distinto hash
  });

  it('params.field apunta a OTRO campo del payload', () => {
    const s = scenario_(conHash({ field: 'ref' }));
    create_(s, { ref: 'clave-secreta', name: 'Pan' });
    const directo = scenario_(conHash());
    create_(directo, { ref: 'p9', name: 'clave-secreta' });
    // hash(ref) del primer escenario == hash(name) del segundo: mismo texto.
    expect(s.sheet.rows()[1][2]).toBe(directo.sheet.rows()[1][2]);
  });
});

// ── 5. copy ────────────────────────────────────────────────────────────────

describe('copy(field)', () => {
  it('copia VERBATIM, sin slugify ni formato', () => {
    const s = scenario_(
      buildResource_({
        operations: {
          create: {
            computed: [{ field: 'out', transform: 'copy', from: 'ref', params: { field: 'name' } }],
          },
        },
      }),
    );
    create_(s, { ref: 'p1', name: 'Lomo Saltado Ñoño' });
    expect(s.sheet.rows()[1][2]).toBe('Lomo Saltado Ñoño');
  });
});

// ── 6. currentUser ─────────────────────────────────────────────────────────

describe('currentUser', () => {
  const conUser = () =>
    buildResource_({
      operations: {
        create: { computed: [{ field: 'out', transform: 'currentUser', from: 'name' }] },
      },
    });

  it('escribe el email de la identidad autenticada del request', () => {
    const s = scenario_(conUser());
    create_(s, { ref: 'p1', name: 'Pan' }, { user: { email: 'admin@test' } });
    expect(s.sheet.rows()[1][2]).toBe('admin@test');
  });

  it('sin identidad no escribe nada (vacío no llena destino)', () => {
    const s = scenario_(conUser());
    create_(s, { ref: 'p1', name: 'Pan' });
    expect(s.sheet.rows()[1][2]).toBe('');
  });
});

// ── 7. lookup ──────────────────────────────────────────────────────────────

describe('lookup(resource, field)', () => {
  const conLookup = (params, extra = {}) =>
    buildResource_({
      operations: {
        create: { computed: [{ field: 'out', transform: 'lookup', from: 'ref', params }] },
      },
      ...extra,
    });

  const CLIENTES_SHEET = {
    [CLIENTES]: fakeSheet_([
      ['id', 'nombre'],
      ['c1', 'ACME'],
    ]),
  };

  it('trae el campo del registro destino cuya clave es el `from`', () => {
    const s = scenario_(
      conLookup({ resource: '__comp_clientes__', field: 'nombre' }),
      [],
      CLIENTES_SHEET,
    );
    create_(s, { ref: 'c1', name: 'Pan' });
    expect(s.sheet.rows()[1][2]).toBe('ACME');
  });

  it('clave inexistente ⇒ destino queda vacío', () => {
    const s = scenario_(
      conLookup({ resource: '__comp_clientes__', field: 'nombre' }),
      [],
      CLIENTES_SHEET,
    );
    create_(s, { ref: 'no-existe', name: 'Pan' });
    expect(s.sheet.rows()[1][2]).toBe('');
  });

  it('recurso inexistente ⇒ 500 (referencia rota = desajuste de almacén)', () => {
    const s = scenario_(conLookup({ resource: '__nunca__', field: 'nombre' }), [], CLIENTES_SHEET);
    expect(() => create_(s, { ref: 'c1', name: 'Pan' })).toThrow(/lookup: recurso inexistente/);
  });
});

// ── 8. Declarado por operación: update ─────────────────────────────────────

describe('operations.update.computed', () => {
  // Id ÚNICO por test: este describe pisa `required` de los fields y el map
  // cacheado por id no puede arrastrar el schema anterior.
  let seq = 0;
  const conUpdateSlug = () =>
    buildResource_({
      id: RESOURCE_ID + '_u' + ++seq,
      operations: {
        update: { computed: [{ field: 'out', transform: 'slugify', from: 'name' }] },
      },
    });

  it('rellena el destino VACÍO de una fila heredada, con el origen fusionado', () => {
    const s = scenario_(conUpdateSlug(), [['p1', 'Pan', '']]);
    resourcePut_(s.ss, s.resource, s.map, {
      method: 'PUT',
      params: { ref: 'p1' },
      payload: { name: 'Pan integral' },
      user: { email: 'admin@test' },
    });
    expect(s.sheet.rows()[1][2]).toBe('pan-integral');
  });

  it('usa el nombre GUARDADO cuando el update no lo trae', () => {
    const s = scenario_(conUpdateSlug(), [['p1', 'Focaccia romana', '']]);
    resourcePut_(s.ss, s.resource, s.map, {
      method: 'PUT',
      params: { ref: 'p1' },
      payload: { ref: 'p1' }, // no toca name
    });
    expect(s.sheet.rows()[1][2]).toBe('focaccia-romana');
  });

  it('un destino YA guardado nunca se rederiva (inmutabilidad)', () => {
    const s = scenario_(conUpdateSlug(), [['p1', 'Pan', 'pan']]);
    resourcePut_(s.ss, s.resource, s.map, {
      method: 'PUT',
      params: { ref: 'p1' },
      payload: { name: 'Focaccia' },
    });
    expect(s.sheet.rows()[1][2]).toBe('pan');
  });

  it('el valor derive se valida como el resto del payload (required incluido)', () => {
    const recurso = conUpdateSlug();
    // Sólo `out` es obligatorio: `name` vacío ya no tapa el juicio. Sin
    // origen no hay derive ⇒ out queda vacío ⇒ el required lo pinta.
    recurso.fields[1] = { key: 'name', type: 'text' };
    recurso.fields[2] = { key: 'out', type: 'text', required: true };
    const s = scenario_(recurso, [['p1', '', '']]);
    let error;
    try {
      resourcePut_(s.ss, s.resource, s.map, {
        method: 'PUT',
        params: { ref: 'p1' },
        payload: { ref: 'p1' },
      });
    } catch (err) {
      error = err;
    }
    expect(error, 'esperaba el422 del required').toBeDefined();
    expect(error.apiStatus).toBe(422);
    expect(JSON.stringify(error.apiErrors)).toContain('out');
  });
});

// ── 9. La declaración se juzga al arranque ─────────────────────────────────

describe('validateRegistry_ — computed de update y args', () => {
  it('update.computed con args inválidos o transform desconocido ⇒ issue', () => {
    const recurso = buildResource_({ id: '__comp_valid' });
    REGISTRY.resources.__comp_valid = recurso;
    const issues = () =>
      validateRegistry_().filter((issue) => issue.indexOf('resources.__comp_valid') === 0);
    try {
      recurso.operations = {
        update: { computed: [{ field: 'out', transform: 'lookup', from: 'ref', params: {} }] },
      };
      expect(issues()[0]).toMatch(/falta el argumento obligatorio 'resource'/);

      recurso.operations = {
        update: { computed: [{ field: 'out', transform: 'no-existe', from: 'ref' }] },
      };
      expect(issues()[0]).toMatch(/transform inexistente 'no-existe'/);

      recurso.operations = {
        update: {
          computed: [{ field: 'out', transform: 'copy', from: 'ref', params: { field: 'name' } }],
        },
      };
      expect(issues()).toEqual([]);
    } finally {
      delete REGISTRY.resources.__comp_valid;
    }
    expect(validateRegistry_()).toEqual([]);
  });
});
