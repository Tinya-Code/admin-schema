// api/__tests__/auth-session.spec.js — Cadena de verificación por request
// (R2.6 — auth.md §3.4).
//
// Lo que éste archivo cubre y ninguna otra parte del sistema cubre:
//
//  1. **La cadena de punta a punta.** `doPost` → `verifySession_` →
//     `requireAccess_` → `dispatchRoute_` (con `request.user` /
//     `request.sid`) → `withRenewal_`. Un `/auth/me` con sesión buena
//     devuelve el usuario. Los pasos individuales ya estaban probados por
//     su fichero; éste prueba que van en ese orden y que se conectan.
//  2. **Que CADA paso falla con su código de §4.5**, no sólo con «401»:
//     sin token ⇒ `AUTH_REQUIRED`, firma/estructura/rol/versión ⇒
//     `AUTH_INVALID`, `exp` vencido ⇒ `AUTH_EXPIRED`, rol insuficiente ⇒
//     `FORBIDDEN` (403, que NO cierra sesión — el contrato que R2.9 lee).
//  3. **Fail-closed en la fila**: `active !== true` y `token_version`
//     ausente o no numérico son `AUTH_INVALID`. Una cuenta mal formada no
//     puede parecerse a una cuenta activa.
//  4. **Revocación por `sid`**: hoy sólo SE LEE la lista (la escribe
//     `/auth/logout` en R2.16). El paso ya está cableado y probado.
//  5. **Renovación deslizante (§3.2)**: token con poca vida ⇒
//     `meta.renewedToken` AÑADIDO a la respuesta; con vida de sobra ⇒
//     la respuesta queda EXACTAMENTE igual, sin la clave.
//
// ATENCIÓN — requisito de este fichero: el harness stubbea `CacheService`
// con `inertStub`, cuyo `.get()` devuelve un proxy y `String(proxy)` es
// `'null'` (no `''`). Para `sidRevoked_` eso significaría «revocado»
// SIEMPRE, y cualquier token válido daría 401. Aquí se instala un
// `CacheService` de verdad en cada test. Es el mismo requisito para
// cualquier test futuro que ejercite `verifySession_` con token bueno.

import { createHmac } from 'node:crypto';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

const SECRET = 'secreto-de-prueba-0123456789';
const AUD = 'admin';
const HOUR = 3600 * 1000;

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

// ── Doble fiel de Utilities ───────────────────────────────────────────────
// El stub inerte del harness devuelve el proxy ante CUALQUIER propiedad,
// así que un método suelto no se puede parchear: hay que reemplazar el
// objeto entero. Mismo base64url y mismo HMAC-SHA256 que Apps Script.
let uuidCounter = 0;
const realUtilities = {
  getUuid() {
    uuidCounter += 1;
    return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
  },
  newBlob(data) {
    if (typeof data === 'string') {
      const bytes = Array.from(Buffer.from(data, 'utf8'));
      return { getBytes: () => bytes };
    }
    const buf = Buffer.from(data);
    return { getDataAsString: () => buf.toString('utf8') };
  },
  base64EncodeWebSafe(bytes) {
    return Buffer.from(bytes).toString('base64url');
  },
  base64DecodeWebSafe(text) {
    return Array.from(Buffer.from(text, 'base64url'));
  },
  computeHmacSha256Signature(value, key) {
    return Array.from(createHmac('sha256', Buffer.from(key)).update(Buffer.from(value)).digest());
  },
};

let orig;
let store;
let users; // filas actuales de _users (en formato `values`)
let cache; // Map: la caché real de revocación

function userRow(overrides = {}) {
  const u = {
    id: 'u_1',
    email: 'ana@x.com',
    name: 'Ana',
    role: 'admin',
    active: true,
    token_version: 1,
    pass_hash: '',
    pass_salt: '',
    last_login_at: '',
    created_at: '2026-01-01 00:00:00',
    ...overrides,
  };
  return HEADERS.map((h) => u[h]);
}

function patchEnv() {
  store = { AUTH_SECRET: SECRET, KDF_ITERATIONS: '1000' };
  globalThis.Props.get = (name) => (name in store ? store[name] : null);
  globalThis.Props.setAll = (values) => Object.assign(store, values);
  globalThis.Utilities = realUtilities;
  globalThis.openSpreadsheet_ = () => ({ getSheetByName: (n) => (n === '_users' ? {} : null) });
  globalThis.readSheetData_ = () => ({
    headers: HEADERS,
    rows: users.map((v, i) => ({ at: i + 2, values: v })),
  });
  // CacheService DE VERDAD — ver la advertencia del encabezado.
  cache = new Map();
  globalThis.CacheService = {
    getScriptCache: () => ({
      get: (k) => (cache.has(k) ? cache.get(k) : null),
      put: (k, v) => {
        cache.set(k, v);
      },
      remove: (k) => {
        cache.delete(k);
      },
    }),
  };
}

beforeAll(() => {
  loadBackend();
});

beforeEach(() => {
  orig = {
    get: globalThis.Props.get,
    setAll: globalThis.Props.setAll,
    Utilities: globalThis.Utilities,
    openSpreadsheet_: globalThis.openSpreadsheet_,
    readSheetData_: globalThis.readSheetData_,
    CacheService: globalThis.CacheService,
  };
  patchEnv();
  users = [userRow()];
});

afterEach(() => {
  Object.assign(globalThis, orig);
  delete globalThis.REGISTRY.handlers.__echoSid;
});

// ── Helpers ───────────────────────────────────────────────────────────────

/** Fila de `_users` como objeto (para llamar handlers a mano). */
function userRowObj(overrides = {}) {
  const values = userRow(overrides);
  const out = {};
  HEADERS.forEach((h, i) => {
    out[h] = values[i];
  });
  return out;
}

/** Token emitido por el back (iat = ahora ⇒ nunca vencido). */
function issue(claims) {
  return globalThis.issueToken_(claims);
}

/** Token firmado A MANO con claims arbitrarios (expirado, renovable, …). */
function craft(claims) {
  const body = globalThis.textToB64Url_(JSON.stringify(claims));
  return body + '.' + globalThis.bytesToB64Url_(globalThis.hmac_(body));
}

/** POST de verdad, por la ruta que usa el front. Devuelve el cuerpo JSON. */
function post(path, opts = {}) {
  const raw = globalThis.doPost({
    postData: {
      contents: JSON.stringify({
        method: opts.method || 'POST',
        path,
        token: opts.token,
        payload: opts.payload || {},
      }),
    },
  });
  return JSON.parse(raw.getContent());
}

/** Devuelve el `error` del sobre; falla el test si la respuesta fue 2xx. */
function errOf(path, opts) {
  const body = post(path, opts);
  expect(body.error, `se esperaba un error en ${path}`).toBeTruthy();
  return body.error;
}

/** Devuelve la excepción de `fn`; falla el test si no lanzó. */
function throws(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('se esperaba una excepción y no se lanzó ninguna');
}

// ── 1. La cadena, de punta a punta ────────────────────────────────────────

describe('cadena de §3.4 — de punta a punta', () => {
  it('sesión válida → /auth/me devuelve el usuario, con whitelist', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_a', v: 1 });
    const body = post('/auth/me', { token });

    expect(body.user).toBeTruthy();
    expect(body.user.email).toBe('ana@x.com');
    expect(body.user.role).toBe('admin');
    // Nunca sale la fila cruda (R2.17).
    expect(body.user).not.toHaveProperty('pass_hash');
    expect(body.user).not.toHaveProperty('pass_salt');
    expect(body.user).not.toHaveProperty('token_version');
  });

  it('el paso 6 entrega request.user y request.sid al handler', () => {
    globalThis.REGISTRY.handlers.__echoSid = (_payload, request) => ({
      sid: request.sid,
      uid: request.user.id,
    });
    const token = issue({ sub: 'u_1', sid: 'ses_b', v: 1 });
    const session = globalThis.verifySession_(token);

    const out = globalThis.dispatchRoute_(
      { kind: 'handler', handler: '__echoSid', params: {} },
      { method: 'POST', path: '/__test', payload: {} },
      session,
    );
    const body = JSON.parse(out.getContent());

    expect(body.uid).toBe('u_1');
    expect(body.sid).toBe('ses_b');
  });

  it('dispatchRoute_ sin sesión (2 args) significa «sin identidad»', () => {
    globalThis.REGISTRY.handlers.__echoSid = (_payload, request) => ({
      sid: request.sid,
      uid: request.user,
    });

    const out = globalThis.dispatchRoute_(
      { kind: 'handler', handler: '__echoSid', params: {} },
      { method: 'POST', path: '/__test', payload: {} },
    );
    const body = JSON.parse(out.getContent());

    expect(body.sid).toBeNull();
    expect(body.uid).toBeNull();
  });

  it('la ruta pública NO verifica nada: llega al handler sin token', () => {
    const error = errOf('/auth/login', { payload: { email: 'ana@x.com', password: 'mal' } });
    // Si la cadena hubiera corrido, esto sería AUTH_REQUIRED («no me diste»).
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_INVALID');
  });

  it('ruta admin con admin activo → pasa y llega al handler', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_c', v: 1 });
    const body = post('/admin/schema', { token, method: 'GET' });

    expect(body.error).toBeUndefined();
    expect(body.resources).toBeTruthy();
  });
});

// ── 2. Cada paso con su código de §4.5 ────────────────────────────────────

describe('la cadena — código exacto por paso (§4.5)', () => {
  it('sin token → 401 AUTH_REQUIRED', () => {
    const error = errOf('/auth/me');
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_REQUIRED');
  });

  it('firma alterada → 401 AUTH_INVALID', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });
    const roto = token.slice(0, -2) + (token.slice(-2) === 'xy' ? 'zw' : 'xy');
    const error = errOf('/auth/me', { token: roto });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_INVALID');
  });

  it('aud distinta → 401 AUTH_INVALID (no sirve en otra app)', () => {
    const now = Date.now();
    const token = craft({
      sub: 'u_1',
      sid: 'ses_1',
      v: 1,
      iat: now,
      exp: now + HOUR,
      aud: 'otra-app',
      orig: now,
    });
    const error = errOf('/auth/me', { token });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_INVALID');
  });

  it('exp vencido → 401 AUTH_EXPIRED (el único que reloguea)', () => {
    const now = Date.now();
    const token = craft({
      sub: 'u_1',
      sid: 'ses_1',
      v: 1,
      iat: now - 7 * HOUR,
      exp: now - HOUR,
      aud: AUD,
      orig: now - 7 * HOUR,
    });
    const error = errOf('/auth/me', { token });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_EXPIRED');
  });

  it('sub sin fila → 401 AUTH_INVALID (la cuenta ya no existe)', () => {
    const token = issue({ sub: 'u_999', sid: 'ses_1', v: 1 });
    const error = errOf('/auth/me', { token });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_INVALID');
  });

  it('active !== true → 401 AUTH_INVALID', () => {
    users = [userRow({ active: false })];
    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });
    const error = errOf('/auth/me', { token });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_INVALID');
  });

  it('el paso 4 exige active POR SU CUENTA (no vía requireAccess_)', () => {
    // `requireAccess_` hace el mismo chequeo en el paso 5, así que un test
    // que sólo pase por `doPost` no prueba el paso 4: si `verifySession_`
    // lo olvidara, el resultado sería idéntico. Se le aísla acá para que
    // cada paso de §3.4 tenga evidencia propia.
    users = [userRow({ active: false })];
    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });
    const e = throws(() => globalThis.verifySession_(token));
    expect(e.apiStatus).toBe(401);
    expect(e.apiCode).toBe('AUTH_INVALID');
  });

  it('token_version distinto → 401 AUTH_INVALID', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 2 }); // fila dice 1
    const error = errOf('/auth/me', { token });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_INVALID');
  });

  it('fila sin versión numérica → 401 AUTH_INVALID (fail-closed)', () => {
    for (const mala of ['', '  ', 'abc', null, undefined]) {
      users = [userRow({ token_version: mala })];
      const token = issue({ sub: 'u_1', sid: 'ses_1', v: 0 });
      const error = errOf('/auth/me', { token });
      expect(error.code, `token_version=${String(mala)}`).toBe('AUTH_INVALID');
    }
  });

  it('sid revocado → 401 AUTH_INVALID (la lista ya se lee)', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_revocada', v: 1 });
    cache.set('revoked:ses_revocada', '1');

    const error = errOf('/auth/me', { token });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_INVALID');

    // Y sin la entrada, el mismo token pasa: el fallo era la revocación.
    cache.delete('revoked:ses_revocada');
    expect(post('/auth/me', { token }).user.email).toBe('ana@x.com');
  });

  it('rol insuficiente → 403 FORBIDDEN (403, no 401)', () => {
    users = [userRow({ role: 'staff' })];
    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });
    const error = errOf('/admin/schema', { token, method: 'GET' });
    expect(error.status).toBe(403);
    expect(error.code).toBe('FORBIDDEN');

    // §8: «FORBIDDEN **y no se cierra la sesión**». Si el 403 limpiara el
    // token como haría un 401, el front mandaría al usuario a login cada
    // vez que toca una pantalla de admin sin permiso.
    expect(post('/auth/me', { token }).user.role).toBe('staff');
  });

  it('la revocación no decide sola: un sid no listado pasa', () => {
    // El paso 3 sólo aporta «está en la lista o no»; el resto de la cadena
    // es quien decide. Aquí el sid está limpio y la fila es válida.
    const token = issue({ sub: 'u_1', sid: 'ses limpia', v: 1 });
    expect(post('/auth/me', { token }).user).toBeTruthy();

    // El paso 3 sólo LEE: nada de `revoked:` puede haberse escrito (la
    // escritura es R2.16). El único valor posible en la caché es el
    // snapshot de sesión que acaba de poblar el paso 4 (R2.15).
    expect([...cache.keys()].filter((k) => String(k).startsWith('revoked:'))).toHaveLength(0);
    expect(cache.has('usnap:u_1')).toBe(true);
  });
});

// ── 3. Orden del router ───────────────────────────────────────────────────

describe('orden — 401 antes que 400/404 (§3.4 / R2.9)', () => {
  it('ruta inexistente SIN token → 401, no 404', () => {
    const error = errOf('/ruta-que-no-existe', { method: 'GET' });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_REQUIRED');
  });

  it('ruta inexistente CON sesión válida → 404', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });
    const error = errOf('/ruta-que-no-existe', { token, method: 'GET' });
    expect(error.status).toBe(404);
  });

  it('ruta admin SIN token → 401, no 404 ni 500', () => {
    const error = errOf('/admin/esto-no-existe', { method: 'GET' });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_REQUIRED');
  });
});

// ── 4. Renovación deslizante (§3.2) ───────────────────────────────────────

describe('renovación deslizante — paso 7 de §3.4', () => {
  function tokenCercanoAVencer() {
    const now = Date.now();
    // TTL = 6 h ⇒ para quedar por debajo del 25 % (tokenRenewRatio_) hace
    // falta menos de 1,5 h de vida. Con iat = -5 h y exp = +1 h el total es
    // exactamente 6 h, que es el máximo que verifyToken_ acepta.
    return craft({
      sub: 'u_1',
      sid: 'ses_ren',
      v: 1,
      iat: now - 5 * HOUR,
      exp: now + HOUR,
      aud: AUD,
      orig: now - 5 * HOUR,
    });
  }

  it('token con poca vida → meta.renewedToken en la respuesta', () => {
    const body = post('/auth/me', { token: tokenCercanoAVencer() });

    expect(body.user.email).toBe('ana@x.com');
    expect(body.meta).toBeTruthy();
    expect(typeof body.meta.renewedToken).toBe('string');
    expect(body.meta.renewedToken).toContain('.');

    // El renovado también abre: misma cadena, nueva vida.
    expect(post('/auth/me', { token: body.meta.renewedToken }).user.email).toBe('ana@x.com');
  });

  it('token con vida de sobra → NO se añade meta', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_ok', v: 1 });
    const body = post('/auth/me', { token });

    expect(body.user).toBeTruthy();
    expect(body).not.toHaveProperty('meta');
  });

  it('meta AÑADE una clave, no cambia la forma de la respuesta', () => {
    const fresco = post('/auth/me', { token: issue({ sub: 'u_1', sid: 's1', v: 1 }) });
    const renovado = post('/auth/me', { token: tokenCercanoAVencer() });

    expect(Object.keys(fresco).sort()).toEqual(['user']);
    expect(Object.keys(renovado).sort()).toEqual(['meta', 'user']);
    // El payload de siempre sigue intacto.
    expect(renovado.user).toEqual(fresco.user);
  });
});

// ── 5. Snapshot cacheado (R2.15 — auth.md §3.4 paso 4) ────────────────────

describe('snapshot cacheado — paso 4 de §3.4 (TTL 60 s)', () => {
  /** Valor crudo que quedó en la caché para `u_1`. */
  function rawSnapshot() {
    const raw = cache.get('usnap:u_1');
    expect(typeof raw).toBe('string');
    return raw;
  }

  function snapshotEntry() {
    return JSON.parse(rawSnapshot());
  }

  it('el segundo request NO vuelve a abrir la hoja', () => {
    let opens = 0;
    const real = globalThis.openSpreadsheet_;
    globalThis.openSpreadsheet_ = () => {
      opens += 1;
      return real();
    };

    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });
    expect(post('/auth/me', { token }).user).toBeTruthy();
    const afterFirst = opens;
    expect(afterFirst).toBeGreaterThan(0); // el primero SÍ lee

    expect(post('/auth/me', { token }).user).toBeTruthy();
    expect(opens).toBe(afterFirst); // caché tibia ⇒ ni una hoja más
  });

  it('lo que se cachea NO lleva pass_hash ni pass_salt', () => {
    users = [userRow({ pass_hash: 'HASH-SECRETO', pass_salt: 'SAL-SECRETA' })];
    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });
    expect(post('/auth/me', { token }).user).toBeTruthy();

    const snap = snapshotEntry();
    expect(snap.id).toBe('u_1');
    expect(snap.role).toBe('admin');
    expect(snap.active).toBe(true);
    expect(snap.token_version).toBe(1);
    // El snapshot lleva TODO lo que la cadena necesita… menos la credencial.
    expect(snap).not.toHaveProperty('pass_hash');
    expect(snap).not.toHaveProperty('pass_salt');
    expect(rawSnapshot()).not.toContain('HASH-SECRETO');
    expect(rawSnapshot()).not.toContain('SAL-SECRETA');
  });

  it('un valor ilegible en la caché cae a la hoja y se reescribe', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });

    cache.set('usnap:u_1', 'esto no es json');
    expect(post('/auth/me', { token }).user).toBeTruthy();
    expect(snapshotEntry().id).toBe('u_1');

    // JSON perfectamente válido que NO es un usuario: `JSON.parse('null')`
    // devuelve `null`, que no puede confundirse con un acierto.
    cache.set('usnap:u_1', 'null');
    expect(post('/auth/me', { token }).user).toBeTruthy();
    expect(snapshotEntry().id).toBe('u_1');
  });

  it('un valor que NO sea string no cuenta como acierto', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });

    // Un doble que devuelve OBJETOS en vez de strings — que es lo que hace
    // el stub inerte del harness con cualquier método. Si se confiara en
    // eso, `JSON.parse` lo serializaría y serviría un snapshot inventado
    // en lugar de ir a la hoja.
    globalThis.CacheService = {
      getScriptCache: () => ({
        // Sólo el snapshot devuelve el objeto tramposo: `revoked:` tiene que
        // seguir devolviendo `null`, o el paso 3 cortaría antes de llegar al 4.
        get: (k) =>
          String(k).startsWith('usnap:') ? { toString: () => '{"id":"u_1","active":false}' } : null,
        put: () => {},
      }),
    };

    expect(post('/auth/me', { token }).user).toBeTruthy();
  });

  it('subir token_version invalida lo emitido (firme, efectivo ≤ 60 s)', () => {
    const viejo = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });
    expect(post('/auth/me', { token: viejo }).user).toBeTruthy();

    users = [userRow({ token_version: 2 })];
    // Mientras dure la caché, la fila nueva todavía no rige: §4.6 dice
    // «efectiva en ≤ 60 s», y esa ventana ES el TTL del snapshot.
    expect(post('/auth/me', { token: viejo }).user).toBeTruthy();

    // Vencido el TTL manda la hoja: el viejo cae y el nuevo pasa.
    cache.delete('usnap:u_1');
    const error = errOf('/auth/me', { token: viejo });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_INVALID');

    const nuevo = issue({ sub: 'u_1', sid: 'ses_1', v: 2 });
    expect(post('/auth/me', { token: nuevo }).user).toBeTruthy();
  });

  it('active=false rige en ≤ 60 s, no al instante', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });
    expect(post('/auth/me', { token }).user).toBeTruthy();

    users = [userRow({ active: false })];
    expect(post('/auth/me', { token }).user).toBeTruthy(); // caché tibia

    cache.delete('usnap:u_1');
    const error = errOf('/auth/me', { token });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_INVALID');
  });

  it('una cuenta inexistente no deja caché negativa', () => {
    users = [];
    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });
    const error = errOf('/auth/me', { token });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_INVALID');
    expect([...cache.keys()].filter((k) => String(k).startsWith('usnap:'))).toHaveLength(0);
  });
});

// ── 6. Revocación al hacer logout (R2.16 — auth.md §4.3 / D10-7) ──────────

describe('logout revoca el sid — paso 3 escrito por /auth/logout', () => {
  it('logout escribe revoked:<sid> en la caché', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_por_revoke', v: 1 });
    expect(cache.has('revoked:ses_por_revoke')).toBe(false);

    expect(post('/auth/logout', { token }).loggedOut).toBe(true);

    expect(cache.get('revoked:ses_por_revoke')).toBe('1');
  });

  it('después del logout el MISMO token ya no sirve', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_cerrada', v: 1 });
    expect(post('/auth/me', { token }).user).toBeTruthy();

    expect(post('/auth/logout', { token }).loggedOut).toBe(true);

    const error = errOf('/auth/me', { token });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_INVALID');
  });

  it('sólo se revoca ESE sid: otras sesiones siguen andando', () => {
    const esta = issue({ sub: 'u_1', sid: 'ses_que_se_cierra', v: 1 });
    const otra = issue({ sub: 'u_1', sid: 'ses_que_sigue', v: 1 });

    expect(post('/auth/logout', { token: esta }).loggedOut).toBe(true);

    expect(post('/auth/me', { token: otra }).user).toBeTruthy();
  });

  it('la caché caída no impide cerrar sesión (best-effort, D10-7)', () => {
    globalThis.CacheService = {
      getScriptCache: () => ({
        get: () => null,
        put: () => {
          throw new Error('caché no disponible');
        },
      }),
    };

    const token = issue({ sub: 'u_1', sid: 'ses_sin_cache', v: 1 });
    expect(post('/auth/logout', { token }).loggedOut).toBe(true);
  });

  it('cada logout deja exactamente una entrada, la de su sid', () => {
    const token = issue({ sub: 'u_1', sid: 'ses_1', v: 1 });
    expect(post('/auth/logout', { token }).loggedOut).toBe(true);

    const revocados = [...cache.keys()].filter((k) => String(k).startsWith('revoked:'));
    expect(revocados).toEqual(['revoked:ses_1']);
    expect(cache.get('revoked:ses_1')).toBe('1');
  });

  it('un logout sin sid no tira nada abajo', () => {
    // `dispatchRoute_` sólo llena `request.sid` cuando hubo sesión; con la
    // identidad resuelta a mano no hay con qué revocar, y eso no es error.
    const out = globalThis.REGISTRY.handlers.handleAuthLogout({}, { user: userRowObj() });
    expect(out.loggedOut).toBe(true);
    expect([...cache.keys()]).toHaveLength(0);
  });
});
