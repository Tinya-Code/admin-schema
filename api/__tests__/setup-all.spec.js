// api/__tests__/setup-all — D24: setup declarativo de una sola pieza.
//
// Dos cosas se prueban acá que ninguna otra parte cubre:
//
//  1. **`checkProperties()` CREA las propiedades manuales** con `''` y sólo
//     pide cambiarles el valor. Sin eso, el operador tenía que poner clave Y
//     valor a mano en el editor — y un `''` tiene que seguir contando como
//     «sin configurar» (`Props.require`), no como valor válido.
//  2. **El orden y la política de fallo de `setupAll()`**: seis funciones
//     sueltas que había que correr a mano en orden, y un paso que falla no
//     debe arrastrar los demás en la oscuridad.
//
// Los pasos se STUBBEAN: lo que se verifica acá es la orquestación, no el
// interior de `setupDrift`/`setupSeed` (eso lo cubre setup-flujo.spec.js).

import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { loadBackend } from './_harness.js';

const STEPS = [
  'checkProperties',
  'setupSpreadsheet',
  'setupSheets',
  'setupSeed',
  'setupDrift',
  'setupAuth_',
  'setupTriggers_',
  'bootstrapAdmin_',
];

let store;
let orig;

beforeAll(() => {
  loadBackend();
});

beforeEach(() => {
  orig = {
    get: globalThis.Props.get,
    has: globalThis.Props.has,
    setAll: globalThis.Props.setAll,
  };
  store = {
    SPREADSHEET_ID: 'libro-1',
    CLOUDINARY_CLOUD_NAME: 'demo',
    CLOUDINARY_API_KEY: 'k',
    CLOUDINARY_API_SECRET: 's',
    CLOUDINARY_BASE_FOLDER: 'admin',
    ENV: 'dev',
    AUTH_SECRET: 'secreto',
    KDF_ITERATIONS: '1000',
    SCHEMA_VERSION: 'abc123',
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'secreta',
  };
  globalThis.Props.get = (name) => (name in store ? store[name] : null);
  globalThis.Props.has = (name) => name in store;
  globalThis.Props.setAll = (values) => Object.assign(store, values);
});

afterEach(() => {
  globalThis.Props.get = orig.get;
  globalThis.Props.has = orig.has;
  globalThis.Props.setAll = orig.setAll;
  // Los pasos se stubbean dentro de cada test; devolver los reales no hace
  // falta (son funciones declaradas, se redeclaran en la carga), pero sí el
  // orden de la lista de editor.
  globalThis.EDITOR_ONLY_FNS = [
    'setupAuth_',
    'rotateAuthSecret_',
    'bootstrapAdmin_',
    'setupTriggers_',
    'setupAll',
  ];
});

// ── 1. checkProperties: crea claves, no las pide ──────────────────────────

describe('checkProperties (D24 — crear, no pedir)', () => {
  it('crea con "" las claves manuales que falten y las lista como pendientes', () => {
    delete store.ADMIN_EMAIL;
    delete store.ADMIN_PASSWORD;

    const r = globalThis.checkProperties();

    expect(store.ADMIN_EMAIL).toBe(''); // la clave YA existe…
    expect(store.ADMIN_PASSWORD).toBe('');
    expect(r.ok).toBe(false); // …pero sigue pidiendo el valor
    expect(r.creadas).toEqual(expect.arrayContaining(['ADMIN_EMAIL', 'ADMIN_PASSWORD']));
    expect(r.pendientes).toEqual(expect.arrayContaining(['ADMIN_EMAIL', 'ADMIN_PASSWORD']));
    expect(r.missing).toBeUndefined(); // el viejo nombre ya no aplica
  });

  it('con todo lleno devuelve ok y no escribe nada', () => {
    const antes = { ...store };

    const r = globalThis.checkProperties();

    expect(r.ok).toBe(true);
    expect(r.creadas).toEqual([]);
    expect(store).toEqual(antes);
  });

  it('un "" ya creado cuenta como pendiente, no como configurado', () => {
    store.ADMIN_EMAIL = '';
    store.ADMIN_PASSWORD = 'secreta';

    const r = globalThis.checkProperties();

    expect(r.ok).toBe(false);
    expect(r.pendientes).toEqual(['ADMIN_EMAIL']);
    expect(r.creadas).toEqual([]); // no se «creó»: ya estaba
  });

  it('ENV inválido se reporta en invalid, no se silencia', () => {
    store.ENV = 'staging';

    const r = globalThis.checkProperties();

    expect(r.ok).toBe(false);
    expect(r.invalid.join(' ')).toMatch(/ENV/);
    expect(r.invalid.join(' ')).toMatch(/dev \| prod/);
  });

  it('Props.require trata "" como NO configurada (el placeholder no degrada el error)', () => {
    store.ADMIN_EMAIL = '';
    expect(() => globalThis.Props.require('ADMIN_EMAIL')).toThrow(/Falta configurar la propiedad/);

    store.ADMIN_EMAIL = 'a@b.com';
    expect(globalThis.Props.require('ADMIN_EMAIL')).toBe('a@b.com');
  });

  it('el manifiesto declara el email y la contraseña del admin como manuales', () => {
    const email = globalThis.PROP_MANIFEST.find((e) => e.name === 'ADMIN_EMAIL');
    const pass = globalThis.PROP_MANIFEST.find((e) => e.name === 'ADMIN_PASSWORD');
    expect(email).toMatchObject({ source: 'manual', secret: false });
    expect(pass).toMatchObject({ source: 'manual', secret: true });
  });
});

// ── 2. setupAll: orden y política de fallo ────────────────────────────────

/** Reemplaza todos los pasos por un stub controlado. */
function stubAll(handler) {
  const llamadas = [];
  STEPS.forEach((name) => {
    globalThis[name] = () => {
      llamadas.push(name);
      return handler(name);
    };
  });
  return llamadas;
}

describe('setupAll (D24 — un solo punto de entrada)', () => {
  it('encadena los pasos en el orden del setup y devuelve ok', () => {
    const orden = stubAll(() => ({ ok: true }));

    const r = globalThis.setupAll();

    expect(orden).toEqual([
      'checkProperties',
      'setupSpreadsheet',
      'setupSheets',
      'setupSeed',
      'setupDrift',
      'setupAuth_',
      'setupTriggers_',
      'bootstrapAdmin_',
    ]);
    expect(r.ok).toBe(true);
    expect(r.detenidoEn).toBe(null);
    expect(r.pasos.map((p) => p.paso)).toEqual(orden);
    expect(r.pasos.every((p) => p.ok)).toBe(true);
  });

  it('un paso que LANZA detiene la cadena ahí y nombra el paso', () => {
    stubAll(() => ({ ok: true }));
    globalThis.setupSheets = () => {
      throw new Error('No existe la hoja _users — ejecuta setupSheets() primero');
    };
    const seed = vi.fn();
    globalThis.setupSeed = seed;

    const r = globalThis.setupAll();

    expect(r.ok).toBe(false);
    expect(r.detenidoEn).toBe('setupSheets');
    expect(r.pasos.find((p) => p.paso === 'setupSheets').detalle).toMatch(/_users/);
    expect(seed).not.toHaveBeenCalled(); // nada corre tras el fallo
    expect(r.pasos.some((p) => p.paso === 'bootstrapAdmin_')).toBe(false);
  });

  it('checkProperties con pendientes NO detiene nada — sólo falta el valor', () => {
    stubAll(() => ({ ok: true }));
    globalThis.checkProperties = () => ({
      ok: false,
      creadas: ['ADMIN_EMAIL'],
      pendientes: ['ADMIN_EMAIL'],
      invalid: [],
      pending: [],
    });

    const r = globalThis.setupAll();

    expect(r.ok).toBe(true);
    expect(r.detenidoEn).toBe(null);
    expect(r.pendientesDeValor).toEqual(['ADMIN_EMAIL']);
    expect(r.pasos.find((p) => p.paso === 'checkProperties').ok).toBe(true);
  });

  it('{ seed: false } salta setupSeed sin tocar el resto', () => {
    const orden = stubAll(() => ({ ok: true }));

    const r = globalThis.setupAll({ seed: false });

    expect(orden).not.toContain('setupSeed');
    expect(orden).toContain('setupDrift');
    expect(r.ok).toBe(true);
  });

  it('409 de bootstrapAdmin_ es «ya existía», no un fallo', () => {
    stubAll(() => ({ ok: true }));
    globalThis.bootstrapAdmin_ = () => {
      const e = new Error('Ya existe un usuario con ese email: a@b.com');
      e.apiStatus = 409;
      throw e;
    };

    const r = globalThis.setupAll();

    expect(r.ok).toBe(true);
    expect(r.detenidoEn).toBe(null);
    expect(r.pasos.find((p) => p.paso === 'bootstrapAdmin_')).toEqual({
      paso: 'bootstrapAdmin_',
      ok: true,
      detalle: 'Ya existe un usuario con ese email: a@b.com',
    });
  });

  it('setupAll está en EDITOR_ONLY_FNS: crea un admin, no puede exponerse', () => {
    expect(globalThis.EDITOR_ONLY_FNS).toContain('setupAll');
  });

  it('forward de { email, password } a bootstrapAdmin_ (D24)', () => {
    stubAll(() => ({ ok: true }));
    const spy = vi.fn(() => ({ ok: true, email: 'x@y.com' }));
    globalThis.bootstrapAdmin_ = spy;

    globalThis.setupAll({ email: 'x@y.com', password: 'secreta' });
    expect(spy).toHaveBeenCalledWith('x@y.com', 'secreta');

    spy.mockClear();
    globalThis.setupAll(); // sin opts ⇒ nada que enviar
    expect(spy).toHaveBeenCalledWith(undefined, undefined);
  });

  it('un detalle de reporte malformado NO falla el paso (informar ≠ ejecutar)', () => {
    stubAll(() => ({ ok: true })); // sin los campos que detallePaso_ espera
    globalThis.setupDrift = () => ({ ok: true });

    const r = globalThis.setupAll();

    expect(r.ok).toBe(true);
    expect(r.detenidoEn).toBe(null);
  });
});
