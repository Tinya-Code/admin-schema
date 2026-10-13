// api/__tests__/auth-endpoints.spec.js — Handlers y sobre de sesión (R2.5).
//
// Lo que éste archivo cubre y ninguna otra parte del sistema cubre:
//
//  1. **El sobre de respuesta es ADITIVO** (auth.md §4.5 / D10-5): el
//     `code` aparece SÓLO cuando hay uno de los cinco códigos de sesión.
//     Un error normal sigue saliendo exactamente igual que siempre — y
//     jamás aparece `{ ok: false }`.
//  2. **El login es opaco.** Email inexistente, contraseña errónea y cuenta
//     desactivada devuelven el MISMO estado, el MISMO código y el MISMO
//     mensaje. Si alguno se diferenciara, el endpoint pasaría a ser un
//     comprobador de direcciones de correo.
//  3. **Ninguna respuesta de sesión filtra `pass_hash`, `pass_salt` ni
//     `token_version`** (R2.17). `publicUser_` es una whitelist, no un
//     `delete`: si alguien añade una columna a `_users`, no sale sola.
//  4. **`authMe`/`authLogout` no verifican nada por su cuenta.** Esa es la
//     cadena de §3.4 (R2.6), que pone `request.user`. Aquí sólo se prueba
//     su contrato: sin identidad resuelta ⇒ 401.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeSha, realUtilities } from './_auth-fixtures.js';
import { loadBackend } from './_harness.js';

const SECRET = 'secreto-de-prueba-1234567890';

// Doble fiel de Utilities + SHA de prueba: compartidos con
// `auth-audit.spec.js` (R2.14) y con lo que venga. La ruta de login
// sólo es probable con un HMAC y un base64url reales.

const HEADERS = [
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

const PASS = 'secreta-de-ana';

let orig;
let store;
let users; // filas actuales de _users (en formato `values`)

function userRow(overrides = {}) {
  const salt = 'sal-fija-0123456789';
  const u = {
    id: 'u_1',
    email: 'ana@x.com',
    name: 'Ana',
    role: 'admin',
    active: true,
    token_version: 1,
    pass_hash: '',
    pass_salt: salt,
    last_login_at: '',
    created_at: '2026-01-01 00:00:00',
    ...overrides,
  };
  u.pass_hash = globalThis.kdfHash_(u.pass_hash || PASS, u.pass_salt, 1000);
  return HEADERS.map((h) => u[h]);
}

function patchEnv() {
  store = { AUTH_SECRET: SECRET, KDF_ITERATIONS: '1000', ADMIN_TOKEN_HASH: fakeSha('token-bueno') };
  globalThis.Props.get = (name) => (name in store ? store[name] : null);
  globalThis.Props.setAll = (values) => Object.assign(store, values);
  globalThis.Props.hashText = fakeSha;
  globalThis.Utilities = realUtilities;
  globalThis.openSpreadsheet_ = () => ({ getSheetByName: (n) => (n === '_users' ? {} : null) });
  globalThis.readSheetData_ = () => ({
    headers: HEADERS,
    rows: users.map((v, i) => ({ at: i + 2, values: v })),
    sheet: {},
  });
  globalThis.writeRowsBlock_ = (_sheet, _headers, rows) => {
    users = rows;
  };
  globalThis.authAudit_ = () => true;
}

beforeAll(() => {
  loadBackend();
});

it('logout-all incrementa token_version y declara el límite de caché', () => {
  const handler = globalThis.REGISTRY.handlers.handleAuthLogoutAll;
  const result = handler({}, { user: { id: 'u_1', email: 'ana@x.com', active: true } });

  expect(result).toEqual({
    sessionsRevoked: true,
    effectiveWithinSeconds: globalThis.SESSION_SNAPSHOT_TTL_S,
  });
  expect(users[0][HEADERS.indexOf('token_version')]).toBe(2);
});

it('logout-all rechaza sesión sin identidad activa', () => {
  const handler = globalThis.REGISTRY.handlers.handleAuthLogoutAll;
  const error = throws(() => handler({}, { user: { id: 'u_1', active: false } }));
  expect(error.apiCode).toBe('AUTH_REQUIRED');
  expect(users[0][HEADERS.indexOf('token_version')]).toBe(1);
});

it('logout-all falla si token_version está vacío en la hoja', () => {
  users[0][HEADERS.indexOf('token_version')] = '';
  const handler = globalThis.REGISTRY.handlers.handleAuthLogoutAll;
  const error = throws(() =>
    handler({}, { user: { id: 'u_1', email: 'ana@x.com', active: true } }),
  );
  expect(error.apiStatus).toBe(500);
});

beforeEach(() => {
  orig = {
    get: globalThis.Props.get,
    setAll: globalThis.Props.setAll,
    hashText: globalThis.Props.hashText,
    Utilities: globalThis.Utilities,
    openSpreadsheet_: globalThis.openSpreadsheet_,
    readSheetData_: globalThis.readSheetData_,
    writeRowsBlock_: globalThis.writeRowsBlock_,
    withLock_: globalThis.withLock_,
    authAudit_: globalThis.authAudit_,
    CacheService: globalThis.CacheService,
  };
  patchEnv(); // ANTES de userRow_: necesita Props.hashText ya parcheado
  users = [userRow()];
});

afterEach(() => {
  Object.assign(globalThis, orig);
  vi.restoreAllMocks();
});

/** Lanza `fn` y devuelve la excepción (lanza si no hubo). */
function throws(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('se esperaba una excepción y no se lanzó ninguna');
}

/** Decodifica la respuesta de `errorResponse_`/`respondError_`. */
function decode(output) {
  return JSON.parse(output.getContent());
}

// ── 1. Declaración (B2) ───────────────────────────────────────────────────

describe('Declaración de los endpoints de auth (R2.5)', () => {
  it('authLogin declara route, method, access: public, limits e input', () => {
    const ep = globalThis.REGISTRY.endpoints.authLogin;
    expect(ep).toBeDefined();
    expect(ep.route).toBe('/auth/login');
    expect(ep.method).toBe('POST');
    expect(ep.access).toBe('public');
    // R2.13: dos ventanas en la misma declaración — la global de §4.3 y la
    // de fallos por cuenta de §4.6. read/write siguen igual que antes.
    expect(ep.limits).toEqual({ read: '10/min', write: '10/min', account: '5/15min' });
    expect(ep.handler).toBe('handleAuthLogin');
    expect(ep.input.email).toEqual({ type: 'email' });
    expect(ep.input.password).toEqual({ type: 'secret' });
  });

  it('authMe y authLogout declaran route y access: session', () => {
    const me = globalThis.REGISTRY.endpoints.authMe;
    const out = globalThis.REGISTRY.endpoints.authLogout;
    expect(me.route).toBe('/auth/me');
    expect(me.method).toBe('POST');
    expect(me.access).toBe('session');
    expect(me.handler).toBe('handleAuthMe');
    expect(out.route).toBe('/auth/logout');
    expect(out.method).toBe('POST');
    expect(out.access).toBe('session');
    expect(out.handler).toBe('handleAuthLogout');
  });

  it('authLogoutAll declara la invalidación persistente de sesiones', () => {
    const endpoint = globalThis.REGISTRY.endpoints.authLogoutAll;
    expect(endpoint.route).toBe('/auth/logout-all');
    expect(endpoint.method).toBe('POST');
    expect(endpoint.access).toBe('session');
    expect(endpoint.handler).toBe('handleAuthLogoutAll');
    expect(endpoint.output).toEqual({
      sessionsRevoked: { type: 'boolean', required: true },
      effectiveWithinSeconds: { type: 'number', required: true },
    });
  });

  it('los tres handlers están registrados en REGISTRY.handlers', () => {
    expect(typeof globalThis.REGISTRY.handlers.handleAuthLogin).toBe('function');
    expect(typeof globalThis.REGISTRY.handlers.handleAuthMe).toBe('function');
    expect(typeof globalThis.REGISTRY.handlers.handleAuthLogout).toBe('function');
    expect(typeof globalThis.REGISTRY.handlers.handleAuthLogoutAll).toBe('function');
  });

  it('ningún handler de auth es sólo ejecutable desde el editor', () => {
    // Si lo fuera, `validate-registry.js` rechazaría el arranque completo.
    for (const name of [
      'handleAuthLogin',
      'handleAuthMe',
      'handleAuthLogout',
      'handleAuthLogoutAll',
    ]) {
      expect(globalThis.EDITOR_ONLY_FNS).not.toContain(name);
    }
  });
});

// ── 2. Login opaco ────────────────────────────────────────────────────────

describe('POST /auth/login (R2.5)', () => {
  it('credenciales válidas → { token, user } y el token verifica', () => {
    const res = globalThis.REGISTRY.handlers.handleAuthLogin({
      email: 'ana@x.com',
      password: PASS,
    });

    expect(typeof res.token).toBe('string');
    expect(res.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const verified = globalThis.verifyToken_(res.token);
    expect(verified.ok).toBe(true);
    expect(verified.payload.sub).toBe('u_1');
    expect(verified.payload.sid).toMatch(/^ses_/);

    expect(res.user.email).toBe('ana@x.com');
    expect(res.user.role).toBe('admin');
  });

  it('la respuesta NUNCA lleva pass_hash, pass_salt ni token_version', () => {
    const res = globalThis.REGISTRY.handlers.handleAuthLogin({
      email: 'ana@x.com',
      password: PASS,
    });
    const serializado = JSON.stringify(res);
    expect(serializado).not.toContain('pass_hash');
    expect(serializado).not.toContain('pass_salt');
    expect(serializado).not.toContain('token_version');
    expect(res.user).not.toHaveProperty('token_version');
  });

  it('el recurso users (R7.6) es inofensivo: sólo admin y sin secretos (§8)', () => {
    // §8 pide que NINGUNA respuesta lleve `pass_hash`, `pass_salt` ni
    // `token_version`. Los endpoints de sesión ya están blanqueados por
    // `publicUser_` (probado arriba). Desde R7.6 `users` SÍ es un recurso
    // (gestión de usuarios, auth.md §4.2), pero sus secretos son campos
    // `secret`: se quitan de cada respuesta SIEMPRE (24-crud), ni siquiera
    // aparecen en /admin/schema (schema.js) y nombrarlos en listProjection
    // es rojo al arranque (validate-registry).
    const resources = globalThis.REGISTRY.resources || {};
    expect(Object.keys(resources)).not.toContain('_users');

    const users = resources.users;
    expect(users, 'falta el recurso users (R7.6)').toBeTruthy();
    expect(users.sheet).toBe('_users');
    expect(users.policies.access).toEqual({ read: 'role:admin', write: 'role:admin' });
    const secretKeys = users.fields.filter((f) => f.type === 'secret').map((f) => f.key);
    expect(secretKeys.sort()).toEqual(['pass_hash', 'pass_salt', 'token_version']);

    // Ningún otro recurso toca hojas internas.
    for (const id of Object.keys(resources)) {
      if (id === 'users') continue;
      expect(String(resources[id].sheet || '')).not.toMatch(/^_/);
    }
  });

  it('email inexistente → 401 AUTH_INVALID con el mensaje genérico', () => {
    const e = throws(() =>
      globalThis.REGISTRY.handlers.handleAuthLogin({ email: 'nobody@x.com', password: PASS }),
    );
    expect(e.apiStatus).toBe(401);
    expect(e.apiCode).toBe('AUTH_INVALID');
    expect(e.message).toBe('Credenciales inválidas');
  });

  it('contraseña errónea → EXACTAMENTE el mismo estado, código y mensaje', () => {
    const e = throws(() =>
      globalThis.REGISTRY.handlers.handleAuthLogin({ email: 'ana@x.com', password: 'otra' }),
    );
    expect(e.apiStatus).toBe(401);
    expect(e.apiCode).toBe('AUTH_INVALID');
    expect(e.message).toBe('Credenciales inválidas');
  });

  it('cuenta desactivada → EXACTAMENTE el mismo estado, código y mensaje', () => {
    users = [userRow({ active: false })];
    const e = throws(() =>
      globalThis.REGISTRY.handlers.handleAuthLogin({ email: 'ana@x.com', password: PASS }),
    );
    expect(e.apiStatus).toBe(401);
    expect(e.apiCode).toBe('AUTH_INVALID');
    expect(e.message).toBe('Credenciales inválidas');
  });

  it('el email se compara sin distinguir mayúsculas', () => {
    const res = globalThis.REGISTRY.handlers.handleAuthLogin({
      email: '  ANA@X.COM ',
      password: PASS,
    });
    expect(res.user.email).toBe('ana@x.com');
  });

  it('falta email → 422 con la ruta en errors', () => {
    const e = throws(() => globalThis.REGISTRY.handlers.handleAuthLogin({ password: PASS }));
    expect(e.apiStatus).toBe(422);
    expect(e.apiErrors.some((x) => x.path === 'email')).toBe(true);
  });

  it('falta password → 422 con la ruta en errors', () => {
    const e = throws(() => globalThis.REGISTRY.handlers.handleAuthLogin({ email: 'ana@x.com' }));
    expect(e.apiStatus).toBe(422);
    expect(e.apiErrors.some((x) => x.path === 'password')).toBe(true);
  });

  it('hoja _users inexistente → 500 (fallo de configuración, no de credencial)', () => {
    globalThis.openSpreadsheet_ = () => ({ getSheetByName: () => null });
    const e = throws(() =>
      globalThis.REGISTRY.handlers.handleAuthLogin({ email: 'ana@x.com', password: PASS }),
    );
    expect(e.apiStatus).toBe(500);
  });
});

// ── 3. /auth/me y /auth/logout ────────────────────────────────────────────

describe('POST /auth/me y /auth/logout (R2.5)', () => {
  const activo = { id: 'u_1', email: 'ana@x.com', role: 'admin', active: true };

  it('/auth/me sin identidad resuelta → 401 AUTH_REQUIRED', () => {
    const e = throws(() => globalThis.REGISTRY.handlers.handleAuthMe({}, {}));
    expect(e.apiStatus).toBe(401);
    expect(e.apiCode).toBe('AUTH_REQUIRED');
  });

  it('/auth/me devuelve la proyección pública del usuario', () => {
    const res = globalThis.REGISTRY.handlers.handleAuthMe({}, { user: activo });
    expect(res.user).toEqual({ id: 'u_1', email: 'ana@x.com', role: 'admin', active: true });
    expect(JSON.stringify(res)).not.toContain('pass_hash');
    expect(JSON.stringify(res)).not.toContain('pass_salt');
    expect(JSON.stringify(res)).not.toContain('token_version');
  });

  it('/auth/me con usuario inactivo → 401', () => {
    const e = throws(() =>
      globalThis.REGISTRY.handlers.handleAuthMe({}, { user: { ...activo, active: false } }),
    );
    expect(e.apiStatus).toBe(401);
  });

  it('/auth/logout sin identidad resuelta → 401 AUTH_REQUIRED', () => {
    const e = throws(() => globalThis.REGISTRY.handlers.handleAuthLogout({}, {}));
    expect(e.apiStatus).toBe(401);
    expect(e.apiCode).toBe('AUTH_REQUIRED');
  });

  it('/auth/logout con sesión → { loggedOut: true }', () => {
    expect(globalThis.REGISTRY.handlers.handleAuthLogout({}, { user: activo })).toEqual({
      loggedOut: true,
    });
  });
});

// ── 4. El sobre de respuesta (§4.5) ───────────────────────────────────────

describe('Códigos de sesión en el envelope (R2.5)', () => {
  it('sin token en ruta protegida → 401 AUTH_REQUIRED', () => {
    const e = throws(() => globalThis.verifySession_(''));
    expect(e.apiStatus).toBe(401);
    expect(e.apiCode).toBe('AUTH_REQUIRED');
  });

  it('token inválido → 401 AUTH_INVALID (se distingue de «no me diste»)', () => {
    const e = throws(() => globalThis.verifySession_('token-malo'));
    expect(e.apiStatus).toBe(401);
    expect(e.apiCode).toBe('AUTH_INVALID');
  });

  it('D21-C: el token admin antiguo ya no existe en ninguna parte', () => {
    expect(globalThis.requireAdmin_).toBeUndefined();
    expect(globalThis.Props.hashToken).toBeUndefined();
    expect(globalThis.rotarToken).toBeUndefined();
    const names = globalThis.PROP_MANIFEST.map((e) => e.name);
    expect(names).not.toContain('ADMIN_TOKEN_HASH');
  });

  it('sin identidad → 401 AUTH_REQUIRED', () => {
    const e = throws(() => globalThis.requireAccess_(null, 'session'));
    expect(e.apiStatus).toBe(401);
    expect(e.apiCode).toBe('AUTH_REQUIRED');
  });

  it('identidad inactiva → 401 AUTH_INVALID', () => {
    const e = throws(() => globalThis.requireAccess_({ active: false, role: 'admin' }, 'session'));
    expect(e.apiStatus).toBe(401);
    expect(e.apiCode).toBe('AUTH_INVALID');
  });

  it('staff en role:admin → 403 FORBIDDEN (sin cerrar sesión)', () => {
    const e = throws(() =>
      globalThis.requireAccess_({ active: true, role: 'staff' }, 'role:admin'),
    );
    expect(e.apiStatus).toBe(403);
    expect(e.apiCode).toBe('FORBIDDEN');
  });

  it('límite agotado → 429 RATE_LIMITED', () => {
    const cache = {
      data: Object.create(null),
      get(k) {
        return k in this.data ? this.data[k] : null;
      },
      put(k, v) {
        this.data[k] = v;
      },
    };
    globalThis.CacheService = { getScriptCache: () => cache };

    const policy = {
      scope: 'endpoint:authLogin',
      access: { read: 'public', write: 'public' },
      limits: { read: '1/min', write: '1/min' },
    };

    globalThis.enforceRateLimit_(policy, 'read'); // primera pasa
    const e = throws(() => globalThis.enforceRateLimit_(policy, 'read'));
    expect(e.apiStatus).toBe(429);
    expect(e.apiCode).toBe('RATE_LIMITED');
  });

  it('authCodeFor_ mapea cada motivo de verifyToken_ a su código', () => {
    expect(globalThis.authCodeFor_('expired')).toBe('AUTH_EXPIRED');
    expect(globalThis.authCodeFor_('malformed')).toBe('AUTH_INVALID');
    expect(globalThis.authCodeFor_('bad_signature')).toBe('AUTH_INVALID');
    expect(globalThis.authCodeFor_('bad_aud')).toBe('AUTH_INVALID');
    expect(globalThis.authCodeFor_('algo-que-no-existe')).toBe('AUTH_INVALID');
  });

  it('throwTokenError_ lanza 401 con el código correspondiente', () => {
    const expirado = throws(() => globalThis.throwTokenError_('expired'));
    expect(expirado.apiStatus).toBe(401);
    expect(expirado.apiCode).toBe('AUTH_EXPIRED');

    const malformado = throws(() => globalThis.throwTokenError_('bad_signature'));
    expect(malformado.apiStatus).toBe(401);
    expect(malformado.apiCode).toBe('AUTH_INVALID');
  });

  it('errorResponse_ proyecta el code cuando lo hay', () => {
    const err = globalThis.apiError_(401, 'No autorizado', null, 'AUTH_EXPIRED');
    const body = decode(globalThis.errorResponse_(err));
    expect(body).toEqual({
      error: { status: 401, message: 'No autorizado', code: 'AUTH_EXPIRED' },
    });
  });

  it('sin code no aparece la clave (aditivo) — y nunca { ok: false }', () => {
    const body = decode(globalThis.errorResponse_(new Error('boom')));
    expect(body.error.status).toBe(500);
    expect(body.error).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('ok');
  });

  it('respondError_ conserva el envelope { error: {...} }', () => {
    const body = decode(globalThis.respondError_(409, 'Duplicado', [{ path: 'x', message: 'y' }]));
    expect(body).toEqual({
      error: { status: 409, message: 'Duplicado', errors: [{ path: 'x', message: 'y' }] },
    });
    expect(body).not.toHaveProperty('ok');
  });

  it('el error de login NO lleva la lista de errores de validación', () => {
    const e = throws(() =>
      globalThis.REGISTRY.handlers.handleAuthLogin({ email: 'nobody@x.com', password: PASS }),
    );
    expect(e.apiErrors).toBeUndefined();
    expect(Object.keys(e)).not.toContain('apiErrors');
  });
});

// ── R2.13 · rate-limit del login por cuenta (auth.md §4.6 / §8) ───────────
//
// Éste bloque cubre lo que sólo el rate-limit puede cubrir: que las dos
// ventanas existan, que se corten en el fallo que dice §8, y — lo que no es
// decorativo — que el corte sea IGUAL exista o no el email, porque si un
// 429 sólo aparece para direcciones dadas de alta, el rate-limit se vuelve
// un comprobador de direcciones de correo con estado.
describe('R2.13 — rate-limit del login por cuenta (auth.md §4.6)', () => {
  const ACCOUNT_LIMIT = '5/15min';

  /** Caché falsa controlable: `get`/`put` planos, como los usa 26-lock-cache. */
  function fakeCache() {
    const data = Object.create(null);
    return {
      data,
      get: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
      put: (k, v) => {
        data[k] = String(v);
      },
    };
  }

  function useCache() {
    const cache = fakeCache();
    globalThis.CacheService = { getScriptCache: () => cache };
    return cache;
  }

  /**
   * `request` tal y como lo arma `dispatchRoute_` (10-router): la ruta ya
   * resuelta y la política normalizada. Sin `request`, el handler no debe
   * romperse — es la invocación a mano que ya hacen otros tests.
   */
  function attempt(email, password) {
    return globalThis.REGISTRY.handlers.handleAuthLogin(
      { email, password },
      { path: '/auth/login', method: 'POST', limits: { account: ACCOUNT_LIMIT } },
    );
  }

  const failing = (email, password) => throws(() => attempt(email, password));

  it("la gramática no cambia: '10/min' sigue siendo 10 en 60 s", () => {
    expect(globalThis.parseLimitSpec_('10/min')).toEqual({
      limit: 10,
      windowSeconds: 60,
      human: 'un minuto',
    });
  });

  it("el multiplicador abre la VENTANA, no el límite: '5/15min' = 5 en 900 s", () => {
    expect(globalThis.parseLimitSpec_('5/15min')).toEqual({
      limit: 5,
      windowSeconds: 900,
      human: '15 minutos',
    });
  });

  it('un spec ilegible sigue siendo 500 visible, nunca «sin límite»', () => {
    for (const bad of ['5/0min', 'muchos/min', '5/', '5/15']) {
      const e = throws(() => globalThis.parseLimitSpec_(bad));
      expect(e.apiStatus).toBe(500);
    }
  });

  it('normalizeLimits_ conserva `account` junto a read/write', () => {
    expect(globalThis.normalizeLimits_('10/min')).toEqual({
      read: '10/min',
      write: '10/min',
      account: null,
    });
    expect(globalThis.normalizeLimits_({ read: '1/min', account: '5/15min' })).toEqual({
      read: '1/min',
      write: null,
      account: '5/15min',
    });
  });

  it('6.º intento fallido → RATE_LIMITED; los cinco primeros siguen 401 (§8)', () => {
    useCache();
    for (let i = 1; i <= 5; i++) {
      const e = failing('ana@x.com', `mala-${i}`);
      expect(e.apiStatus).toBe(401);
      expect(e.apiCode).toBe('AUTH_INVALID');
    }
    const sixth = failing('ana@x.com', 'mala-6');
    expect(sixth.apiStatus).toBe(429);
    expect(sixth.apiCode).toBe('RATE_LIMITED');
  });

  it('el mensaje de corte es el mismo exista o no el email (§8)', () => {
    useCache();
    for (let i = 1; i <= 5; i++) failing('ana@x.com', `mala-${i}`);
    const conUsuario = failing('ana@x.com', 'mala-6');

    // El mismo camino, con una dirección que NO está en `_users`: seis
    // intentos sobre la MISMA, que es como se nota el corte.
    for (let i = 1; i <= 5; i++) failing('nobody@x.com', `mala-${i}`);
    const sinUsuario = failing('nobody@x.com', 'mala-6');

    expect(conUsuario.apiStatus).toBe(429);
    expect(sinUsuario.apiStatus).toBe(429);
    expect(sinUsuario.message).toBe(conUsuario.message);
    expect(sinUsuario.apiCode).toBe(conUsuario.apiCode);
  });

  it('las cuentas no se contaminan entre sí', () => {
    useCache();
    for (let i = 1; i <= 5; i++) failing('ana@x.com', `mala-${i}`);
    // Otra dirección sigue exactamente donde estaba: 401, no 429.
    const otra = failing('beto@x.com', 'mala');
    expect(otra.apiStatus).toBe(401);
    expect(otra.apiCode).toBe('AUTH_INVALID');
  });

  it('un login correcto NO consume la ventana de fallos', () => {
    const cache = useCache();
    failing('ana@x.com', 'mala');
    const key = 'rlf:/auth/login:ana@x.com';
    expect(cache.data[key]).toBe('1');

    const ok = attempt('ana@x.com', PASS);
    expect(ok.token).toBeTruthy();

    expect(cache.data[key]).toBe('1'); // no subió
  });

  it('sin `limits.account` declarado no se corta nada (el resto de endpoints)', () => {
    const cache = useCache();
    const request = { path: '/algo', method: 'POST', limits: { read: null, write: null } };
    for (let i = 0; i < 20; i++) {
      expect(() =>
        globalThis.REGISTRY.handlers.handleAuthLogin(
          { email: 'ana@x.com', password: 'mala' },
          request,
        ),
      ).toThrow();
    }
    expect(Object.keys(cache.data)).toHaveLength(0);
  });

  /**
   * §4.6 — «si el login falla, se responde igual de rápido haya o no
   * usuario». El tiempo es difícil de medir sin ruido, pero el TRABAJO no:
   * `Props.hashText` es una ronda del KDF, así que comparar cuántas se
   * ejecutan en cada rama es comparar el coste exacto.
   */
  it('el coste del fallo es el mismo con y sin usuario (§4.6)', () => {
    useCache();

    const count = (fn) => {
      const spy = vi.spyOn(globalThis.Props, 'hashText');
      try {
        fn();
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    };

    const conUsuario = count(() => failing('ana@x.com', 'mala'));
    const sinUsuario = count(() => failing('nadie@x.com', 'mala'));

    expect(conUsuario).toBeGreaterThan(1); // realmente corrió el KDF
    expect(sinUsuario).toBe(conUsuario); // mismo coste, misma rama
  });

  it('el incremento pasa por LockService — get+put no es atómico (§4.6)', () => {
    useCache();
    const origLock = globalThis.LockService;
    const getScriptLock = vi.fn(() => ({ waitLock: () => {}, releaseLock: () => {} }));
    globalThis.LockService = { getScriptLock };
    try {
      failing('ana@x.com', 'mala');
      expect(getScriptLock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.LockService = origLock;
    }
  });

  it('la comprobación de corte NO toma lock: sólo lee', () => {
    useCache();
    for (let i = 1; i <= 5; i++) failing('ana@x.com', `mala-${i}`); // 5 fallos

    const origLock = globalThis.LockService;
    const getScriptLock = vi.fn(() => ({ waitLock: () => {}, releaseLock: () => {} }));
    globalThis.LockService = { getScriptLock };
    try {
      const e = failing('ana@x.com', 'mala-6');
      expect(e.apiStatus).toBe(429);
      // El corte no gasta lock: si lo hiciera, un ataque saturaría el
      // LockService del script entero en vez de limitarse a sí mismo.
      expect(getScriptLock).not.toHaveBeenCalled();
    } finally {
      globalThis.LockService = origLock;
    }
  });
});
