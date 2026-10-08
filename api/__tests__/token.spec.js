// api/__tests__/token — Token de sesión firmado y sin estado (R2.3, auth.md §3.2).
//
// Lo que éste archivo cubre y ninguna otra parte del sistema cubre:
//
//  1. **El rol no viaja en el token.** No es una convención que haya que
//     recordar: `issueToken_` recorta `claims` a una whitelist, así que un
//     `role` pasado de más simplemente no aparece en el payload.
//  2. **La firma se comprueba ANTES de parsear.** Si el orden se invierte,
//     el back estaría interpretando JSON que todavía no está autenticado.
//  3. **La comparación pasa por `constantTimeEqual_`.** Se espiya la
//     función: cambiarla por `===` hace fallar el test (no por tiempo —
//     eso no es observable en un test — sino porque la función deja de
//     invocarse).
//  4. **El tope absoluto de 7 días (D10-2).** Vive en `orig`, el instante
//     de nacimiento de la SESIÓN que arrastra cada token renovado, de modo
//     que el tope se cumple sin guardar estado en el servidor.
//
// `Utilities` se reemplaza COMPLETO: el stub inerte del harness devuelve el
// proxy ante cualquier propiedad, así que un método suelto no se puede
// parchear. Aquí se pone una implementación fiel en Node (mismo algoritmo
// base64url y mismo HMAC-SHA256), no un doble barato: así el token que
// genera el código real lo valida una implementación ajena.

import { createHmac } from 'node:crypto';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBackend } from './_harness.js';

const SECRET = 'secreto-de-prueba-1234567890';
const HOUR = 60 * 60 * 1000;

// ── Doble fiel de Utilities ───────────────────────────────────────────────
const realUtilities = {
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

// Atajos para FABRICAR tokens a mano (firma con otro secreto, aud ajena,
// expirados, TTL excesivo…). Mismo algoritmo que el código real.
function b64url(text) {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function sign(body, secret = SECRET) {
  return createHmac('sha256', Buffer.from(secret))
    .update(Buffer.from(body, 'utf8'))
    .digest('base64url');
}

function craft(payload, secret = SECRET) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

let orig;
let store;

beforeAll(() => {
  loadBackend();
});

beforeEach(() => {
  store = { AUTH_SECRET: SECRET };
  orig = {
    Props: globalThis.Props,
    Utilities: globalThis.Utilities,
    constantTimeEqual_: globalThis.constantTimeEqual_,
  };
  globalThis.Props = {
    get: (name) => (name in store ? store[name] : null),
    setAll: (values) => Object.assign(store, values),
    has: (name) => name in store,
    require: (name) => {
      if (!(name in store)) {
        const err = new Error('Falta configurar la propiedad: ' + name);
        err.apiStatus = 500;
        throw err;
      }
      return store[name];
    },
  };
  globalThis.Utilities = realUtilities;
});

afterEach(() => {
  Object.assign(globalThis, orig);
  vi.restoreAllMocks();
});

// Payload honesto recién emitido.
function freshPayload() {
  const res = globalThis.verifyToken_(globalThis.issueToken_({ sub: 'u_1', sid: 'ses_1', v: 3 }));
  expect(res.ok).toBe(true);
  return res.payload;
}

// ── 1. Emitir y verificar ────────────────────────────────────────────────

describe('issueToken_ / verifyToken_ (R2.3)', () => {
  it('emite un token que verifica y devuelve el payload', () => {
    const token = globalThis.issueToken_({ sub: 'u_1', sid: 'ses_1', v: 3 });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const res = globalThis.verifyToken_(token);
    expect(res.ok).toBe(true);
    expect(res.payload.sub).toBe('u_1');
    expect(res.payload.sid).toBe('ses_1');
    expect(res.payload.v).toBe(3);
  });

  it('el TTL es exactamente 6 h (D10-2)', () => {
    const p = freshPayload();
    expect(p.exp - p.iat).toBe(globalThis.CONFIG.TOKEN_TTL_HOURS * HOUR);
    expect(globalThis.CONFIG.TOKEN_TTL_HOURS).toBe(6);
  });

  it('la audiencia es admin', () => {
    expect(freshPayload().aud).toBe('admin');
  });

  it('`orig` nace con la sesión y arrastra en cada emisión', () => {
    const p = freshPayload();
    expect(p.orig).toBe(p.iat);

    // Un token emitido a partir de un payload con origen antiguo lo conserva.
    const viejo = { ...p, iat: Date.now() - 2 * HOUR, exp: Date.now() + 4 * HOUR };
    const seg = globalThis.verifyToken_(globalThis.issueToken_(viejo));
    expect(seg.ok).toBe(true);
    expect(seg.payload.orig).toBe(p.orig);
  });

  it('un token con `orig` viejo NO sobrevive al tope de 7 días', () => {
    const p = freshPayload();
    // 6,99 días de sesión: el TTL de 6 h lo recorta al tope restante.
    const casiTope = Date.now() - 6.99 * 24 * HOUR;
    const token = globalThis.issueToken_({ sub: 'u_1', sid: 'ses_1', v: 1, orig: casiTope });
    const res = globalThis.verifyToken_(token);
    expect(res.ok).toBe(true);
    expect(res.payload.exp - res.payload.iat).toBeLessThan(
      globalThis.CONFIG.TOKEN_TTL_HOURS * HOUR,
    );
    expect(res.payload.orig).toBe(casiTope);
    expect(p.orig).toBe(p.iat);
  });

  it('falta sub o sid ⇒ 500 (no se emite un token inútil)', () => {
    expect(() => globalThis.issueToken_({ sub: 'u_1' })).toThrow();
    expect(() => globalThis.issueToken_({ sid: 'ses_1' })).toThrow();
    expect(() => globalThis.issueToken_({})).toThrow();
  });
});

// ── 2. El rol NUNCA viaja ────────────────────────────────────────────────

describe('whitelist del payload (auth.md §3.2: el rol no se confía)', () => {
  it('un rol pasado en claims no aparece en el token', () => {
    const token = globalThis.issueToken_({
      sub: 'u_1',
      sid: 'ses_1',
      v: 1,
      role: 'admin',
      rol: 'staff',
      active: true,
    });
    const { payload } = globalThis.verifyToken_(token);
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('rol');
    expect(payload).not.toHaveProperty('active');
  });

  it('sólo admite los campos del diseño', () => {
    expect(Object.keys(freshPayload()).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'orig',
      'sid',
      'sub',
      'v',
    ]);
  });
});

// ── 3. Firma ─────────────────────────────────────────────────────────────

describe('firma HMAC', () => {
  it('firma con OTRO secreto ⇒ bad_signature', () => {
    const payload = freshPayload();
    const token = craft(payload, 'otro-secreto-completamente-distinto');
    expect(globalThis.verifyToken_(token)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('payload alterado conservando la firma ⇒ bad_signature', () => {
    const token = globalThis.issueToken_({ sub: 'u_1', sid: 'ses_1', v: 1 });
    const [body, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.sub = 'u_intruso'; // el atacante cambia el sujeto
    const alterado = `${b64url(JSON.stringify(payload))}.${sig}`;
    expect(globalThis.verifyToken_(alterado)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('compara las firmas con constantTimeEqual_ y no con ===', () => {
    // Mismo comportamiento que el real, pero espiable: si verifyToken_ dejara
    // de invocarlo (p. ej. cambiándolo por `===`), el spy no se llama.
    const spy = vi.fn((a, b) => a === b);
    globalThis.constantTimeEqual_ = spy;

    const token = globalThis.issueToken_({ sub: 'u_1', sid: 'ses_1', v: 1 });
    const [body, sig] = token.split('.');

    // Token legítimo: recibe la firma que viaja y la recalculada, e iguales.
    expect(globalThis.verifyToken_(token).ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(sig);
    expect(spy.mock.calls[0][0]).toBe(spy.mock.calls[0][1]);

    // Token manipulado: mismos dos argumentos, ahora distintos.
    spy.mockClear();
    const alterado = `${body.slice(0, -1)}${body.slice(-1) === 'A' ? 'B' : 'A'}.${sig}`;
    expect(globalThis.verifyToken_(alterado)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).not.toBe(spy.mock.calls[0][1]);
  });

  it('la firma es sobre el bloque codificado, no sobre el JSON crudo', () => {
    const payload = freshPayload();
    const json = JSON.stringify(payload);
    const cuerpo = b64url(json);

    // Firma calculada SOBRE EL JSON CRUDO — cómo NO debe hacerse: el código
    // real debe rechazarla porque firma exactamente los bytes que viajan.
    expect(globalThis.verifyToken_(`${cuerpo}.${sign(json)}`)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    // Y la correcta, sobre el bloque, sí pasa.
    expect(globalThis.verifyToken_(`${cuerpo}.${sign(cuerpo)}`).ok).toBe(true);
  });
});

// ── 4. Malformado / audiencia / vigencia ─────────────────────────────────

describe('verifyToken_ rechaza lo que no debe aceptar', () => {
  it.each([
    ['no string', null],
    ['vacío', ''],
    ['sin punto', 'abcabcabc'],
    ['sin cuerpo', `.firma`],
    ['sin firma', `cuerpo.`],
    ['tres partes', `a.b.c`],
  ])('%s ⇒ malformed', (_label, token) => {
    expect(globalThis.verifyToken_(token)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('cuerpo que no es JSON válido ⇒ malformed', () => {
    const cuerpo = b64url('esto no es json');
    expect(globalThis.verifyToken_(`${cuerpo}.${sign(cuerpo)}`)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('firma inválida y cuerpo ilegible ⇒ bad_signature (la firma manda primero)', () => {
    // Ése es el orden que exige el diseño: si se parseara antes, este token
    // respondería `malformed` y estaríamos interpretando JSON sin autenticar.
    const cuerpo = b64url('esto no es json');
    expect(globalThis.verifyToken_(`${cuerpo}.firma-basura`)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('aud distinta ⇒ bad_aud', () => {
    const payload = { ...freshPayload(), aud: 'customer' };
    expect(globalThis.verifyToken_(craft(payload))).toEqual({ ok: false, reason: 'bad_aud' });
  });

  it('expirado ⇒ expired', () => {
    const now = Date.now();
    // iat/exactamente 6 h de vida, pero terminada hace una hora.
    const payload = { ...freshPayload(), iat: now - 7 * HOUR, exp: now - HOUR };
    expect(globalThis.verifyToken_(craft(payload))).toEqual({ ok: false, reason: 'expired' });
  });

  it('vida superior al TTL ⇒ malformed (el TTL lo pone el back)', () => {
    const now = Date.now();
    const payload = { ...freshPayload(), iat: now - 24 * HOUR, exp: now + HOUR };
    expect(globalThis.verifyToken_(craft(payload))).toEqual({ ok: false, reason: 'malformed' });
  });

  it('sin AUTH_SECRET configurado ⇒ 500, no un token «válido»', () => {
    delete store.AUTH_SECRET;
    expect(() => globalThis.issueToken_({ sub: 'u_1', sid: 'ses_1', v: 1 })).toThrow();
    expect(() => globalThis.verifyToken_('aaaa.bbbb')).toThrow();
  });

  it('AUTH_SECRET demasiado corto ⇒ 500', () => {
    store.AUTH_SECRET = 'corto';
    expect(() => globalThis.issueToken_({ sub: 'u_1', sid: 'ses_1', v: 1 })).toThrow();
  });
});

// ── 5. Renovación deslizante (§3.2) ──────────────────────────────────────

describe('renewMeta_', () => {
  // iat/exp con la vida restante que queramos probar.
  function payloadConVida(restanteMs) {
    const now = Date.now();
    const total = 6 * HOUR;
    return {
      sub: 'u_1',
      sid: 'ses_1',
      v: 1,
      iat: now - (total - restanteMs),
      exp: now + restanteMs,
      aud: 'admin',
      orig: now - 1 * HOUR,
    };
  }

  it('queda más del 25 % de vida ⇒ no renueva', () => {
    expect(globalThis.renewMeta_(payloadConVida(3 * HOUR))).toBeNull();
  });

  it('queda menos del 25 % de vida ⇒ renueva', () => {
    const meta = globalThis.renewMeta_(payloadConVida(0.5 * HOUR));
    expect(meta).not.toBeNull();
    expect(typeof meta.renewedToken).toBe('string');
    const res = globalThis.verifyToken_(meta.renewedToken);
    expect(res.ok).toBe(true);
    // el token nuevo vuelve a tener 6 h de vida y conserva la sesión
    expect(res.payload.exp - res.payload.iat).toBe(6 * HOUR);
    expect(res.payload.sid).toBe('ses_1');
    expect(res.payload.orig).toBeLessThan(Date.now());
  });

  it('pasados los 7 días de la sesión ⇒ no renueva (D10-2)', () => {
    const p = payloadConVida(0.5 * HOUR);
    p.orig = Date.now() - 8 * 24 * HOUR;
    expect(globalThis.renewMeta_(p)).toBeNull();
  });

  it('token ya vencido ⇒ no renueva', () => {
    const now = Date.now();
    const p = { ...freshPayload(), iat: now - 7 * HOUR, exp: now - HOUR, orig: now - 7 * HOUR };
    expect(globalThis.renewMeta_(p)).toBeNull();
  });

  it('payload sin estructura válida ⇒ null', () => {
    expect(globalThis.renewMeta_(null)).toBeNull();
    expect(globalThis.renewMeta_({})).toBeNull();
    expect(globalThis.renewMeta_({ iat: 'x', exp: 'y' })).toBeNull();
  });
});
