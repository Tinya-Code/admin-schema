// api/__tests__/public-audience.spec.js — F7 · R7.3: la ruta pública ignora el token.
//
// auth.md §4.8: «Una ruta `public` nunca acepta ni devuelve el token del
// admin». El router lo garantiza estructuralmente — en rutas `public` NI
// SIQUIERA llama a `verifySession_` (core/10-router.js), así que el token
// nunca llega al handler. Este spec lo prueba de punta a punta:
//
//   1. CONTROL: el token de admin es REAL y funciona (si no, «no cambia
//      nada» no probaría nada — probarías que un token de mentira no
//      abre puertas);
//   2. el mismo pedido a /p/orders/:ref con y sin ese token devuelve el
//      MISMO cuerpo: misma lista blanca, sin notas internas.
//
// El contrato del front público (otro repo) no se compara acá: su lado de
// back se vigila con `audiences.public` (R7.2) + check 12 de contract-check.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { realUtilities } from './_auth-fixtures.js';
import { loadBackend } from './_harness.js';

const SECRET = 'secreto-de-prueba-0123456789';

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

const MOCK_ORDER = {
  ref: 'ORD-789',
  customer_name: 'Juan Pérez',
  description: 'Paquete frágil 2kg',
  pickup_date: '2026-10-10',
  status: 'PENDIENTE',
  reference_photo: 'https://res.cloudinary.com/demo/image/upload/v1/orders/ref1.jpg',
  customer_notes: 'CLIENTE VIP - LLAMAR ANTES', // CONFIDENCIAL / INTERNO
  pin: '4821', // interno: no viaja a la audiencia pública
  authorized_name: 'María Gómez',
  authorized_photo: 'https://res.cloudinary.com/demo/image/upload/v1/orders/auth1.jpg',
  authorized_notes: 'DNI verificado en counter', // CONFIDENCIAL / INTERNO
  auth_state: 'ACTIVA',
  created_at: '2026-10-05T10:00:00Z',
  updated_at: '2026-10-05T10:00:00Z',
  history: [
    { at: '2026-10-05T10:00:00Z', action: 'PEDIDO_CREADO', detail: 'Creado por mostrador' },
  ],
};

let REGISTRY;
let orig;
let users;

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

/** Entorno mínimo para que `issueToken_`/`verifySession_` funcionen de verdad. */
function patchEnv() {
  const store = { AUTH_SECRET: SECRET, KDF_ITERATIONS: '1000' };
  globalThis.Props.get = (name) => (name in store ? store[name] : null);
  globalThis.Props.setAll = (values) => Object.assign(store, values);
  globalThis.Utilities = realUtilities;
  const cache = new Map();
  globalThis.CacheService = {
    getScriptCache: () => ({
      get: (k) => (cache.has(k) ? cache.get(k) : null),
      put: (k, v) => cache.set(k, v),
      remove: (k) => cache.delete(k),
    }),
  };
  globalThis.openSpreadsheet_ = () => ({ getSheetByName: (n) => (n === '_users' ? {} : null) });
  globalThis.readSheetData_ = () => ({
    headers: HEADERS,
    rows: users.map((v, i) => ({ at: i + 2, values: v })),
  });
  // El detalle del pedido sale de un doble: el test no quiere sheets.
  globalThis.readDetail_ = (_ss, _resource, _map, key) => {
    if (key === 'ORD-789') return { ...MOCK_ORDER };
    throw globalThis.apiError_(404, 'No existe: ' + key);
  };
}

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

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
});

beforeEach(() => {
  orig = {
    PropsGet: globalThis.Props.get,
    PropsSetAll: globalThis.Props.setAll,
    Utilities: globalThis.Utilities,
    CacheService: globalThis.CacheService,
    openSpreadsheet_: globalThis.openSpreadsheet_,
    readSheetData_: globalThis.readSheetData_,
    readDetail_: globalThis.readDetail_,
    ROUTE_TABLE_: globalThis.ROUTE_TABLE_,
  };
  patchEnv();
  users = [userRow()];
});

afterEach(() => {
  globalThis.Props.get = orig.PropsGet;
  globalThis.Props.setAll = orig.PropsSetAll;
  globalThis.Utilities = orig.Utilities;
  globalThis.CacheService = orig.CacheService;
  globalThis.openSpreadsheet_ = orig.openSpreadsheet_;
  globalThis.readSheetData_ = orig.readSheetData_;
  globalThis.readDetail_ = orig.readDetail_;
  globalThis.ROUTE_TABLE_ = orig.ROUTE_TABLE_;
});

describe('F7 · R7.3 — el token de admin no cambia /public/*', () => {
  it('control: el token emitido es válido y de admin (si no, nada de esto probaría)', () => {
    const token = globalThis.issueToken_({ sub: 'u_1', sid: 'ses_ctrl', v: 1 });
    const body = post('/auth/me', { token });
    expect(body.user).toBeTruthy();
    expect(body.user.email).toBe('ana@x.com');
  });

  it('mismo cuerpo con y sin token de admin, y sin campos internos', () => {
    const token = globalThis.issueToken_({ sub: 'u_1', sid: 'ses_pub', v: 1 });
    const path = '/p/orders/ORD-789';

    const sinToken = post(path, { method: 'GET' });
    const conToken = post(path, { method: 'GET', token });

    // La ruta pública ignora el token: la respuesta no cambia NI EN CLAVE
    // NI EN VALOR, y sigue sin traer las notas internas ni el pin.
    expect(conToken).toEqual(sinToken);
    expect(sinToken.ref).toBe('ORD-789');
    expect(sinToken.customer_notes).toBeUndefined();
    expect(sinToken.authorized_notes).toBeUndefined();
    expect(sinToken.pin).toBeUndefined();
  });
});
