// api/__tests__/hooks-contract — bus de eventos interno ÚNICO (B9 · R5.6).
//
// Lo que cubre acá y ninguna otra parte cubre:
//
//  1. **`beforeCreate` modifica o VETA.** Mutación: fluye a la fila
//     escrita. Vetо: cualquier error se propaga y NO se escribe nada (la
//     fase pre corre bajo la validación declarativa, código de confianza).
//  2. **Orden determinista:** la lista se recorre en orden declarado y
//     `afterUpdate` corre antes que `onStatusChange`.
//  3. **Política `onError`:** `log` (default) registra y la escritura se
//     conserva · `ignore` traga en silencio · `compensate` ejecuta las
//     compensaciones que el hook registró con `ctx.onCompensate` (LIFO) y
//     DESPUÉS registra el error. ⚠️ O4: la escritura principal JAMÁS se
//     deshace.
//  4. **`onStatusChange` no adivina:** sólo dispara para campos con máquina
//     declarada en `resource.transitions` (R5.5) cuyo valor CAMBIÓ.
//  5. **El bus es único:** `onEvent_` suscribe observadores externos sin
//     que el recurso declare nada — el CRUD no se toca para sumar un
//     suscriptor. `ctx.eventId` es la manija estable para dedupe propio.
//
// La compatibilidad legacy (`create`/`update`/`delete`/`reorder` como
// alias de las fases nuevas) la cubre `crud-hooks.spec.js` entero, que
// sigue verde SIN cambios.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let storageMap_;
let resourceCreate_;
let resourcePut_;
let validateRegistry_;
let originalHooks;
let originalSubscribers;

const SHEET = '__bus_sheet__';
const AUX = '__bus_aux__';
const RESOURCE_ID = '__bus_test__';

/** Recurso mínimo; `extra` pisa/agrega claves (hooks, transitions, …). */
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
      { key: 'status', type: 'select', required: true, default: 'A', enum: ['A', 'B', 'C'] },
    ],
    ...extra,
  };
}

/** App fake con la hoja del recurso (+ aux opcional) y filas sembradas. */
function scenario_(resource, rows, auxRows) {
  const map = storageMap_(resource);
  const headers = map.columns.map((col) => col.flatKey);
  const sheet = fakeSheet_([headers, ...(rows || [])]);
  const sheets = { [SHEET]: sheet };
  if (auxRows) sheets[AUX] = fakeSheet_([['marca'], ...auxRows]);
  return { resource, map, ss: fakeApp_(sheets), headers, sheet };
}

const MAQUINA = { status: { A: ['B'], B: ['A', 'C'], C: ['B'] } };

function put_(s, payload) {
  return resourcePut_(s.ss, s.resource, s.map, {
    method: 'PUT',
    params: { key: 'p1' },
    payload,
  });
}

let fired;

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  storageMap_ = globalThis.storageMap_;
  resourceCreate_ = globalThis.resourceCreate_;
  resourcePut_ = globalThis.resourcePut_;
  validateRegistry_ = globalThis.validateRegistry_;
});

beforeEach(() => {
  fired = [];
  originalHooks = REGISTRY.hooks;
  originalSubscribers = globalThis.EVENT_SUBSCRIBERS_;
  // Registro directo (mismo estilo que crud-hooks.spec): el hook existe en
  // REGISTRY.hooks y el descriptor de capabilities no hace falta para que
  // el bus lo ejecute — validateHooks_ sólo exige la función.
  REGISTRY.hooks = Object.assign({}, REGISTRY.hooks, {
    grabador: (ctx) => {
      fired.push(ctx);
    },
  });
  globalThis.EVENT_SUBSCRIBERS_ = {};
});

afterEach(() => {
  REGISTRY.hooks = originalHooks;
  globalThis.EVENT_SUBSCRIBERS_ = originalSubscribers;
  delete REGISTRY.resources[RESOURCE_ID];
  vi.restoreAllMocks();
});

// ── 1. beforeCreate: modifica o veta ───────────────────────────────────────

describe('beforeCreate — fase pre', () => {
  it('la mutación del hook fluye a la fila escrita', () => {
    REGISTRY.hooks.rotular = (ctx) => {
      ctx.payload.name = ctx.payload.name.toUpperCase();
    };
    const s = scenario_(buildResource_({ hooks: { beforeCreate: ['rotular'] } }));

    const out = resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(s.sheet.rows()[1][1]).toBe('PAN');
    expect(out.name).toBe('PAN');
  });

  it('cualquier error VETA: se propaga y NO se escribe', () => {
    REGISTRY.hooks.veto = () => {
      throw new Error('veto adrede');
    };
    const s = scenario_(buildResource_({ hooks: { beforeCreate: ['veto'] } }));

    expect(() =>
      resourceCreate_(s.ss, s.resource, s.map, {
        method: 'POST',
        payload: { key: 'p1', name: 'pan' },
      }),
    ).toThrow(/veto adrede/);

    expect(s.sheet.rows().map((r) => r[0])).not.toContain('p1');
  });

  it('corre ANTES del append: el hook ve la hoja sin la fila', () => {
    const s = scenario_(buildResource_()); // la hoja existe ANTES del hook
    REGISTRY.hooks.espias = (ctx) => {
      expect(s.sheet.rows().map((r) => r[0])).not.toContain('p1');
      fired.push(ctx);
    };
    s.resource.hooks = { beforeCreate: ['espias'] };

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(fired).toHaveLength(1);
    expect(fired[0].action).toBe('beforeCreate');
    // La fase pre no tiene `summary`: no hay hecho todavía que resumir.
    expect(fired[0].summary).toBeUndefined();
  });
});

// ── 2. Orden determinista ──────────────────────────────────────────────────

describe('orden determinista', () => {
  it('los hooks de una fase corren en orden declarado', () => {
    ['a', 'b', 'c'].forEach((n) => {
      REGISTRY.hooks[n] = () => {
        fired.push(n);
      };
    });
    const s = scenario_(buildResource_({ hooks: { afterCreate: ['c', 'a', 'b'] } }));

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(fired).toEqual(['c', 'a', 'b']);
  });

  it('afterUpdate corre ANTES que onStatusChange', () => {
    REGISTRY.hooks.grabador = (ctx) => {
      fired.push(ctx.action);
    };
    const s = scenario_(
      buildResource_({
        hooks: { afterUpdate: ['grabador'], onStatusChange: ['grabador'] },
        transitions: MAQUINA,
      }),
      [['p1', 'Pan', 'A']],
    );

    put_(s, { status: 'B' });

    expect(fired).toEqual(['afterUpdate', 'onStatusChange']);
  });

  it('el alias legacy corre después de la fase nominada, con su nombre viejo', () => {
    REGISTRY.hooks.grabador = (ctx) => {
      fired.push(ctx.action);
    };
    const s = scenario_(
      buildResource_({ hooks: { afterCreate: ['grabador'], create: ['grabador'] } }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(fired).toEqual(['afterCreate', 'create']);
  });
});

// ── 3. Política onError (post-escritura, O4) ───────────────────────────────

describe('onError — la escritura jamás se deshace (O4)', () => {
  it('default `log`: el error se registra y la escritura se conserva', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    REGISTRY.hooks.boom = () => {
      throw new Error('falla adrede');
    };
    const s = scenario_(buildResource_({ hooks: { afterCreate: ['boom'] } }));

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[hooks] afterCreate'));
  });

  it('`ignore`: traga en silencio (opt-in explícito)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    REGISTRY.hooks.boom = () => {
      throw new Error('falla adrede');
    };
    const s = scenario_(
      buildResource_({ hooks: { afterCreate: [{ id: 'boom', onError: 'ignore' }] } }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');
    expect(spy).not.toHaveBeenCalled();
  });

  it('`compensate`: deshace los efectos PARCIALES del hook (LIFO) y registra el error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const aux = fakeSheet_([['marca']]);
    // Efecto parcial: append ANTES de fallar. La compensación lo deshace.
    REGISTRY.hooks.parcial = (ctx) => {
      aux.appendRow(['efecto-parcial']);
      ctx.onCompensate(() =>
        aux.getRange(1, 1, aux.getLastRow(), aux.getLastColumn()).clearContent(),
      );
      throw new Error('falla a mitad de camino');
    };
    const s = scenario_(
      buildResource_({ hooks: { afterCreate: [{ id: 'parcial', onError: 'compensate' }] } }),
    );

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    // La escritura principal SE CONSERVA (O4: no hay rollback del hecho);
    // lo que se deshace es el efecto parcial del hook.
    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');
    expect(aux.rows().some((row) => row[0] === 'efecto-parcial')).toBe(false);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('falla a mitad de camino'));
  });

  it('`compensate` sin compensaciones registradas: registra y no rompe', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    REGISTRY.hooks.boom = () => {
      throw new Error('sin efectos previos');
    };
    const s = scenario_(
      buildResource_({ hooks: { afterCreate: [{ id: 'boom', onError: 'compensate' }] } }),
    );

    expect(() =>
      resourceCreate_(s.ss, s.resource, s.map, {
        method: 'POST',
        payload: { key: 'p1', name: 'pan' },
      }),
    ).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('sin efectos previos'));
  });

  it('con `log` la compensación registrada NO corre (sólo es del policy compensate)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let compensada = false;
    REGISTRY.hooks.parcial = (ctx) => {
      ctx.onCompensate(() => {
        compensada = true;
      });
      throw new Error('falla');
    };
    const s = scenario_(buildResource_({ hooks: { afterCreate: ['parcial'] } }));

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(compensada).toBe(false);
    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');
  });
});

// ── 4. onStatusChange: sólo campos con máquina que CAMBIARON ───────────────

describe('onStatusChange', () => {
  const conTransiciones = () =>
    buildResource_({
      hooks: { onStatusChange: ['grabador'] },
      transitions: MAQUINA,
    });

  it('dispara con field/from/to cuando un campo con máquina cambia', () => {
    const s = scenario_(conTransiciones(), [['p1', 'Pan', 'A']]);

    put_(s, { status: 'B' });

    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      action: 'onStatusChange',
      field: 'status',
      from: 'A',
      to: 'B',
      key: 'p1',
    });
  });

  it('el mismo valor no es un cambio', () => {
    const s = scenario_(conTransiciones(), [['p1', 'Pan', 'A']]);

    put_(s, { status: 'A', name: 'Pan renombrado' });

    expect(fired).toHaveLength(0);
  });

  it('un update que no toca el campo no dispara', () => {
    const s = scenario_(conTransiciones(), [['p1', 'Pan', 'A']]);

    put_(s, { name: 'Otro pan' });

    expect(fired).toHaveLength(0);
  });

  it('un recurso sin `transitions` nunca dispara', () => {
    const s = scenario_(
      buildResource_({ hooks: { onStatusChange: ['grabador'], afterUpdate: ['grabador'] } }),
      [['p1', 'Pan', 'A']],
    );

    put_(s, { status: 'B' });

    expect(fired.map((c) => c.action)).toEqual(['afterUpdate']);
  });

  it('un salto prohibido por la máquina no llega a emitir (el 409 manda)', () => {
    const s = scenario_(conTransiciones(), [['p1', 'Pan', 'C']]);

    expect(() => put_(s, { status: 'A' })).toThrow(/no permitido/);
    expect(fired).toHaveLength(0);
  });
});

// ── 5. El bus: suscriptores sin tocar el CRUD ──────────────────────────────

describe('onEvent_ — suscripciones externas', () => {
  it('un suscriptor ve el evento aunque el recurso no declare hooks', () => {
    globalThis.onEvent_('afterCreate', (ctx) => {
      fired.push(ctx);
    });
    const s = scenario_(buildResource_()); // SIN hooks

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'pan' },
    });

    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ action: 'afterCreate', key: 'p1' });
    expect(fired[0].eventId).toBe(RESOURCE_ID + '|afterCreate|p1');
  });

  it('ctx.eventId es una manija ESTABLE por entidad+fase (dedupe propio)', () => {
    globalThis.onEvent_('afterUpdate', (ctx) => {
      fired.push(ctx.eventId);
    });
    const s = scenario_(buildResource_(), [['p1', 'Pan', 'A']]);

    put_(s, { name: 'Pan 2' });
    put_(s, { name: 'Pan 3' });

    expect(fired).toHaveLength(2);
    expect(fired[0]).toBe(fired[1]);
    expect(fired[0]).toBe(RESOURCE_ID + '|afterUpdate|p1');
  });

  it('un suscriptor que lanza no rompe la escritura (es observador)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.onEvent_('afterCreate', () => {
      throw new Error('observador roto');
    });
    const s = scenario_(buildResource_());

    expect(() =>
      resourceCreate_(s.ss, s.resource, s.map, {
        method: 'POST',
        payload: { key: 'p1', name: 'pan' },
      }),
    ).not.toThrow();
    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('observador roto'));
  });
});

// ── 6. El vocabulario se juzga (eager + arranque) ──────────────────────────

describe('vocabulario del contrato', () => {
  it('eager: fase desconocida ⇒ 500 antes de escribir', () => {
    REGISTRY.hooks.grabador = () => {};
    const s = scenario_(buildResource_({ hooks: { beforeDelete: ['grabador'] } }));

    expect(() =>
      resourceCreate_(s.ss, s.resource, s.map, {
        method: 'POST',
        payload: { key: 'p1', name: 'pan' },
      }),
    ).toThrow(/Fase de hooks desconocida: beforeDelete/);
    expect(s.sheet.rows()).toHaveLength(1); // sólo la cabecera
  });

  it('eager: onError fuera del vocabulario ⇒ 500', () => {
    REGISTRY.hooks.grabador = () => {};
    const s = scenario_(
      buildResource_({ hooks: { afterCreate: [{ id: 'grabador', onError: 'rollback' }] } }),
    );

    expect(() =>
      resourceCreate_(s.ss, s.resource, s.map, {
        method: 'POST',
        payload: { key: 'p1', name: 'pan' },
      }),
    ).toThrow(/onError inválido "rollback"/);
  });

  it('arranque: el vocabulario completo produce issues en validateRegistry_', () => {
    REGISTRY.resources.__bus_valid = buildResource_({ id: '__bus_valid' });
    const issues = () =>
      validateRegistry_().filter((issue) => issue.indexOf('resources.__bus_valid') === 0);
    try {
      REGISTRY.resources.__bus_valid.hooks = { antesQueNada: ['grabador'] };
      expect(issues()[0]).toMatch(/hooks\.antesQueNada: fase desconocida/);

      REGISTRY.resources.__bus_valid.hooks = {
        afterCreate: [{ id: 'grabador', onError: 'silencio' }],
      };
      expect(issues()[0]).toMatch(/onError: 'silencio' fuera de/);

      REGISTRY.resources.__bus_valid.hooks = { afterCreate: [{ onError: 'log' }] };
      expect(issues()[0]).toMatch(/debe ser un nombre u objeto \{ id, onError \}/);

      REGISTRY.resources.__bus_valid.hooks = { afterCreate: ['no-existe'] };
      expect(issues()[0]).toMatch(/hook inexistente 'no-existe'/);

      // Contrato válido: objeto con onError legítimo y hook registrado
      // (pinHash, la capability real de capabilities/hooks.js).
      REGISTRY.resources.__bus_valid.hooks = {
        afterCreate: ['pinHash', { id: 'pinHash', onError: 'compensate' }],
      };
      expect(issues()).toEqual([]);
    } finally {
      delete REGISTRY.resources.__bus_valid;
    }
    // Y el registro real sigue limpio.
    expect(validateRegistry_()).toEqual([]);
  });
});
