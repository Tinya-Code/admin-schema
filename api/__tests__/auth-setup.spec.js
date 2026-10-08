// api/__tests__/auth-setup — KDF de contraseñas (R2.1b/D19) y altas de auth
// sólo-desde-editor (R2.2, auth.md §4.7).
//
// Tres cosas se prueban acá que ninguna otra parte del sistema cubre:
//
//  1. **El KDF no es SHA-256 plano** (§9.1): `pass_hash` tiene forma
//     `s256$<iteraciones>$<hex>` y la verificación usa el recuento que se
//     EMITIÓ en ese hash, no el global. De ahí sale que subir el coste no
//     rompa hashes viejos.
//  2. **El coste no está fijado en el código**: `medirKdf_` devuelve un
//     entero dentro de [MIN, MAX] y respeta el presupuesto; sin reloj
//     medible cae al TECHO, nunca al suelo (hash débil sería peor que un
//     login lento).
//  3. **«Nunca por endpoint» es estructural**: el router resuelve handlers
//     con `globalThis[handler]`, así que sin `EDITOR_ONLY_FNS` cualquiera
//     que declarara `setupAuth_` en `REGISTRY.endpoints` la expondría.
//
// El backend son scripts planos con un scope global compartido, así que los
// tests parchean `Props`/`Utilities` y los restauran (mismo criterio que
// pin-generate.spec.js y pin-verify.spec.js).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBackend } from './_harness.js';

const COLS = [
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

// Hash determinista y barato: el real usa Utilities.computeDigest, que está
// stubbeado en el harness. Lo que importa es que CAMBIE en cada iteración
// y que sea estable entre llamadas.
function fakeSha(text) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < String(text).length; i++) {
    const c = String(text).charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c * (i + 1), 2654435761) >>> 0;
  }
  return (h1.toString(16) + h2.toString(16)).padStart(16, '0').repeat(2);
}

let orig;
let store;

function patchEnv(overrides = {}) {
  store = { AUTH_SECRET: 'secreto-de-prueba', KDF_ITERATIONS: '1000', ...overrides.props };
  globalThis.Props.get = (name) => (name in store ? store[name] : null);
  globalThis.Props.setAll = (values) => Object.assign(store, values);
  globalThis.Props.hashText = fakeSha;
  globalThis.Utilities = { getUuid: nextUuid };
  globalThis.Session = { getActiveUser: () => ({ getEmail: () => 'dueno@example.com' }) };
}

let uuidCounter = 0;
function nextUuid() {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
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
    Session: globalThis.Session,
    openSpreadsheet_: globalThis.openSpreadsheet_,
    readSheetData_: globalThis.readSheetData_,
    cronometrarKdf_: globalThis.cronometrarKdf_,
    setupAuth_: globalThis.setupAuth_,
  };
  patchEnv();
});

afterEach(() => {
  Object.assign(globalThis, orig);
});

// ── 1. KDF ────────────────────────────────────────────────────────────────

describe('kdfHash_ / kdfVerify_ (R2.1b)', () => {
  it('emite pass_hash autocontenido: s256$<iteraciones>$<hex>', () => {
    const hash = globalThis.kdfHash_('clave-secreta', 'salsita', 10);
    expect(hash).toMatch(/^s256\$10\$[0-9a-f]+$/);
    expect(hash.split('$')).toHaveLength(3);
  });

  it('la verificación acepta la contraseña correcta y rechaza la otra', () => {
    const salt = globalThis.kdfNewSalt_();
    const hash = globalThis.kdfHash_('correcta', salt, 10);
    expect(globalThis.kdfVerify_('correcta', salt, hash)).toBe(true);
    expect(globalThis.kdfVerify_('incorrecta', salt, hash)).toBe(false);
  });

  it('usa el recuento del PROPIO hash, no el global (subir el coste no rompe viejos)', () => {
    // Hash emitido con coste 5…
    const salt = 'salsita';
    const hashViejo = globalThis.kdfHash_('clave', salt, 5);

    // …y el coste global sube a 5000.
    store.KDF_ITERATIONS = '5000';

    // Sigue verificando: el recuento sale del hash, no de KDF_ITERATIONS.
    expect(globalThis.kdfVerify_('clave', salt, hashViejo)).toBe(true);
    expect(globalThis.kdfVerify_('clave', salt, globalThis.kdfHash_('clave', salt, 5000))).toBe(
      true,
    );
    // Y el hash viejo NO es igual al nuevo: el coste cambió el resultado.
    expect(hashViejo).not.toBe(globalThis.kdfHash_('clave', salt, 5000));
  });

  it('estructura corrupta ⇒ false, nunca lanza (el login responde genérico)', () => {
    const salt = 'salsita';
    for (const mala of [null, undefined, '', 'texto plano', 's256$abc$zz', 'x$1$zz', 's256$0$zz']) {
      expect(() => globalThis.kdfVerify_('clave', salt, mala), String(mala)).not.toThrow();
      expect(globalThis.kdfVerify_('clave', salt, mala), String(mala)).toBe(false);
    }
  });

  it('dos usuarios distintos ⇒ sal distinta aunque la contraseña sea la misma', () => {
    const h1 = globalThis.kdfHash_('misma', globalThis.kdfNewSalt_(), 10);
    const h2 = globalThis.kdfHash_('misma', globalThis.kdfNewSalt_(), 10);
    expect(h1).not.toBe(h2);
  });

  it('kdfIterations_ exige KDF_ITERATIONS y falla claro si falta', () => {
    expect(globalThis.kdfIterations_()).toBe(1000);
    delete store.KDF_ITERATIONS;
    expect(() => globalThis.kdfIterations_()).toThrow(/KDF_ITERATIONS/);
  });

  it('kdfIterations_ rechaza un valor que no sea entero ≥ 1', () => {
    for (const mala of ['abc', '0', '-5', '3.5']) {
      store.KDF_ITERATIONS = mala;
      expect(() => globalThis.kdfIterations_(), mala).toThrow(/KDF_ITERATIONS/);
    }
  });
});

// ── 2. Coste medido ───────────────────────────────────────────────────────

describe('medirKdf_ (R2.1b — el coste NO va fijado en el código)', () => {
  it('devuelve un entero dentro de [KDF_ITERATIONS_MIN, KDF_ITERATIONS_MAX]', () => {
    const n = globalThis.medirKdf_();
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(globalThis.CONFIG.KDF_ITERATIONS_MIN);
    expect(n).toBeLessThanOrEqual(globalThis.CONFIG.KDF_ITERATIONS_MAX);
  });

  it('con coste medible, cae dentro del presupuesto', () => {
    globalThis.cronometrarKdf_ = (it) => it * 0.1; // 0,1 ms/iteración
    const presupuesto = 400;
    const n = globalThis.medirKdf_(presupuesto);
    expect(n).toBeGreaterThan(globalThis.CONFIG.KDF_ITERATIONS_MIN);
    expect(n * 0.1).toBeLessThanOrEqual(presupuesto);
  });

  it('si el modelo lineal se equivoca, BAJA hasta entrar (nunca sube)', () => {
    // Coste no lineal: la interop a Java tiene coste fijo por llamada, así
    // que el modelo calibrado se equivoca y hace falta corregir.
    let mediciones = 0;
    const coste = (it) => {
      mediciones += 1;
      return Math.pow(it, 1.5) * 0.0005;
    };
    globalThis.cronometrarKdf_ = coste;

    const n = globalThis.medirKdf_(400);

    // probe + al menos una corrección
    expect(mediciones).toBeGreaterThan(1);
    // y el número devuelvido YA cabe en el presupuesto medido de verdad
    expect(coste(n)).toBeLessThanOrEqual(400);
    expect(n).toBeGreaterThanOrEqual(globalThis.CONFIG.KDF_ITERATIONS_MIN);
    expect(n).toBeLessThanOrEqual(globalThis.CONFIG.KDF_ITERATIONS_MAX);
  });

  it('sin reloj medible ⇒ TECHO (nunca un hash débil por prisa)', () => {
    globalThis.cronometrarKdf_ = () => 0;
    expect(globalThis.medirKdf_(400)).toBe(globalThis.CONFIG.KDF_ITERATIONS_MAX);
  });

  it('coste desbocado ⇒ se detiene en el SUelo de seguridad, no por debajo', () => {
    globalThis.cronometrarKdf_ = (it) => it * 2; // 2 ms/iteración: carísimo
    const n = globalThis.medirKdf_(400);
    expect(n).toBe(globalThis.CONFIG.KDF_ITERATIONS_MIN);
  });

  it('respeta el techo aunque la medida sugiera más', () => {
    globalThis.cronometrarKdf_ = () => 0.001;
    const n = globalThis.medirKdf_(400);
    expect(n).toBe(globalThis.CONFIG.KDF_ITERATIONS_MAX);
  });
});

// ── 3. setupAuth_ ─────────────────────────────────────────────────────────

describe('setupAuth_ (R2.2)', () => {
  // OJO: el store de arriba viene PRECARGADO para los tests del KDF. Acá se
  // necesita exactamente lo contrario — arrancar de cero, como un despliegue
  // recién creado.
  beforeEach(() => {
    store = {};
  });

  it('genera AUTH_SECRET y KDF_ITERATIONS si faltan', () => {
    const res = globalThis.setupAuth_();
    expect(res.ok).toBe(true);
    expect(res.creado).toEqual(['AUTH_SECRET', 'KDF_ITERATIONS']);
    expect(store.AUTH_SECRET).toBeTruthy();
    expect(store.KDF_ITERATIONS).toBeTruthy();
    expect(Number(store.KDF_ITERATIONS)).toBeGreaterThanOrEqual(
      globalThis.CONFIG.KDF_ITERATIONS_MIN,
    );
  });

  it('es idempotente: segunda corrida no pisa nada (rotar AUTH_SECRET es otra operación)', () => {
    globalThis.setupAuth_();
    const secreto = store.AUTH_SECRET;
    const res = globalThis.setupAuth_();
    expect(res.creado).toEqual([]);
    expect(store.AUTH_SECRET).toBe(secreto);
  });

  it('la segunda corrida también conserva KDF_ITERATIONS (no re-mide)', () => {
    globalThis.setupAuth_();
    const n = store.KDF_ITERATIONS;
    globalThis.setupAuth_();
    expect(store.KDF_ITERATIONS).toBe(n);
  });

  it('jamás devuelve ni loguea el AUTH_SECRET', () => {
    const res = globalThis.setupAuth_();
    expect(JSON.stringify(res)).not.toContain(store.AUTH_SECRET);
  });
});

// ── 4. bootstrapAdmin_ ────────────────────────────────────────────────────

function fakeSheet() {
  const writes = [];
  return {
    appendRow: vi.fn(),
    // Escrituras por rango registradas como { row, col, value }: el motor
    // escribe por índice derivado de la cabecera (D25).
    writes,
    getRange: vi.fn((row, col) => ({
      setValue: (value) => writes.push({ row, col, value }),
    })),
  };
}

describe('bootstrapAdmin_ (R2.2)', () => {
  let sheet;

  beforeEach(() => {
    globalThis.setupAuth_();
    sheet = fakeSheet();
    globalThis.openSpreadsheet_ = () => ({
      getSheetByName: (n) => (n === '_users' ? sheet : null),
    });
    globalThis.readSheetData_ = () => ({ sheet, headers: COLS, rows: [] });
  });

  it('escribe la fila de admin con el orden EXACTO de las cabeceras', () => {
    const res = globalThis.bootstrapAdmin_('Ana@Example.com', 'secreta', 'Ana');
    expect(res.ok).toBe(true);
    expect(sheet.appendRow).toHaveBeenCalledTimes(1);

    const fila = sheet.appendRow.mock.calls[0][0];
    expect(fila).toHaveLength(COLS.length);
    expect(COLS[5]).toBe('token_version');
    expect(fila[COLS.indexOf('email')]).toBe('ana@example.com'); // normalizado
    expect(fila[COLS.indexOf('role')]).toBe('admin');
    expect(fila[COLS.indexOf('active')]).toBe(true);
    expect(fila[COLS.indexOf('token_version')]).toBe(1);
    expect(fila[COLS.indexOf('pass_hash')]).toMatch(/^s256\$/);
    expect(fila[COLS.indexOf('pass_salt')]).toBeTruthy();
    expect(fila[COLS.indexOf('id')]).toBeTruthy();
  });

  it('el hash escrito verifica contra la contraseña dada (no es un string cualquiera)', () => {
    globalThis.bootstrapAdmin_('a@b.com', 'secreta');
    const fila = sheet.appendRow.mock.calls[0][0];
    expect(
      globalThis.kdfVerify_(
        'secreta',
        fila[COLS.indexOf('pass_salt')],
        fila[COLS.indexOf('pass_hash')],
      ),
    ).toBe(true);
    expect(
      globalThis.kdfVerify_(
        'otra',
        fila[COLS.indexOf('pass_salt')],
        fila[COLS.indexOf('pass_hash')],
      ),
    ).toBe(false);
  });

  it('sin contraseña la genera y avisa UNA sola vez', () => {
    const res = globalThis.bootstrapAdmin_('a@b.com');
    expect(res.passwordGenerada).toBe(true);
    expect(res.email).toBe('a@b.com');
  });

  it('sin email usa el del dueño (auth.md §4.7)', () => {
    const res = globalThis.bootstrapAdmin_();
    expect(res.email).toBe('dueno@example.com');
  });

  // ── D25: reconciliación de una fila existente ────────────────────────────
  //
  // El caso real: el admin se creó con la contraseña GENERADA del primer
  // run; después el operador setea ADMIN_PASSWORD y esa no entra. D25 hace
  // que la contraseña explícita sea la fuente de verdad de esa fila.

  function filaExistente(at, email, id, password) {
    const salt = 'sal-' + id;
    const hash = password ? globalThis.kdfHash_(password, salt, globalThis.kdfIterations_()) : '';
    return {
      at,
      values: COLS.map((c) => {
        if (c === 'email') return email;
        if (c === 'id') return id;
        if (c === 'pass_salt') return salt;
        if (c === 'pass_hash') return hash;
        return '';
      }),
    };
  }

  it('fila existente SIN contraseña explícita ⇒ 409 y NO escribe', () => {
    globalThis.readSheetData_ = () => ({
      sheet,
      headers: COLS,
      rows: [filaExistente(2, 'a@b.com', 'id-1', 'la-vieja')],
    });
    expect(() => globalThis.bootstrapAdmin_('A@b.com')).toThrow(/Ya existe/);
    expect(sheet.appendRow).not.toHaveBeenCalled();
    expect(sheet.writes).toHaveLength(0);
  });

  it('fila existente CON contraseña explícita ⇒ ACTUALIZA, no duplica (D25)', () => {
    globalThis.readSheetData_ = () => ({
      sheet,
      headers: COLS,
      rows: [filaExistente(4, 'a@b.com', 'id-1', 'la-vieja')],
    });

    const res = globalThis.bootstrapAdmin_('a@b.com', 'la-nueva');

    expect(res.ok).toBe(true);
    expect(res.actualizada).toBe(true);
    expect(res.id).toBe('id-1'); // conserva la identidad original
    expect(res.passwordGenerada).toBe(false);
    expect(sheet.appendRow).not.toHaveBeenCalled(); // NO una segunda fila

    expect(sheet.writes).toHaveLength(2);
    const salt = sheet.writes.find((w) => w.col === COLS.indexOf('pass_salt') + 1);
    const hash = sheet.writes.find((w) => w.col === COLS.indexOf('pass_hash') + 1);
    expect(salt.row).toBe(4); // la fila FÍSICA de esa fila, no la 1ª
    expect(hash.row).toBe(4);
    expect(globalThis.kdfVerify_('la-nueva', salt.value, hash.value)).toBe(true);
    expect(globalThis.kdfVerify_('la-vieja', salt.value, hash.value)).toBe(false);
  });

  it('ADMIN_PASSWORD de props también reconcilia (el caso real de D25)', () => {
    store.ADMIN_EMAIL = 'a@b.com';
    store.ADMIN_PASSWORD = 'desde-props';
    globalThis.readSheetData_ = () => ({
      sheet,
      headers: COLS,
      rows: [filaExistente(2, 'a@b.com', 'id-9', 'generada-en-el-primer-run')],
    });

    const res = globalThis.bootstrapAdmin_(); // sin argumentos: sólo props

    expect(res.actualizada).toBe(true);
    expect(res.passwordGenerada).toBe(false);
    const salt = sheet.writes.find((w) => w.col === COLS.indexOf('pass_salt') + 1);
    const hash = sheet.writes.find((w) => w.col === COLS.indexOf('pass_hash') + 1);
    expect(globalThis.kdfVerify_('desde-props', salt.value, hash.value)).toBe(true);
  });

  it('si ya era esa contraseña no se re-hashea (idempotente, D25)', () => {
    globalThis.readSheetData_ = () => ({
      sheet,
      headers: COLS,
      rows: [filaExistente(3, 'a@b.com', 'id-2', 'misma')],
    });

    const res = globalThis.bootstrapAdmin_('a@b.com', 'misma');

    expect(res.ok).toBe(true);
    expect(res.actualizada).toBe(false);
    expect(sheet.writes).toHaveLength(0); // ni salt nuevo ni escritura
    expect(sheet.appendRow).not.toHaveBeenCalled();
  });

  it('sin setupAuth_ previo ⇒ se niega en claro', () => {
    delete store.AUTH_SECRET;
    expect(() => globalThis.bootstrapAdmin_('a@b.com', 'x')).toThrow(/setupAuth_/);
    expect(sheet.appendRow).not.toHaveBeenCalled();
  });

  it('sin hoja _users ⇒ se niega en claro', () => {
    globalThis.openSpreadsheet_ = () => ({ getSheetByName: () => null });
    expect(() => globalThis.bootstrapAdmin_('a@b.com', 'x')).toThrow(/setupSheets/);
  });

  // ── D24: Script Properties como fuente ───────────────────────────────────

  it('sin argumentos lee ADMIN_EMAIL/ADMIN_PASSWORD de Script Properties', () => {
    store.ADMIN_EMAIL = 'Prop@Example.COM';
    store.ADMIN_PASSWORD = 'desde-props';

    const res = globalThis.bootstrapAdmin_();

    expect(res.email).toBe('prop@example.com'); // normalizado igual que con args
    expect(res.passwordGenerada).toBe(false); // no se generó: vino de la prop
    const fila = sheet.appendRow.mock.calls[0][0];
    expect(
      globalThis.kdfVerify_(
        'desde-props',
        fila[COLS.indexOf('pass_salt')],
        fila[COLS.indexOf('pass_hash')],
      ),
    ).toBe(true);
  });

  it('el argumento gana sobre la propiedad (orden: args > props > dueño)', () => {
    store.ADMIN_EMAIL = 'props@x.com';
    store.ADMIN_PASSWORD = 'pass-props';

    const res = globalThis.bootstrapAdmin_('args@x.com', 'pass-args');

    expect(res.email).toBe('args@x.com');
    const fila = sheet.appendRow.mock.calls[0][0];
    expect(
      globalThis.kdfVerify_(
        'pass-args',
        fila[COLS.indexOf('pass_salt')],
        fila[COLS.indexOf('pass_hash')],
      ),
    ).toBe(true);
  });

  it('propiedades vacías ⇒ cae al dueño con contraseña generada (auth.md §4.7)', () => {
    // `checkProperties()` crea las claves con `''`: no pueden valer como
    // credencial, tienen que seguir contando como «sin configurar».
    store.ADMIN_EMAIL = '';
    store.ADMIN_PASSWORD = '';

    const res = globalThis.bootstrapAdmin_();

    expect(res.email).toBe('dueno@example.com');
    expect(res.passwordGenerada).toBe(true);
  });
});

// ── 5. «Nunca por endpoint» ───────────────────────────────────────────────

describe('EDITOR_ONLY_FNS (R2.2 — nunca por endpoint)', () => {
  it('la lista contiene las funciones de editor (incluye setupAll — D24)', () => {
    expect(globalThis.EDITOR_ONLY_FNS).toEqual(['setupAuth_', 'bootstrapAdmin_', 'setupAll']);
  });

  it('el router las bloquea ANTES de invocarlas (403, y el handler no corre)', () => {
    const spy = vi.fn();
    globalThis.setupAuth_ = spy;
    const route = { kind: 'handler', handler: 'setupAuth_', params: {}, policy: {} };
    const envelope = { method: 'POST', path: '/admin/x', payload: {} };

    expect(() => globalThis.dispatchRoute_(route, envelope)).toThrow(
      /sólo ejecutable desde el editor/,
    );
    expect(spy).not.toHaveBeenCalled(); // el guard es PRIMERO, no un catch
  });

  it('un handler normal sí se invoca (el guard no traba lo legítimo)', () => {
    globalThis.REGISTRY.handlers = globalThis.REGISTRY.handlers || {};
    globalThis.REGISTRY.handlers.__pruebaInocua = () => ({ hola: 'mundo' });
    const route = { kind: 'handler', handler: '__pruebaInocua', params: {}, policy: {} };
    const envelope = { method: 'POST', path: '/admin/x', payload: {} };
    const out = globalThis.dispatchRoute_(route, envelope);
    expect(out.getContent()).toBe(JSON.stringify({ hola: 'mundo' }));
    delete globalThis.REGISTRY.handlers.__pruebaInocua;
  });

  it('validateRegistry_ denuncia un endpoint que declare una función de editor', () => {
    globalThis.REGISTRY.endpoints.__prueba = {
      route: '/admin/prueba',
      method: 'POST',
      handler: 'setupAuth_',
    };
    try {
      const issues = globalThis.validateRegistry_();
      expect(issues.some((i) => i.includes("handler 'setupAuth_'"))).toBe(true);
    } finally {
      delete globalThis.REGISTRY.endpoints.__prueba;
    }
  });

  it('sin esa declaración, validateRegistry_ no dice nada del tema', () => {
    expect(globalThis.validateRegistry_().some((i) => i.includes('desde el editor'))).toBe(false);
  });
});
