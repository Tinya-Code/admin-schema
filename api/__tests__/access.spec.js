// api/__tests__/access — Niveles de `access` en 11-auth (R2.4, auth.md §4.4).
//
// Lo que éste archivo cubre:
//
//  1. **Que los niveles que el schema declara hoy (`admin`, `public`)
//     siguen resolviendo igual** — con la forma de identidad que la cadena
//     de §3.4 entrega desde R2.6 (objeto `{ role, active }`).
//  2. **Que el vocabulario nuevo existe y resuelve**: `session`,
//     `role:staff`, `role:admin` (alias `admin`) y el fail-closed de
//     «sin declarar ⇒ role:admin».
//  3. **Que los niveles `role:*` son un MÍNIMO** (admin ≥ staff), que es lo
//     que hace que un admin pase también por `role:staff`.
//  4. **Que un rol insuficiente da 403 y no 401.** §4.5 distingue ambos
//     con efectos distintos en el front: 403 ⇒ «sin permiso» SIN cerrar
//     sesión; 401 ⇒ limpiar sesión e ir a login. Mezclarlos rompería R2.9.
//
// D21-C (R2.6): **la forma `string` de `identity` ya no existe.** Antes
// aceptaba el token admin plano y asumía rol admin; el token admin antiguo
// se retiró, así que aquí SÓLO llega lo que `verifySession_` verificó.
// `requireAdmin_` tampoco existe — hay un test que lo comprueba.

import { beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

// Identidad tal y como la devuelve la cadena de §3.4 (fila de `_users`).
const ADMIN = { id: 'u_1', email: 'ana@x.com', role: 'admin', active: true };
const STAFF = { id: 'u_2', email: 'bob@x.com', role: 'staff', active: true };
const SIN_ROL = { id: 'u_3', email: 'caro@x.com', role: '', active: true };

// Se asigna en beforeAll: antes de loadBackend() la función aún no existe.
let access;

beforeAll(() => {
  loadBackend();
  access = globalThis.requireAccess_;
});

// Devuelve el apiStatus de lo que lance, o null si no lanza nada.
function statusOf(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return typeof err.apiStatus === 'number' ? err.apiStatus : 500;
  }
}

// ── 1. Aditivo: lo de hoy sigue igual ────────────────────────────────────

describe('aditivo — los niveles actuales siguen valiendo (F6-3)', () => {
  it('public sigue dejando pasar sin identidad', () => {
    expect(access('', 'public')).toBe(true);
    expect(access(undefined, 'public')).toBe(true);
    expect(access(null, 'public')).toBe(true);
    expect(access(ADMIN, 'public')).toBe(true);
  });

  it("una identidad admin sigue abriendo 'admin'", () => {
    expect(access(ADMIN, 'admin')).toBe(true);
  });

  it('una identidad admin pasa por TODOS los niveles del vocabulario', () => {
    for (const level of ['admin', 'role:admin', 'session', 'role:staff']) {
      expect(access(ADMIN, level), level).toBe(true);
    }
  });

  it('sin identidad resuelta ⇒ 401 en cualquier nivel no público', () => {
    // Incluye la forma `string`, que desde D21-C ya no es una identidad:
    // un token plano llegando aquí significa que la cadena no corrió.
    for (const level of ['admin', 'role:admin', 'session', 'role:staff', 'bogus']) {
      for (const nada of ['', undefined, null, 'token-plano-heredado']) {
        expect(
          statusOf(() => access(nada, level)),
          `${level} / ${String(nada)}`,
        ).toBe(401);
      }
    }
  });

  it('un nivel desconocido cae a role:admin (fail-closed), no a public', () => {
    expect(access(ADMIN, 'bogus')).toBe(true);
    // …y sin identidad no pasa, que es lo que hace que sea restrictivo.
    expect(statusOf(() => access('', 'bogus'))).toBe(401);
    expect(statusOf(() => access(SIN_ROL, 'bogus'))).toBe(403);
  });

  it('D21-C: requireAdmin_ y la forma string ya no existen', () => {
    expect(globalThis.requireAdmin_).toBeUndefined();
    // Un string ya no se interpreta como token admin: da 401, no asume rol.
    expect(statusOf(() => access('token-admin-secreto', 'admin'))).toBe(401);
  });

  it('staff no pasa por role:admin (403), y sin rol tampoco (403)', () => {
    expect(statusOf(() => access(STAFF, 'role:admin'))).toBe(403);
    expect(statusOf(() => access(SIN_ROL, 'role:admin'))).toBe(403);
  });
});

// ── 2. Vocabulario ───────────────────────────────────────────────────────

describe('normalizeAccessLevel_ (auth.md §4.4)', () => {
  it.each([
    ['public', 'public'],
    ['session', 'session'],
    ['admin', 'role:admin'], // alias declarado
    ['role:admin', 'role:admin'],
    ['role:staff', 'role:staff'],
    // fail-closed: sin declarar, vacío, basura o tipos raros ⇒ role:admin
    [undefined, 'role:admin'],
    [null, 'role:admin'],
    ['', 'role:admin'],
    ['   ', 'role:admin'],
    ['bogus', 'role:admin'],
    ['staff', 'role:admin'], // sin el prefijo role: NO es vocabulario
    ['ADMIN', 'role:admin'], // no se ignoran mayúsculas: cae al default
    [42, 'role:admin'],
    [{}, 'role:admin'],
  ])('%p ⇒ %p', (input, expected) => {
    expect(globalThis.normalizeAccessLevel_(input)).toBe(expected);
  });

  it("el default del router (sin política ⇒ 'admin') llega como role:admin", () => {
    expect(globalThis.normalizeAccessLevel_('admin')).toBe('role:admin');
  });
});

// ── 3. Identidad resuelta (forma que pasará R2.6) ────────────────────────

describe('requireAccess_ con identidad resuelta { role, active }', () => {
  const admin = { role: 'admin', active: true };
  const staff = { role: 'staff', active: true };

  it('admin activo pasa todos los niveles', () => {
    for (const level of ['session', 'role:staff', 'role:admin']) {
      expect(access(admin, level), level).toBe(true);
    }
  });

  it('staff activo pasa role:staff y session, pero NO role:admin (403)', () => {
    expect(access(staff, 'role:staff')).toBe(true);
    expect(access(staff, 'session')).toBe(true);
    expect(statusOf(() => access(staff, 'role:admin'))).toBe(403);
    expect(statusOf(() => access(staff, 'admin'))).toBe(403);
  });

  it('los niveles role:* son un MÍNIMO: admin ≥ staff', () => {
    expect(access(admin, 'role:staff')).toBe(true);
    expect(access(staff, 'role:staff')).toBe(true);
  });

  it('un rol no reconocido no supera role:admin ⇒ 403', () => {
    expect(statusOf(() => access({ role: 'cliente', active: true }, 'role:admin'))).toBe(403);
    expect(statusOf(() => access({ role: '', active: true }, 'role:admin'))).toBe(403);
    expect(statusOf(() => access({ active: true }, 'role:admin'))).toBe(403);
  });

  it('activo en falso o identidad sin `active` ⇒ 401, no 403', () => {
    // §4.5: usuario inactivo es AUTH_INVALID (limpiar sesión), no FORBIDDEN.
    expect(statusOf(() => access({ role: 'admin', active: false }, 'role:admin'))).toBe(401);
    expect(statusOf(() => access({ role: 'admin' }, 'role:admin'))).toBe(401);
    expect(statusOf(() => access({ role: 'admin' }, 'session'))).toBe(401);
    expect(statusOf(() => access({}, 'public'))).toBe(null); // public sigue pasando
  });

  it('session exige sólo estar autenticado y activo', () => {
    expect(access(staff, 'session')).toBe(true);
    expect(access({ role: 'cualquiera', active: true }, 'session')).toBe(true);
    expect(statusOf(() => access({ role: 'cualquiera', active: false }, 'session'))).toBe(401);
  });

  it('identidades nulas o no objeto ⇒ 401 en niveles protegidos', () => {
    for (const identity of [null, undefined, 0, false]) {
      expect(
        statusOf(() => access(identity, 'role:admin')),
        String(identity),
      ).toBe(401);
      expect(
        statusOf(() => access(identity, 'session')),
        String(identity),
      ).toBe(401);
    }
  });

  it('un rol insuficiente da 403 (FORBIDDEN) y NO 401', () => {
    // La distinción importa: R2.9 la usa para no cerrar la sesión en 403.
    expect(statusOf(() => access(staff, 'role:admin'))).toBe(403);
    expect(statusOf(() => access(staff, 'role:admin'))).not.toBe(401);
  });
});
