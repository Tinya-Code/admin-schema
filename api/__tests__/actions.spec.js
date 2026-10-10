// api/__tests__/actions — B3 · R5.4: acciones de dominio declaradas.
//
// Lo que cubre acá y ninguna otra parte cubre:
//
//  1. **La ruta que el front arma solo** (`descriptors.ts`, R3.12):
//     `POST /admin/<recurso>/<clave>/actions/<nombre>`. Se resuelve desde
//     `resource.actions` — mismo origen que `/admin/schema` — y un recurso
//     **sin acciones** la desconoce (404), no la sirve «por si acaso».
//  2. **Declarativa:** `from` + `set`. `from` es la garantía de que la fila
//     sigue donde el front la vio: si no coincide, **409** (el mundo cambió
//     por debajo de la vista), no un 400 de formulario.
//  3. **Escape hatch §6:** `handler` registrado en `REGISTRY.handlers`, con
//     el mismo contrato que un endpoint y `request.action`/`request.record`
//     para saber sobre qué y por qué corre.
//  4. **`access` de la acción:** el freno REAL, por encima del `write` del
//     recurso que ya aplicó el router.
//  5. **La declaración se juzga al ARRANQUE** (`validateRegistry_()`): las
//     dos formas mutuamente excluyentes, campos inexistentes, `from` sin
//     `set` (¿qué estado protege?), hooks inexistentes y niveles de acceso
//     con typo son ROJO, no un hallazgo en producción.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let originalOpenSpreadsheet;
let originalVerifySession;
let originalHooks;
let seq = 0;

const SHEET = '__actions_sheet__';

/** Colección de 2 filas (status: ready | delivered) con acciones declaradas. */
function fixture_(actions, extra = {}) {
  const id = '__act_' + ++seq;
  const resource = {
    id,
    kind: 'collection',
    sheet: SHEET,
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
    actions,
    fields: [
      { key: 'key', type: 'text', required: true, immutable: true },
      { key: 'name', type: 'text', required: true },
      { key: 'status', type: 'text', required: true },
      { key: 'pin', type: 'text', required: false },
    ],
    ...extra,
  };
  REGISTRY.resources[id] = resource;
  const sheet = fakeSheet_([
    ['key', 'name', 'status', 'pin'],
    ['p1', 'Uno', 'ready', '1234'],
    ['p2', 'Dos', 'delivered', '5678'],
  ]);
  globalThis.openSpreadsheet_ = () => fakeApp_({ [SHEET]: sheet });
  globalThis.ROUTE_TABLE_ = null; // la fixture entra a la tabla
  return { id, resource, sheet, path: `/admin/${id}` };
}

/** POST real por la cadena completa (parseo → auth → rate → dispatch). */
function post_(path, payload = {}) {
  const raw = globalThis.doPost({
    postData: { contents: JSON.stringify({ method: 'POST', path, payload, token: 'tk' }) },
  });
  const body = JSON.parse(raw.getContent());
  return body && body.error ? body.error : body;
}

/** Identidad simulada: la auth real no es lo que se prueba acá. */
function signIn_(role = 'admin') {
  globalThis.verifySession_ = () => ({
    payload: { sid: 'sid-test' },
    user: { active: true, role, id: 'u1', email: 'u@test' },
  });
}

beforeAll(() => {
  loadBackend();
});

beforeEach(() => {
  REGISTRY = globalThis.REGISTRY;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
  originalVerifySession = globalThis.verifySession_;
  originalHooks = globalThis.REGISTRY.hooks;
  signIn_('admin');
});

afterEach(() => {
  globalThis.openSpreadsheet_ = originalOpenSpreadsheet;
  globalThis.verifySession_ = originalVerifySession;
  globalThis.REGISTRY.hooks = originalHooks;
  globalThis.ROUTE_TABLE_ = null;
  for (const id of Object.keys(REGISTRY.resources)) {
    if (id.startsWith('__act_')) delete REGISTRY.resources[id];
  }
});

// ── 1. La ruta ────────────────────────────────────────────────────────────

describe('resolveRoute_ — la ruta de acciones del front', () => {
  it('resuelve <base>/<clave>/actions/<nombre> contra el recurso dueño', () => {
    const fixture = fixture_({ markDelivered: { set: { status: 'delivered' } } });
    const route = globalThis.resolveRoute_(`${fixture.path}/p1/actions/markDelivered`);
    expect(route.kind).toBe('resource');
    expect(route.resource.id).toBe(fixture.id);
    expect(route.action).toBe('markDelivered');
    expect(route.params).toEqual({ key: 'p1' });
  });

  it('una ruta con clave normal NO se confunde con una acción', () => {
    const fixture = fixture_({ markDelivered: { set: { status: 'delivered' } } });
    const route = globalThis.resolveRoute_(`${fixture.path}/p1`);
    expect(route.action).toBeUndefined();
    expect(route.params).toEqual({ key: 'p1' });
  });

  it('un recurso sin `actions` no publica la ruta', () => {
    const fixture = fixture_(undefined);
    expect(globalThis.resolveRoute_(`${fixture.path}/p1/actions/cualquiera`)).toBeNull();
    expect(post_(`${fixture.path}/p1/actions/cualquiera`)).toMatchObject({
      status: 404,
      message: expect.stringContaining('Ruta no encontrada'),
    });
  });

  it('la clave conserva su keyField (slug, no "key" a secas)', () => {
    const fixture = fixture_({ go: { set: { status: 'delivered' } } }, { keyField: 'slug' });
    const route = globalThis.resolveRoute_(`${fixture.path}/mi-slug/actions/go`);
    expect(route.params).toEqual({ slug: 'mi-slug' });
  });
});

// ── 2. Declarativa: from + set ────────────────────────────────────────────

describe('acción declarativa — from protege, set escribe', () => {
  it('con `from` correcto cambia el campo y responde qué cambió', () => {
    const fixture = fixture_({
      markDelivered: { from: ['ready'], set: { status: 'delivered' } },
    });
    const body = post_(`${fixture.path}/p1/actions/markDelivered`);
    expect(body).toEqual({
      action: 'markDelivered',
      affected: 'p1',
      changes: { status: 'delivered' },
    });
    expect(fixture.sheet.rows()[1]).toEqual(['p1', 'Uno', 'delivered', '1234']);
  });

  it('con `from` que no coincide responde 409 y la fila NO se toca', () => {
    const fixture = fixture_({
      markDelivered: { from: ['ready'], set: { status: 'delivered' } },
    });
    expect(post_(`${fixture.path}/p2/actions/markDelivered`)).toMatchObject({
      status: 409,
      message: expect.stringContaining("'delivered'"),
    });
    expect(fixture.sheet.rows()[2]).toEqual(['p2', 'Dos', 'delivered', '5678']);
  });

  it('sin `from` la acción corre sobre cualquier fila', () => {
    const fixture = fixture_({ rename: { set: { name: 'Renombrado' } } });
    expect(post_(`${fixture.path}/p2/actions/rename`).affected).toBe('p2');
    expect(fixture.sheet.rows()[2][1]).toBe('Renombrado');
  });

  it('una acción no puede «limpiar» lo que no declara', () => {
    const fixture = fixture_({ markDelivered: { set: { status: 'delivered' } } });
    post_(`${fixture.path}/p1/actions/markDelivered`);
    expect(fixture.sheet.rows()[1]).toEqual(['p1', 'Uno', 'delivered', '1234']); // pin intacto
  });

  it('acción inexistente ⇒ 404 · fila inexistente ⇒ 404', () => {
    const fixture = fixture_({ go: { set: { status: 'delivered' } } });
    expect(post_(`${fixture.path}/p1/actions/no-existe`)).toMatchObject({
      status: 404,
      message: expect.stringContaining("No existe la acción 'no-existe'"),
    });
    expect(post_(`${fixture.path}/p99/actions/go`)).toMatchObject({
      status: 404,
      message: expect.stringContaining('No existe: p99'),
    });
  });

  it('un singleton no publica la ruta de acciones', () => {
    const fixture = fixture_({ go: { set: { status: 'delivered' } } }, { kind: 'singleton' });
    // Un singleton no tiene clave: la ruta no se registra y el front recibe
    // 404 de ruta, que es lo honesto (no un 400 fingiendo que existe).
    expect(post_(`${fixture.path}/p1/actions/go`)).toMatchObject({
      status: 404,
      message: expect.stringContaining('Ruta no encontrada'),
    });
    // Y el motor, por si alguien lo invoca a pelo, también se niega.
    expect(() =>
      globalThis.dispatchAction_(fixture.resource, { action: 'go', params: {}, payload: {} }),
    ).toThrow(/Un singleton no tiene acciones/);
  });

  it('los hooks de la acción corren DESPUÉS del cambio y ven el registro ya escrito', () => {
    const calls = [];
    REGISTRY.capabilities.hooks.__actHook = () => undefined;
    REGISTRY.hooks = Object.assign({}, REGISTRY.hooks, {
      __actHook: (ctx) => calls.push(ctx),
    });
    const fixture = fixture_({
      markDelivered: { from: ['ready'], set: { status: 'delivered' }, hooks: ['__actHook'] },
    });
    post_(`${fixture.path}/p1/actions/markDelivered`);
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe('action:markDelivered');
    expect(calls[0].key).toBe('p1');
    expect(calls[0].payload.status).toBe('delivered'); // el cambio, no el previo
    delete REGISTRY.capabilities.hooks.__actHook;
  });

  it('un hook que revienta se loguea y NO tumba el cambio ya escrito', () => {
    REGISTRY.capabilities.hooks.__boom = () => undefined;
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    REGISTRY.hooks = Object.assign({}, REGISTRY.hooks, {
      __boom: () => {
        throw new Error('rompe');
      },
    });
    try {
      const fixture = fixture_({ go: { set: { status: 'delivered' }, hooks: ['__boom'] } });
      expect(post_(`${fixture.path}/p1/actions/go`).affected).toBe('p1');
      expect(fixture.sheet.rows()[1][2]).toBe('delivered');
      expect(errors.join('')).toContain('rompe');
    } finally {
      console.error = originalError;
      delete REGISTRY.capabilities.hooks.__boom;
    }
  });
});

// ── 3. Escape hatch: handler registrado ───────────────────────────────────

describe('acción con `handler` — escape hatch §6', () => {
  it('corre la función registrada con payload, acción y registro', () => {
    const seen = [];
    REGISTRY.handlers.__actHandler = (payload, request) => {
      seen.push({ payload, action: request.action, record: request.record });
      return { pin: 'nuevo' };
    };
    const fixture = fixture_({ resendPin: { handler: '__actHandler' } });
    try {
      expect(post_(`${fixture.path}/p1/actions/resendPin`, { reason: 'test' })).toEqual({
        action: 'resendPin',
        affected: 'p1',
        handler: '__actHandler',
        result: { pin: 'nuevo' },
      });
      expect(seen[0].payload).toEqual({ reason: 'test' });
      expect(seen[0].action).toBe('resendPin');
      expect(seen[0].record).toMatchObject({ key: 'p1', status: 'ready' });
    } finally {
      delete REGISTRY.handlers.__actHandler;
    }
  });

  it('un handler declarado pero no registrado es 500, no un silencio', () => {
    const fixture = fixture_({ resendPin: { handler: '__nuncaRegistrado' } });
    expect(post_(`${fixture.path}/p1/actions/resendPin`)).toMatchObject({
      status: 500,
      message: expect.stringContaining('Función no disponible: __nuncaRegistrado'),
    });
  });
});

// ── 4. access de la acción ────────────────────────────────────────────────

describe('`access` por acción — el freno real', () => {
  it('una acción más exigente que el recurso corta con 401 sin sesión', () => {
    // Recurso público (el router deja pasar) + acción que pide rol.
    const fixture = fixture_(
      { exportAll: { set: { status: 'delivered' }, access: 'role:staff' } },
      { policies: { access: { read: 'public', write: 'public' } } },
    );
    globalThis.verifySession_ = () => null;
    expect(post_(`${fixture.path}/p1/actions/exportAll`)).toMatchObject({
      status: 401,
      message: expect.stringContaining('No autorizado'),
    });
  });

  it('una acción más exigente que el recurso corta con 403 (no401)', () => {
    // Éste es el caso que SÓLO puede frenar `dispatchAction_`: el recurso
    // pide sesión (el router deja pasar) y la acción pide rol. Un 401 acá
    // cerraría la sesión al usuario; el §4.5 manda 403.
    const fixture = fixture_(
      { exportAll: { set: { status: 'delivered' }, access: 'role:staff' } },
      { policies: { access: { read: 'session', write: 'session' } } },
    );
    signIn_('');
    expect(post_(`${fixture.path}/p1/actions/exportAll`)).toMatchObject({
      status: 403,
      message: expect.stringContaining('Prohibido'),
    });
    signIn_('staff');
    expect(post_(`${fixture.path}/p1/actions/exportAll`).affected).toBe('p1');
  });

  it('con el rol suficiente la acción corre', () => {
    const fixture = fixture_(
      { exportAll: { set: { status: 'delivered' }, access: 'role:staff' } },
      { policies: { access: { read: 'public', write: 'public' } } },
    );
    signIn_('staff');
    expect(post_(`${fixture.path}/p1/actions/exportAll`).affected).toBe('p1');
  });
});

// ── 5. La declaración se juzga al ARRANQUE ────────────────────────────────

describe('validateRegistry_ — la declaración de `actions`', () => {
  const base = () => ({
    id: '__act_valid',
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
      { key: 'status', type: 'text', required: true },
    ],
  });

  function issuesOf_(resource) {
    REGISTRY.resources.__act_valid = resource;
    try {
      return globalThis
        .validateRegistry_()
        .filter((issue) => issue.indexOf('resources.__act_valid') === 0);
    } finally {
      delete REGISTRY.resources.__act_valid;
    }
  }

  it('la declaración real sigue limpia', () => {
    expect(globalThis.validateRegistry_()).toEqual([]);
  });

  it('las dos formas son mutuamente excluyentes', () => {
    expect(
      issuesOf_({ ...base(), actions: { x: { set: { status: 'a' }, handler: 'h' } } })[0],
    ).toMatch(/no ambas ni ninguna/);
    expect(issuesOf_({ ...base(), actions: { x: {} } })[0]).toMatch(/no ambas ni ninguna/);
    expect(issuesOf_({ ...base(), actions: { x: { set: { status: 'delivered' } } } })).toEqual([]);
    expect(issuesOf_({ ...base(), actions: { x: { handler: 'h' } } })).toEqual([]);
  });

  it('`set` debe apuntar a campos que existen', () => {
    expect(issuesOf_({ ...base(), actions: { x: { set: { nope: 1 } } } })[0]).toMatch(
      /set\.nope: campo inexistente/,
    );
    expect(issuesOf_({ ...base(), actions: { x: { set: {} } } })[0]).toMatch(
      /set: debe ser un objeto con al menos un campo/,
    );
  });

  it('`from` sólo protege UN campo y necesita `set`', () => {
    expect(
      issuesOf_({
        ...base(),
        actions: { x: { from: ['a'], set: { status: 'a', name: 'b' } } },
      })[0],
    ).toMatch(/'from' sólo aplica con UN campo en set/);
    expect(issuesOf_({ ...base(), actions: { x: { handler: 'h', from: ['a'] } } })[0]).toMatch(
      /'from' sin 'set'/,
    );
    expect(
      issuesOf_({ ...base(), actions: { x: { from: 'ready', set: { status: 'a' } } } })[0],
    ).toMatch(/from: debe ser un array/);
    expect(
      issuesOf_({ ...base(), actions: { x: { from: [{ a: 1 }], set: { status: 'a' } } } })[0],
    ).toMatch(/valores deben ser escalares/);
    expect(
      issuesOf_({ ...base(), actions: { x: { from: ['ready'], set: { status: 'a' } } } }),
    ).toEqual([]);
  });

  it('hooks inexistentes y niveles de acceso con typo son rojos', () => {
    expect(
      issuesOf_({ ...base(), actions: { x: { set: { status: 'a' }, hooks: ['__noExiste'] } } })[0],
    ).toMatch(/hook inexistente '__noExiste'/);
    expect(
      issuesOf_({ ...base(), actions: { x: { set: { status: 'a' }, access: 'rol:editor' } } })[0],
    ).toMatch(/nivel de access inválido/);
    expect(
      issuesOf_({ ...base(), actions: { x: { set: { status: 'a' }, access: 'role:staff' } } }),
    ).toEqual([]);
  });

  it('el nombre de la acción es un segmento de URL saneable', () => {
    expect(
      issuesOf_({ ...base(), actions: { 'mal nombre': { set: { status: 'a' } } } })[0],
    ).toMatch(/nombre inválido/);
    expect(issuesOf_({ ...base(), actions: { 'con/slash': { set: { status: 'a' } } } })[0]).toMatch(
      /nombre inválido/,
    );
    expect(issuesOf_({ ...base(), actions: [] })[0]).toMatch(/debe ser un objeto de acciones/);
  });
});
