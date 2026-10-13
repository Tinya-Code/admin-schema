// api/__tests__/webhooks — R9.5.7 · webhooks salientes (B14 · O5).
//
// Dos familias de garantías cubren acá:
//
//  1. **La validación al arranque** (validate-registry): `resource.webhooks`
//     es vocabulario nuevo, así que cada forma de mentir debe ser ROJA al
//     cargar — arreglo malformado, clave de más, fase pre o desconocida,
//     url http/relativa, sign no booleano, par { on, url } duplicado. Y el
//     caso positivo: fases post canónicas y alias legacy pasan limpios.
//
//  2. **La entrega** (engine/35-webhooks): el bus emite la fase y el
//     suscriptor auto-registrado hace UN UrlFetchApp.fetch por webhook, con
//     el cuerpo y la firma (HMAC-SHA256 sobre AUTH_SECRET) correctos —
//     también en un recurso SIN hooks (sólo webhooks): ése es el test
//     crítico del patrón "el CRUD emite, el bus reparte". Y la garantía
//     O4: si el fetch FALLA (red o HTTP ≥ 300), la escritura se conserva y
//     el fallo queda registrado — nunca rollback, nunca silencio.
//
// Patrón de carga: mismo `loadBackend` que el resto de la suite — el backend
// son scripts planos compartiendo un scope global. La suscripción al bus es
// de CARGA (auto-suscripción al final de 35-webhooks), así que los tests de
// entrega NO la re-registran: ejercitan el camino real de extremo a extremo.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBackend } from './_harness.js';
import { realUtilities } from './_auth-fixtures.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let resources_;
let storageMap_;
let resourceCreate_;
let resourcePut_;
let resourceDelete_;
let validateRegistry_;
let snapshot;
let propsStore;
let fetchSpy;
let original;

// Secreto de firma de prueba: authSecret_ exige ≥ 16 caracteres.
const SECRET = 'secreto-de-webhooks-1234567890';
const SHEET = '__wh_sheet__';
const RESOURCE_ID = '__wh_test__';

// ── Utilidades ─────────────────────────────────────────────────────────────

/** Mutación con restauración: cada caso deja el registro exactamente como estaba. */
function mutate(fn) {
  const before = JSON.parse(JSON.stringify(REGISTRY.resources));
  try {
    fn();
    return validateRegistry_();
  } finally {
    REGISTRY.resources = before;
    resources_ = REGISTRY.resources; // el restore REEMPLAZA el objeto: refrescar la referencia
  }
}

/** Webhook con forma válida; `extra` pisa o añade claves para el caso. */
function webhook(extra = {}) {
  return { on: 'afterCreate', url: 'https://hooks.example.com/orders', sign: true, ...extra };
}

/** Recurso mínimo (mismo esqueleto que crud-hooks: sin lock, sin audit). */
function buildResource_(extra = {}) {
  return {
    id: RESOURCE_ID,
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
    fields: [
      { key: 'key', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
    ],
    ...extra,
  };
}

/** App fake con la hoja del recurso (+ filas sembradas opcionales). */
function scenario_(resource, rows) {
  const map = storageMap_(resource);
  const headers = map.columns.map((col) => col.flatKey);
  const sheet = fakeSheet_([headers, ...(rows || [])]);
  return { resource, map, ss: fakeApp_({ [SHEET]: sheet }), sheet };
}

/** Cuerpo JSON que el último fetch recibió. */
function lastBody() {
  return JSON.parse(fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][1].payload);
}

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  resources_ = REGISTRY.resources;
  storageMap_ = globalThis.storageMap_;
  resourceCreate_ = globalThis.resourceCreate_;
  resourcePut_ = globalThis.resourcePut_;
  resourceDelete_ = globalThis.resourceDelete_;
  validateRegistry_ = globalThis.validateRegistry_;
});

beforeEach(() => {
  snapshot = JSON.parse(JSON.stringify(REGISTRY.resources));
  original = {
    Utilities: globalThis.Utilities,
    UrlFetchApp: globalThis.UrlFetchApp,
    PropertiesService: globalThis.PropertiesService,
  };
  // AUTH_SECRET real (fake): la firma del webhook pasa por hmac_, que
  // resuelve el secreto por Props — como en schedules (PropertiesService
  // fake) y en auth-session (Utilities real).
  propsStore = { AUTH_SECRET: SECRET };
  globalThis.PropertiesService = {
    getScriptProperties: () => ({
      getProperties: () => Object.assign({}, propsStore),
      setProperties: (values) => Object.assign(propsStore, values),
    }),
  };
  globalThis.Props.clearCache();
  globalThis.Utilities = realUtilities;
  fetchSpy = vi.fn(() => ({ getResponseCode: () => 200 }));
  globalThis.UrlFetchApp = { fetch: fetchSpy };
});

afterEach(() => {
  REGISTRY.resources = snapshot;
  resources_ = REGISTRY.resources;
  Object.assign(globalThis, original);
  globalThis.Props.clearCache();
  delete REGISTRY.resources[RESOURCE_ID];
  vi.restoreAllMocks();
});

// ── 1 · validación al arranque ─────────────────────────────────────────────

describe('R9.5.7 · validate-registry — webhooks', () => {
  it('un recurso con webhooks válidos no produce ningún issue', () => {
    const issues = mutate(() => {
      resources_.orders.webhooks = [
        webhook(),
        webhook({ on: 'afterUpdate', url: 'https://hooks.example.com/orders-updated' }),
        webhook({
          on: 'onStatusChange',
          url: 'https://hooks.example.com/orders-status',
          sign: false,
        }),
        // Alias legacy aceptados (mismo vocabulario que resource.hooks).
        webhook({ on: 'create', url: 'https://hooks.example.com/orders-legacy-create' }),
        webhook({ on: 'delete', url: 'https://hooks.example.com/orders-legacy-delete' }),
        webhook({ on: 'reorder', url: 'https://hooks.example.com/orders-legacy-reorder' }),
      ];
    });
    expect(issues).toEqual([]);
  });

  it('sign ausente o false es válido (default: entrega sin firma)', () => {
    const issues = mutate(() => {
      resources_.orders.webhooks = [
        { on: 'afterCreate', url: 'https://hooks.example.com/a' },
        { on: 'afterUpdate', url: 'https://hooks.example.com/b', sign: false },
        { on: 'afterCreate', url: 'https://hooks.example.com/c', sign: undefined },
      ];
    });
    expect(issues).toEqual([]);
  });

  it('webhooks que no es un arreglo se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.webhooks = { on: 'afterCreate' };
    });
    expect(issues).toEqual(['resources.orders.webhooks: debe ser un arreglo de webhooks']);
  });

  it('un item que no es un objeto se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.webhooks = ['https://hooks.example.com/orders'];
    });
    expect(issues).toEqual(['resources.orders.webhooks[0]: debe ser un objeto { on, url, sign }']);
  });

  it('una clave fuera del vocabulario (typo) se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.webhooks = [webhook({ method: 'put' })];
    });
    expect(issues).toEqual(["resources.orders.webhooks[0]: clave desconocida 'method'"]);
  });

  it('beforeCreate se rechaza con mensaje claro: es una fase PRE', () => {
    const issues = mutate(() => {
      resources_.orders.webhooks = [webhook({ on: 'beforeCreate' })];
    });
    expect(issues).toEqual([
      "resources.orders.webhooks[0].on: 'beforeCreate' es una fase PRE (corre antes de escribir) — un webhook sólo puede reaccionar a fases post",
    ]);
  });

  it('una fase desconocida se rechaza (y afterDelete no es vocabulario: se usa el alias delete)', () => {
    const issues = mutate(() => {
      resources_.orders.webhooks = [webhook({ on: 'onFoo' })];
    });
    expect(issues).toEqual(["resources.orders.webhooks[0].on: fase desconocida 'onFoo'"]);

    const trasLegacy = mutate(() => {
      resources_.orders.webhooks = [webhook({ on: 'afterDelete' })];
    });
    expect(trasLegacy).toEqual(["resources.orders.webhooks[0].on: fase desconocida 'afterDelete'"]);
  });

  it('on ausente o no-string se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.webhooks = [webhook({ on: undefined })];
    });
    expect(issues).toEqual(['resources.orders.webhooks[0].on: debe ser el nombre de una fase']);
  });

  it('url ausente o no-string se rechaza', () => {
    const sinUrl = mutate(() => {
      resources_.orders.webhooks = [webhook({ url: undefined })];
    });
    expect(sinUrl).toEqual(['resources.orders.webhooks[0].url: debe ser una URL https absoluta']);

    const urlRara = mutate(() => {
      resources_.orders.webhooks = [webhook({ url: 42 })];
    });
    expect(urlRara).toEqual(['resources.orders.webhooks[0].url: debe ser una URL https absoluta']);
  });

  it('url http:// o relativa se rechaza (fail-closed: sólo https absoluto)', () => {
    ['http://hooks.example.com/x', 'hooks.example.com/x', '/hooks/x'].forEach((url) => {
      const issues = mutate(() => {
        resources_.orders.webhooks = [webhook({ url })];
      });
      expect(issues).toEqual([
        `resources.orders.webhooks[0].url: '${url}' debe empezar por https:// (fail-closed)`,
      ]);
    });
  });

  it('sign no booleano se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.webhooks = [webhook({ sign: 'yes' })];
    });
    expect(issues).toEqual(['resources.orders.webhooks[0].sign: debe ser booleano (o ausente)']);
  });

  it('el par { on, url } duplicado se rechaza (es declaración repetida, no reintento)', () => {
    const issues = mutate(() => {
      resources_.orders.webhooks = [webhook(), webhook({ sign: false })];
    });
    expect(issues).toEqual([
      "resources.orders.webhooks[1]: el par on/url 'afterCreate → https://hooks.example.com/orders' ya se entrega en otro webhook del recurso",
    ]);
    expect(issues).toHaveLength(1);
  });

  it('misma URL con otra fase (o misma fase con otra URL) NO es duplicado', () => {
    const issues = mutate(() => {
      resources_.orders.webhooks = [
        webhook(),
        webhook({ on: 'afterUpdate' }), // misma URL, otra fase
        webhook({ url: 'https://hooks.example.com/orders-b' }), // misma fase, otra URL
      ];
    });
    expect(issues).toEqual([]);
  });
});

// ── 2 · entrega: el bus llama a UrlFetchApp ────────────────────────────────

describe('R9.5.7 · entrega — el bus reparte a UrlFetchApp', () => {
  it('un recurso SOLO con webhooks (sin hooks) entrega tras el create', () => {
    const s = scenario_(
      buildResource_({
        webhooks: [{ on: 'afterCreate', url: 'https://hooks.example.com/orders', sign: true }],
      }),
    );
    expect(s.resource.hooks).toBeUndefined(); // el caso crítico: SIN hooks declarados

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    // La escritura ocurrió (y no tiró): el webhook es REACCIÓN, no veto.
    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');

    expect(fetchSpy).toHaveBeenCalledTimes(1); // UN fetch por webhook por evento, sin reintentos
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://hooks.example.com/orders');
    expect(options.method).toBe('post');
    expect(options.contentType).toBe('application/json');
    expect(options.muteHttpExceptions).toBe(true);

    const body = JSON.parse(options.payload);
    expect(body).toMatchObject({
      resource: RESOURCE_ID,
      phase: 'afterCreate',
      key: 'p1',
      eventId: RESOURCE_ID + '|afterCreate|p1',
    });
    expect(body.payload).toMatchObject({ key: 'p1', name: 'pan' });
    expect(typeof body.firedAt).toBe('string');
  });

  it('sign: true firma el cuerpo EXACTO con HMAC-SHA256 sobre AUTH_SECRET (cabecera X-Webhook-Signature)', () => {
    const s = scenario_(
      buildResource_({
        webhooks: [{ on: 'afterCreate', url: 'https://hooks.example.com/s', sign: true }],
      }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    const [, options] = fetchSpy.mock.calls[0];
    // Misma primitiva que las sesiones: el receptor recomputa el HMAC del
    // cuerpo tal cual y compara en tiempo constante.
    expect(options.headers['X-Webhook-Signature']).toBe(
      globalThis.bytesToB64Url_(globalThis.hmac_(options.payload)),
    );
    expect(options.headers['X-Webhook-Signature']).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
  });

  it('sin sign (o false) se envía SIN cabecera de firma', () => {
    const s = scenario_(
      buildResource_({
        webhooks: [
          { on: 'afterCreate', url: 'https://hooks.example.com/unsigned' },
          { on: 'afterCreate', url: 'https://hooks.example.com/explicito', sign: false },
        ],
      }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mock.calls.forEach(([, options]) => {
      expect(options.headers).toBeUndefined();
    });
  });

  it('alias legacy: `on: "create"` entrega en el create con la fase canónica afterCreate', () => {
    const s = scenario_(
      buildResource_({
        webhooks: [{ on: 'create', url: 'https://hooks.example.com/legacy' }],
      }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastBody()).toMatchObject({
      phase: 'afterCreate', // la EMITIDA (canónica), la misma que codifica eventId
      key: 'p1',
      eventId: RESOURCE_ID + '|afterCreate|p1',
    });
  });

  it('alias legacy: `on: "delete"` entrega tras el borrado (el CRUD emite afterDelete)', () => {
    const s = scenario_(
      buildResource_({
        webhooks: [{ on: 'delete', url: 'https://hooks.example.com/baja' }],
      }),
      [['p1', 'Pan']],
    );

    resourceDelete_(s.ss, s.resource, s.map, { method: 'DELETE', params: { key: 'p1' } });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastBody()).toMatchObject({
      phase: 'afterDelete',
      key: 'p1',
      eventId: RESOURCE_ID + '|afterDelete|p1',
    });
  });

  it('cada webhook declarado recibe SU fetch (uno por webhook, sin duplicar)', () => {
    const s = scenario_(
      buildResource_({
        webhooks: [
          { on: 'afterCreate', url: 'https://hooks.example.com/uno' },
          { on: 'afterCreate', url: 'https://hooks.example.com/dos' },
        ],
      }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://hooks.example.com/uno',
      'https://hooks.example.com/dos',
    ]);
  });

  it('una fase que el webhook NO declaró no entrega (afterUpdate no dispara un webhook de afterCreate)', () => {
    const s = scenario_(
      buildResource_({
        webhooks: [{ on: 'afterCreate', url: 'https://hooks.example.com/orders' }],
      }),
      [['p1', 'Pan']],
    );

    resourcePut_(s.ss, s.resource, s.map, {
      method: 'PUT',
      params: { key: 'p1' },
      payload: { name: 'Pan 2' },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('un recurso SIN webhooks no toca UrlFetchApp (el costo por evento ajeno es nulo)', () => {
    const s = scenario_(buildResource_(), [['p1', 'Pan']]);

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p2', name: 'factura' },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── 3 · O4 — el fallo del webhook nunca deshace la escritura ───────────────

describe('R9.5.7 · O4 — fallo del webhook: se audita, no se deshace', () => {
  it('fetch que lanza (red caída): el create se conserva y el fallo queda registrado', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(() => {
      throw new Error('red caída adrede');
    });
    const s = scenario_(
      buildResource_({
        webhooks: [{ on: 'afterCreate', url: 'https://hooks.example.com/roto', sign: true }],
      }),
    );

    expect(() =>
      resourceCreate_(s.ss, s.resource, s.map, {
        method: 'POST',
        payload: { key: 'p1', name: 'pan' },
      }),
    ).not.toThrow();

    expect(s.sheet.rows().map((r) => r[0])).toContain('p1'); // la escritura NO se deshizo
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[webhooks] afterCreate'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('red caída adrede'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('https://hooks.example.com/roto'));
  });

  it('HTTP ≥ 300 del receptor: se registra el código y la escritura se conserva', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(() => ({ getResponseCode: () => 503 }));
    const s = scenario_(
      buildResource_({
        webhooks: [{ on: 'afterCreate', url: 'https://hooks.example.com/saturado' }],
      }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
  });

  it('un webhook roto no impide la entrega de los demás (cada uno se aísla)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy
      .mockImplementationOnce(() => {
        throw new Error('el primero falla adrede');
      })
      .mockImplementationOnce(() => ({ getResponseCode: () => 200 }));
    const s = scenario_(
      buildResource_({
        webhooks: [
          { on: 'afterCreate', url: 'https://hooks.example.com/uno' },
          { on: 'afterCreate', url: 'https://hooks.example.com/dos' },
        ],
      }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe('https://hooks.example.com/dos');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('el primero falla adrede'));
    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');
  });
});
