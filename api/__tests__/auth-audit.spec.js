// api/__tests__/auth-audit.spec.js — Traza de auth en `_audit_log` (R2.14).
//
// Lo que éste archivo cubre y ninguna otra parte del sistema cubre:
//
//  1. **Los cuatro eventos de auth.md §4.6 existen y se escriben**:
//     `login_ok`, `login_fail`, `logout`, `forbidden`.
//  2. **Nunca se escribe una credencial.** No el token emitido, no la
//     contraseña que se acaba de probar, no `pass_hash` ni `pass_salt`.
//     Si la traza guardara eso, el propio registro sería la brecha.
//  3. **La auditoría no manda sobre el login.** Si falta la hoja o
//     `openSpreadsheet_` revienta, el login sigue contestando igual: perder
//     una traza no es un error de usuario, y convertirlo en 500 le
//     regalaría a cualquiera una forma de cortar el login a distancia.
//
// Usa el doble fiel de `Utilities` y el SHA de prueba de `_auth-fixtures`,
// y las hojas en memoria de `_sheets` — éste es el único spec de auth que
// puede dejar `readSheetData_` sin parchear, porque `fakeSheet_` habla el
// mismo protocolo que hojas reales.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeSha, realUtilities } from './_auth-fixtures.js';
import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

const SECRET = 'secreto-de-prueba-1234567890';
const PASS = 'secreta-de-ana';

const USERS_HEADERS = [
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
];

// Columnas exactas de AUX_SHEETS._audit_log (schema/05).
const AUDIT_HEADERS = ['timestamp', 'actor', 'action', 'entity', 'entity_key', 'summary'];

let orig;
let store;
let usersSheet;
let auditSheet;

function userObj(overrides = {}) {
  const u = {
    id: 'u_1',
    email: 'ana@x.com',
    name: 'Ana',
    role: 'admin',
    active: true,
    token_version: 1,
    pass_hash: '',
    pass_salt: 'sal-fija-0123456789',
    last_login_at: '',
    created_at: '2026-01-01 00:00:00',
    ...overrides,
  };
  return u;
}

function userRow(overrides = {}) {
  const u = userObj(overrides);
  u.pass_hash = globalThis.kdfHash_(u.pass_hash || PASS, u.pass_salt, 1000);
  return USERS_HEADERS.map((h) => u[h]);
}

/** Filas de `_audit_log` SIN la cabecera. */
function auditRows() {
  return auditSheet.rows().slice(1);
}

function patchEnv() {
  store = { AUTH_SECRET: SECRET, KDF_ITERATIONS: '1000' };
  globalThis.Props.get = (name) => (name in store ? store[name] : null);
  globalThis.Props.setAll = (values) => Object.assign(store, values);
  globalThis.Props.hashText = fakeSha;
  globalThis.Utilities = realUtilities;

  usersSheet = fakeSheet_([USERS_HEADERS, userRow()]); // userRow necesita hashText ya parcheado
  auditSheet = fakeSheet_([AUDIT_HEADERS]);
  globalThis.openSpreadsheet_ = () => fakeApp_({ _users: usersSheet, _audit_log: auditSheet });
}

beforeAll(() => {
  loadBackend();
});

beforeEach(() => {
  orig = {
    get: globalThis.Props.get,
    setAll: globalThis.Props.setAll,
    hashText: globalThis.Props.hashText,
    Utilities: globalThis.Utilities,
    openSpreadsheet_: globalThis.openSpreadsheet_,
  };
  patchEnv();
});

afterEach(() => {
  Object.assign(globalThis, orig);
  vi.restoreAllMocks();
});

describe('R2.14 — los cuatro eventos (auth.md §4.6)', () => {
  it('login_ok deja una fila con actor = id y la cuenta como llave', () => {
    const out = globalThis.REGISTRY.handlers.handleAuthLogin(
      { email: 'ana@x.com', password: PASS },
      { path: '/auth/login' },
    );

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    const [timestamp, actor, action, entity, entityKey, summary] = rows[0];
    expect(String(timestamp)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(actor).toBe('u_1');
    expect(action).toBe('login_ok');
    expect(entity).toBe('auth');
    expect(entityKey).toBe('ana@x.com');
    expect(summary).toBe('login correcto');
    expect(out.token).toBeTruthy();
  });

  it('login_fail deja una fila aunque el email no exista (actor anon)', () => {
    expect(() =>
      globalThis.REGISTRY.handlers.handleAuthLogin(
        { email: 'nadie@x.com', password: PASS },
        { path: '/auth/login' },
      ),
    ).toThrow();

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('anon'); // sin id: no hay cuenta
    expect(rows[0][2]).toBe('login_fail');
    expect(rows[0][4]).toBe('nadie@x.com');
  });

  it('login_fail con usuario real lleva SU id como actor', () => {
    expect(() =>
      globalThis.REGISTRY.handlers.handleAuthLogin(
        { email: 'ana@x.com', password: 'mala' },
        { path: '/auth/login' },
      ),
    ).toThrow();

    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0][1]).toBe('u_1');
    expect(auditRows()[0][2]).toBe('login_fail');
  });

  it('logout deja una fila', () => {
    globalThis.REGISTRY.handlers.handleAuthLogout({}, { user: userObj() });

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('u_1');
    expect(rows[0][2]).toBe('logout');
    expect(rows[0][4]).toBe('ana@x.com');
    expect(rows[0][5]).toBe('sesión cerrada');
  });

  it('forbidden deja una fila y sigue tirando 403', () => {
    const identity = userObj({ role: 'editor' });
    let error;
    try {
      globalThis.requireAccess_(identity, 'role:admin');
    } catch (e) {
      error = e;
    }
    expect(error.apiStatus).toBe(403);
    expect(error.apiCode).toBe('FORBIDDEN');

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('u_1');
    expect(rows[0][2]).toBe('forbidden');
    expect(rows[0][4]).toBe('ana@x.com');
    expect(rows[0][5]).toContain('role:admin');
  });
});

describe('R2.14 — nunca tokens ni contraseñas', () => {
  /** Recorre TODAS las celdas escritas y devuelve las que contengan `needle`. */
  function cellsContaining(needle) {
    return auditRows()
      .flatMap((row) => row)
      .filter((cell) => String(cell).includes(needle));
  }

  it('el token emitido no aparece en la traza', () => {
    const out = globalThis.REGISTRY.handlers.handleAuthLogin(
      { email: 'ana@x.com', password: PASS },
      { path: '/auth/login' },
    );
    const [body, signature] = out.token.split('.');

    expect(auditRows()).toHaveLength(1);
    expect(cellsContaining(out.token)).toHaveLength(0);
    expect(cellsContaining(body)).toHaveLength(0);
    expect(cellsContaining(signature)).toHaveLength(0);
  });

  it('la contraseña no aparece en login_ok ni en login_fail', () => {
    globalThis.REGISTRY.handlers.handleAuthLogin(
      { email: 'ana@x.com', password: PASS },
      { path: '/auth/login' },
    );
    expect(() =>
      globalThis.REGISTRY.handlers.handleAuthLogin(
        { email: 'nadie@x.com', password: PASS },
        { path: '/auth/login' },
      ),
    ).toThrow();

    expect(auditRows()).toHaveLength(2);
    expect(cellsContaining(PASS)).toHaveLength(0);
  });

  it('ni pass_hash ni pass_salt se cuelan en el resumen', () => {
    globalThis.REGISTRY.handlers.handleAuthLogin(
      { email: 'ana@x.com', password: PASS },
      { path: '/auth/login' },
    );

    const stored = usersSheet.rows()[1];
    const hash = stored[USERS_HEADERS.indexOf('pass_hash')];
    const salt = stored[USERS_HEADERS.indexOf('pass_salt')];
    expect(hash).toBeTruthy(); // hay de verdad qué filtrar

    expect(auditRows()).toHaveLength(1);
    expect(cellsContaining(hash)).toHaveLength(0);
    expect(cellsContaining(salt)).toHaveLength(0);
  });
});

describe('R2.14 — la auditoría nunca manda sobre el login', () => {
  it('hoja de auditoría ausente ⇒ el login sigue contestando', () => {
    globalThis.openSpreadsheet_ = () =>
      fakeApp_({ _users: fakeSheet_([USERS_HEADERS, userRow()]) });

    const out = globalThis.REGISTRY.handlers.handleAuthLogin(
      { email: 'ana@x.com', password: PASS },
      { path: '/auth/login' },
    );
    expect(out.token).toBeTruthy();
    expect(out.user.email).toBe('ana@x.com');
  });

  /** Sólo la lectura de `_audit_log` revienta: `_users` sigue andando. */
  function openWithBrokenAudit_() {
    const ss = fakeApp_({ _users: usersSheet });
    return {
      getSheetByName: (name) => {
        if (name === '_audit_log') throw new Error('sin credenciales de Drive');
        return ss.getSheetByName(name);
      },
    };
  }

  it('si la traza revienta, el login sigue contestando', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.openSpreadsheet_ = openWithBrokenAudit_;

    const out = globalThis.REGISTRY.handlers.handleAuthLogin(
      { email: 'ana@x.com', password: PASS },
      { path: '/auth/login' },
    );
    expect(out.token).toBeTruthy();
    expect(spy).toHaveBeenCalled(); // el fallo queda registrado, no silenciado

    expect(() =>
      globalThis.REGISTRY.handlers.handleAuthLogin(
        { email: 'nadie@x.com', password: PASS },
        { path: '/auth/login' },
      ),
    ).toThrow(); // y el fallo de credenciales sigue siendo 401, no 500
  });

  it('un 401 no se convierte en 500 aunque la traza falle', () => {
    globalThis.openSpreadsheet_ = openWithBrokenAudit_;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    let error;
    try {
      globalThis.REGISTRY.handlers.handleAuthLogin(
        { email: 'ana@x.com', password: 'mala' },
        { path: '/auth/login' },
      );
    } catch (e) {
      error = e;
    }
    expect(error.apiStatus).toBe(401);
    expect(error.apiCode).toBe('AUTH_INVALID');
  });
});
