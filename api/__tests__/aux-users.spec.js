// api/__tests__/aux-users — Hoja `_users` (R2.1, auth.md §4.1).
//
// Es la hoja que sostiene toda la Fase 2: identidad, rol, `token_version`
// (basta subirlo para matar TODAS las sesiones de un usuario) y el par
// `pass_hash`/`pass_salt` de la Opción B (§9.1 — KDF SHA-256 iterado con
// salt, porque GAS no tiene bcrypt).
//
// El guard más importante de acá es el de EXPOSICIÓN: `_users` es una hoja
// interna, y sólo se la puede exponer a través de un recurso. Hoy no existe
// `REGISTRY.resources.users` — eso es R7.6 (Fase 7) — así que cualquier
// aparición de `_users` dentro de `REGISTRY.resources` significa que alguien
// la declaró recurso ANTES de tiempo y estaría sirviendo `pass_hash` en
// `/admin/schema`.

import { beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

const COLUMNAS_ESPERADAS = [
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

let auxSheetColumns;
let getSheetSpecs_;

beforeAll(() => {
  loadBackend();
  auxSheetColumns = globalThis.auxSheetColumns;
  getSheetSpecs_ = globalThis.getSheetSpecs_;
});

describe('_users (hoja interna)', () => {
  it('declara exactamente las 10 columnas de auth.md §4.1', () => {
    expect(auxSheetColumns('_users')).toEqual(COLUMNAS_ESPERADAS);
  });

  it('está en AUX_SHEET_ORDER — setupSheets la va a crear', () => {
    expect(globalThis.AUX_SHEET_ORDER).toContain('_users');
    const spec = getSheetSpecs_().find((s) => s.name === '_users');
    expect(spec, 'falta el spec de _users en getSheetSpecs_()').toBeTruthy();
    expect(spec.kind).toBe('aux');
    expect(spec.colSpecs.map((c) => c.name)).toEqual(COLUMNAS_ESPERADAS);
  });

  it('lleva el par de la Opción B: pass_hash + pass_salt (§9.1)', () => {
    const cols = auxSheetColumns('_users');
    expect(cols).toContain('pass_hash');
    expect(cols).toContain('pass_salt');
  });

  it('lleva token_version — es lo que invalida todas las sesiones (§9.2)', () => {
    expect(auxSheetColumns('_users')).toContain('token_version');
  });

  it('desde R7.6 SÍ hay recurso `users` — apunta a _users, sólo admin', () => {
    // R2.1 lo prohibía (exponerlo antes de tiempo mandaría pass_hash a
    // /admin/schema). R7.6 introduce el tipo `secret`: pass_hash/pass_salt/
    // token_version jamás viajan ni se publican, así que el recurso ya es
    // seguro de declarar (auth.md §4.2).
    const users = globalThis.REGISTRY.resources.users;
    expect(users, 'falta el recurso users (R7.6)').toBeTruthy();
    expect(users.sheet).toBe('_users');
    expect(users.kind).toBe('collection');
    expect(users.policies.access.read).toBe('role:admin');
    expect(users.policies.access.write).toBe('role:admin');
    // El nombre interno sigue prohibido: la hoja no es recurso.
    expect(Object.keys(globalThis.REGISTRY.resources)).not.toContain('_users');
  });

  it('los campos secret de users (pass_hash, pass_salt, token_version) nunca se publican', () => {
    const users = globalThis.REGISTRY.resources.users;
    const secretKeys = users.fields.filter((f) => f.type === 'secret').map((f) => f.key);
    expect(secretKeys.sort()).toEqual(['pass_hash', 'pass_salt', 'token_version']);
    // Ni en listProjection (validate-registry lo vuelve rojo al arranque).
    for (const key of secretKeys) {
      expect(users.listProjection || []).not.toContain(key);
    }
  });

  it('NINGÚN recurso usa _users como hoja hija (field.sheet)', () => {
    // Las hojas hijas se nombran con `field.sheet` (02-setup-sheets.js:127).
    // El primer expect es el anti-vacío: si algún día no hubiera ningún
    // child-sheet en el schema, este test estaría mintiendo.
    const hijas = Object.values(globalThis.REGISTRY.resources)
      .flatMap((r) => r.fields || [])
      .filter((f) => f.sheet);
    expect(hijas.length, 'no hay ningún field con hoja hija que recorrer').toBeGreaterThan(0);

    for (const field of hijas) {
      expect(field.sheet).not.toBe('_users');
    }
  });
});
