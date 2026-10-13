// api/__tests__/notifications — R9.5.8 · notificaciones salientes (B14 · O5).
//
// Dos familias de garantías cubren acá:
//
//  1. **La validación al arranque** (validate-registry): `resource.notify`
//     es vocabulario nuevo, así que cada forma de mentir debe ser ROJA al
//     cargar — arreglo malformado, clave de más, fase pre o desconocida,
//     canal distinto de `email` (whatsapp incluido: cuota desconocida),
//     template/to vacíos, subject no-string y el par { on, to } duplicado.
//     Y el caso positivo: fases post canónicas y alias legacy pasan limpios.
//
//  2. **El envío** (engine/36-notifications): el bus emite la fase y el
//     suscriptor auto-registrado hace UN MailApp.sendEmail por entrada,
//     con el destinatario y el cuerpo resueltos (placeholders `{campo}`
//     sobre el payload de la escritura). Y la garantía O4: si el envío
//     FALLA, la escritura se conserva y el fallo queda registrado — nunca
//     rollback, nunca silencio. La cuota (100/día) exige además NO gastar
//     un envío con un destinatario sin resolver.
//
// Patrón de carga: mismo `loadBackend` que el resto de la suite — el backend
// son scripts planos compartiendo un scope global. La suscripción al bus es
// de CARGA (auto-suscripción al final de 36-notifications), así que los
// tests de envío NO la re-registran: ejercitan el camino real de extremo a
// extremo.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let resources_;
let storageMap_;
let resourceCreate_;
let resourcePut_;
let validateRegistry_;
let snapshot;
let mailSpy;
let original;

const SHEET = '__nt_sheet__';
const RESOURCE_ID = '__nt_test__';

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

/** Notificación con forma válida; `extra` pisa o añade claves para el caso. */
function notify(extra = {}) {
  return {
    on: 'afterCreate',
    channel: 'email',
    template: 'Hola {customer_name}',
    to: '{email}',
    ...extra,
  };
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
      { key: 'email', type: 'text' },
      { key: 'customer_name', type: 'text' },
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

/** Payload de alta de prueba (los placeholders resuelven contra esto). */
function createPayload_(extra = {}) {
  return { key: 'p1', name: 'pan', email: 'ana@example.com', customer_name: 'Ana', ...extra };
}

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  resources_ = REGISTRY.resources;
  storageMap_ = globalThis.storageMap_;
  resourceCreate_ = globalThis.resourceCreate_;
  resourcePut_ = globalThis.resourcePut_;
  validateRegistry_ = globalThis.validateRegistry_;
});

beforeEach(() => {
  snapshot = JSON.parse(JSON.stringify(REGISTRY.resources));
  original = { MailApp: globalThis.MailApp };
  mailSpy = vi.fn();
  globalThis.MailApp = { sendEmail: mailSpy };
});

afterEach(() => {
  REGISTRY.resources = snapshot;
  resources_ = REGISTRY.resources;
  Object.assign(globalThis, original);
  delete REGISTRY.resources[RESOURCE_ID];
  vi.restoreAllMocks();
});

// ── 1 · validación al arranque ─────────────────────────────────────────────

describe('R9.5.8 · validate-registry — notify', () => {
  it('un recurso con notify válido no produce ningún issue', () => {
    const issues = mutate(() => {
      resources_.orders.notify = [
        notify(),
        notify({ on: 'afterUpdate', template: 'Editaron {key}' }),
        notify({ on: 'onStatusChange', template: 'Estado → {status}' }),
        notify({ on: 'afterCreate', to: 'ops@example.com', subject: 'Alta de {key}' }),
        // Alias legacy aceptados (mismo vocabulario que resource.hooks/webhooks).
        notify({ on: 'create', to: 'ops@example.com' }),
        notify({ on: 'delete', to: 'ops@example.com', template: 'Baja de {key}' }),
        notify({ on: 'reorder', to: 'ops@example.com', template: 'Reorden' }),
      ];
    });
    expect(issues).toEqual([]);
  });

  it('notify que no es un arreglo se rechaza (la spec dice objeto, pero el contrato es arreglo)', () => {
    const issues = mutate(() => {
      resources_.orders.notify = { on: 'afterCreate' };
    });
    expect(issues).toEqual(['resources.orders.notify: debe ser un arreglo de notificaciones']);
  });

  it('un item que no es un objeto se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.notify = ['Hola'];
    });
    expect(issues).toEqual([
      'resources.orders.notify[0]: debe ser un objeto { on, channel, template, to, subject? }',
    ]);
  });

  it('una clave fuera del vocabulario (typo) se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.notify = [notify({ method: 'put' })];
    });
    expect(issues).toEqual(["resources.orders.notify[0]: clave desconocida 'method'"]);
  });

  it('beforeCreate se rechaza con mensaje claro: es una fase PRE', () => {
    const issues = mutate(() => {
      resources_.orders.notify = [notify({ on: 'beforeCreate' })];
    });
    expect(issues).toEqual([
      "resources.orders.notify[0].on: 'beforeCreate' es una fase PRE (corre antes de escribir) — una notificación sólo puede reaccionar a fases post",
    ]);
  });

  it('una fase desconocida se rechaza (y afterDelete no es vocabulario: se usa el alias delete)', () => {
    const issues = mutate(() => {
      resources_.orders.notify = [notify({ on: 'onFoo' })];
    });
    expect(issues).toEqual(["resources.orders.notify[0].on: fase desconocida 'onFoo'"]);

    const trasLegacy = mutate(() => {
      resources_.orders.notify = [notify({ on: 'afterDelete' })];
    });
    expect(trasLegacy).toEqual(["resources.orders.notify[0].on: fase desconocida 'afterDelete'"]);
  });

  it('on ausente o no-string se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.notify = [notify({ on: undefined })];
    });
    expect(issues).toEqual(['resources.orders.notify[0].on: debe ser el nombre de una fase']);
  });

  it("channel 'whatsapp' se rechaza: sólo email es canal con cuota conocida hoy", () => {
    const issues = mutate(() => {
      resources_.orders.notify = [notify({ channel: 'whatsapp' })];
    });
    expect(issues).toEqual([
      "resources.orders.notify[0].channel: sólo 'email' es un canal con cuota conocida hoy (MailApp 100/día) — se recibió 'whatsapp'",
    ]);
  });

  it('un canal desconocido se rechaza (y el ausente también)', () => {
    const sms = mutate(() => {
      resources_.orders.notify = [notify({ channel: 'sms' })];
    });
    expect(sms).toEqual([
      "resources.orders.notify[0].channel: sólo 'email' es un canal con cuota conocida hoy (MailApp 100/día) — se recibió 'sms'",
    ]);

    const sinCanal = mutate(() => {
      resources_.orders.notify = [notify({ channel: undefined })];
    });
    expect(sinCanal).toEqual([
      "resources.orders.notify[0].channel: debe ser 'email' (hoy único canal con cuota conocida)",
    ]);
  });

  it('template ausente o vacío se rechaza', () => {
    const sinTemplate = mutate(() => {
      resources_.orders.notify = [notify({ template: undefined })];
    });
    expect(sinTemplate).toEqual([
      'resources.orders.notify[0].template: debe ser un string no vacío (el texto del mensaje)',
    ]);

    const vacio = mutate(() => {
      resources_.orders.notify = [notify({ template: '   ' })];
    });
    expect(vacio).toEqual([
      'resources.orders.notify[0].template: debe ser un string no vacío (el texto del mensaje)',
    ]);
  });

  it('to ausente o vacío se rechaza (el destinatario es obligatorio)', () => {
    const sinTo = mutate(() => {
      resources_.orders.notify = [notify({ to: undefined })];
    });
    expect(sinTo).toEqual([
      'resources.orders.notify[0].to: debe ser un string no vacío (email literal o placeholder {campo})',
    ]);

    const vacio = mutate(() => {
      resources_.orders.notify = [notify({ to: '  ' })];
    });
    expect(vacio).toEqual([
      'resources.orders.notify[0].to: debe ser un string no vacío (email literal o placeholder {campo})',
    ]);
  });

  it('subject no-string o vacío se rechaza (ausente: válido, el motor deriva el default)', () => {
    const issues = mutate(() => {
      resources_.orders.notify = [notify({ subject: 42 })];
    });
    expect(issues).toEqual([
      'resources.orders.notify[0].subject: debe ser un string no vacío (o ausente)',
    ]);

    const vacio = mutate(() => {
      resources_.orders.notify = [notify({ subject: ' ' })];
    });
    expect(vacio).toEqual([
      'resources.orders.notify[0].subject: debe ser un string no vacío (o ausente)',
    ]);
  });

  it('el par { on, to } duplicado se rechaza (es declaración repetida, no reintento)', () => {
    const issues = mutate(() => {
      resources_.orders.notify = [notify(), notify({ template: 'Otra vez {customer_name}' })];
    });
    expect(issues).toEqual([
      "resources.orders.notify[1]: el par on/to 'afterCreate → {email}' ya se envía en otra notificación del recurso",
    ]);
    expect(issues).toHaveLength(1);
  });

  it('mismo to con otra fase (o misma fase con otro to) NO es duplicado', () => {
    const issues = mutate(() => {
      resources_.orders.notify = [
        notify(),
        notify({ on: 'afterUpdate' }), // mismo to, otra fase
        notify({ to: 'ops@example.com' }), // misma fase, otro to
      ];
    });
    expect(issues).toEqual([]);
  });
});

// ── 2 · envío: el bus llama a MailApp ──────────────────────────────────────

describe('R9.5.8 · entrega — el bus reparte a MailApp', () => {
  it('un recurso SOLO con notify (sin hooks) envía tras el create, con destinatario y cuerpo resueltos', () => {
    const s = scenario_(
      buildResource_({
        notify: [
          { on: 'afterCreate', channel: 'email', to: '{email}', template: 'Hola {customer_name}' },
        ],
      }),
    );
    expect(s.resource.hooks).toBeUndefined(); // el caso crítico: SIN hooks declarados

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: createPayload_(),
    });

    // La escritura ocurrió (y no tiró): la notificación es REACCIÓN, no veto.
    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');

    expect(mailSpy).toHaveBeenCalledTimes(1); // UN envío por entrada por evento, sin reintentos
    const [to, subject, body] = mailSpy.mock.calls[0];
    expect(to).toBe('ana@example.com'); // {email} resuelto contra el payload
    expect(body).toBe('Hola Ana'); // {customer_name} reemplazado, sin llaves
    expect(subject).toBe(RESOURCE_ID + ' · afterCreate'); // default derivado
  });

  it('subject declarado se renderiza con el MISMO mecanismo de placeholders', () => {
    const s = scenario_(
      buildResource_({
        notify: [
          {
            on: 'afterCreate',
            channel: 'email',
            to: 'ops@example.com',
            subject: 'Pedido {key} confirmado',
            template: 'Alta de {customer_name}',
          },
        ],
      }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: createPayload_(),
    });

    expect(mailSpy).toHaveBeenCalledTimes(1);
    expect(mailSpy.mock.calls[0][1]).toBe('Pedido p1 confirmado');
    expect(mailSpy.mock.calls[0][2]).toBe('Alta de Ana');
  });

  it('alias legacy: `on: "create"` envía en el create (el CRUD emite afterCreate)', () => {
    const s = scenario_(
      buildResource_({
        notify: [{ on: 'create', channel: 'email', to: '{email}', template: 'Listo {key}' }],
      }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: createPayload_(),
    });

    expect(mailSpy).toHaveBeenCalledTimes(1);
    expect(mailSpy.mock.calls[0][0]).toBe('ana@example.com');
  });

  it('cada entrada declarada envía SU correo (uno por entrada, sin duplicar)', () => {
    const s = scenario_(
      buildResource_({
        notify: [
          { on: 'afterCreate', channel: 'email', to: '{email}', template: 'Para el cliente' },
          { on: 'afterCreate', channel: 'email', to: 'ops@example.com', template: 'Para ops' },
        ],
      }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: createPayload_(),
    });

    expect(mailSpy).toHaveBeenCalledTimes(2);
    expect(mailSpy.mock.calls.map(([to]) => to)).toEqual(['ana@example.com', 'ops@example.com']);
  });

  it('una fase que la entrada NO declaró no envía (afterUpdate no dispara una notificación de afterCreate)', () => {
    const s = scenario_(
      buildResource_({
        notify: [{ on: 'afterCreate', channel: 'email', to: '{email}', template: 'Hola' }],
      }),
      [['p1', 'Pan', 'ana@example.com', 'Ana']],
    );

    resourcePut_(s.ss, s.resource, s.map, {
      method: 'PUT',
      params: { key: 'p1' },
      payload: { name: 'Pan 2' },
    });

    expect(mailSpy).not.toHaveBeenCalled();
  });

  it('un destinatario sin resolver NO gasta cuota: no se envía y queda registrado', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = scenario_(
      buildResource_({
        notify: [{ on: 'afterCreate', channel: 'email', to: '{no_existe}', template: 'Hola' }],
      }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: createPayload_(),
    });

    expect(s.sheet.rows().map((r) => r[0])).toContain('p1'); // la escritura sigue
    expect(mailSpy).not.toHaveBeenCalled(); // 100/día: nada de correos inventados
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[notifications] afterCreate'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('destinatario sin resolver'));
  });

  it('un recurso SOLO con webhooks (sin notify) no toca MailApp (aislamiento)', () => {
    const s = scenario_(
      buildResource_({
        webhooks: [{ on: 'afterCreate', url: 'https://hooks.example.com/orders' }],
      }),
    );
    expect(s.resource.notify).toBeUndefined();

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: createPayload_(),
    });

    expect(mailSpy).not.toHaveBeenCalled();
  });

  it('un recurso SIN notify no toca MailApp (el costo por evento ajeno es nulo)', () => {
    const s = scenario_(buildResource_(), [['p1', 'Pan']]);

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: createPayload_({ key: 'p2' }),
    });

    expect(mailSpy).not.toHaveBeenCalled();
  });
});

// ── 3 · O4 — el fallo de la notificación nunca deshace la escritura ────────

describe('R9.5.8 · O4 — fallo del envío: se audita, no se deshace', () => {
  it('MailApp.sendEmail que lanza: el create se conserva y el fallo queda registrado', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mailSpy.mockImplementation(() => {
      throw new Error('cuota agotada adrede');
    });
    const s = scenario_(
      buildResource_({
        notify: [{ on: 'afterCreate', channel: 'email', to: '{email}', template: 'Hola {key}' }],
      }),
    );

    expect(() =>
      resourceCreate_(s.ss, s.resource, s.map, {
        method: 'POST',
        payload: createPayload_(),
      }),
    ).not.toThrow();

    expect(s.sheet.rows().map((r) => r[0])).toContain('p1'); // la escritura NO se deshizo
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[notifications] afterCreate'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('cuota agotada adrede'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('email → ana@example.com'));
  });

  it('una notificación rota no impide el envío de las demás (cada una se aísla)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mailSpy
      .mockImplementationOnce(() => {
        throw new Error('el primero falla adrede');
      })
      .mockImplementationOnce(() => {});
    const s = scenario_(
      buildResource_({
        notify: [
          { on: 'afterCreate', channel: 'email', to: '{email}', template: 'Uno' },
          { on: 'afterCreate', channel: 'email', to: 'ops@example.com', template: 'Dos' },
        ],
      }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: createPayload_(),
    });

    expect(mailSpy).toHaveBeenCalledTimes(2);
    expect(mailSpy.mock.calls[1][0]).toBe('ops@example.com');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('el primero falla adrede'));
    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');
  });
});
