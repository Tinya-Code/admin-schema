// api/__tests__/crud-hooks — engine/24-crud: emisión de REGISTRY.hooks
// (refactormotor.md B9, TEST PRIMERO).
//
// 24-crud.js tiene 713 líneas y hasta ahora 0 tests: para probar que
// create/update/delete EMITEN hay que ejercitar el write path real. La
// fixture de Sheets vive en `_sheets.js` (compartida con los demás specs del
// write path) y acá se define un recurso de prueba mínimo, registrado en
// REGISTRY.resources, sin lock, sin audit y sin hijos — así no arrastra
// LockService, _audit_log ni hojas dependientes al testear la emisión.
//
// Se llama a resourceCreate_/resourcePut_/resourceDelete_ DIRECTAMENTE (no
// dispatchResource_) porque éste abre el SpreadsheetApp real.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let storageMap_;
let resourceCreate_;
let resourcePut_;
let resourceDelete_;

const SHEET = '__hooks_sheet__';
const RESOURCE_ID = '__hooks_test__';

/** Falla si NO lanza; devuelve el error para seguir inspeccionando. */
function expectStatus(fn, status, fragmento) {
  let error;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  expect(error, 'esperaba que tirara').toBeDefined();
  expect(error.apiStatus).toBe(status);
  if (fragmento) expect(error.message).toContain(fragmento);
  return error;
}

/** Recurso mínimo + hook grabador. `hooks` se puede pisar por test. */
function buildResource_(hooks) {
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
    // Sin `audit` ⇒ auditWrite_ no pide _audit_log. `lock: false` ⇒ no LockService.
    policies: { access: { read: 'admin', write: 'admin' }, lock: false },
    exposeToFront: false,
    fields: [
      { key: 'key', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
    ],
    hooks,
  };
}

/** App + recurso + hoja con la fila inicial sembrada. */
function scenario_(hooks, rows) {
  const resource = buildResource_(hooks);
  const map = storageMap_(resource);
  const headers = map.columns.map((col) => col.flatKey);
  const sheet = fakeSheet_([headers, ...(rows || [])]);
  return { resource, map, ss: fakeApp_({ [SHEET]: sheet }), sheet, headers };
}

let fired;
// Estado del registro TAL COMO se cargó, antes de que el guard de abajo lo
// cree: así «REGISTRY expone `hooks`» verifica que 00-registry lo declara y
// no que el propio test lo inventó.
let registryHooksLoaded;

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  storageMap_ = globalThis.storageMap_;
  resourceCreate_ = globalThis.resourceCreate_;
  resourcePut_ = globalThis.resourcePut_;
  resourceDelete_ = globalThis.resourceDelete_;

  fired = [];
  registryHooksLoaded = REGISTRY.hooks;
  // `hooks` nace en 00-registry; si aún no existe, el test «REGISTRY expone
  // `hooks`» lo atrapa. Acá sólo nos aseguramos de poder registrar el
  // grabador para que los tests de emisión fallen por NO emitir y no por
  // un TypeError en beforeAll.
  if (!REGISTRY.hooks) REGISTRY.hooks = {};
  REGISTRY.hooks.recorder = (ctx) => {
    fired.push(ctx);
  };
});

beforeEach(() => {
  fired.length = 0;
});

// ─────────────────────────────────────────────────────────────
// Estos tests FALLAN antes del cambio: no existe REGISTRY.hooks ni
// dispatch post-escritura, así que `fired` queda vacío y la config rota
// no tira ningún 500.
// ─────────────────────────────────────────────────────────────

describe('REGISTRY.hooks — registro', () => {
  it('REGISTRY expone `hooks` (declarado en 00-registry, no por el test)', () => {
    expect(registryHooksLoaded).toBeTypeOf('object');
  });
});

describe('REGISTRY.hooks — emisión post-escritura', () => {
  it('create emite con el contexto completo DESPUÉS de escribir', () => {
    const s = scenario_({ create: ['recorder'] });
    const payload = { key: 'p1', name: 'Pan integral' };

    const out = resourceCreate_(s.ss, s.resource, s.map, { method: 'POST', payload });

    expect(fired).toHaveLength(1);
    const ctx = fired[0];
    expect(ctx.action).toBe('create');
    expect(ctx.key).toBe('p1');
    expect(ctx.resource).toBe(s.resource);
    expect(ctx.ss).toBe(s.ss);
    expect(ctx.payload).toMatchObject(payload);
    expect(typeof ctx.summary).toBe('string');

    // "POST-escritura": el hook ve la fila YA en la hoja.
    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');
    expect(out).toBeDefined();
  });

  it('update emite con action "update"', () => {
    const s = scenario_({ update: ['recorder'] }, [['p1', 'Pan']]);
    resourcePut_(s.ss, s.resource, s.map, {
      method: 'PUT',
      params: { key: 'p1' },
      payload: { name: 'Pan integral' },
    });

    expect(fired).toHaveLength(1);
    expect(fired[0].action).toBe('update');
    expect(fired[0].key).toBe('p1');
    expect(fired[0].payload).toMatchObject({ name: 'Pan integral' });
    // Recién guardado, antes de que el test lo lea.
    expect(s.sheet.rows().some((r) => r[1] === 'Pan integral')).toBe(true);
  });

  it('delete emite con action "delete"', () => {
    const s = scenario_({ delete: ['recorder'] }, [['p1', 'Pan']]);
    resourceDelete_(s.ss, s.resource, s.map, { method: 'DELETE', params: { key: 'p1' } });

    expect(fired).toHaveLength(1);
    expect(fired[0].action).toBe('delete');
    expect(fired[0].key).toBe('p1');
    // Y la fila ya no está cuando corre el hook.
    expect(s.sheet.rows().map((r) => r[0])).not.toContain('p1');
  });

  it('sin `hooks` declarados no emite nada', () => {
    const s = scenario_(undefined, [['p1', 'Pan']]);
    resourceDelete_(s.ss, s.resource, s.map, { method: 'DELETE', params: { key: 'p1' } });
    expect(fired).toHaveLength(0);
  });

  it('acción declarada sin nombres no emite, pero no tira', () => {
    const s = scenario_({ create: [] }, []);
    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'Pan' },
    });
    expect(fired).toHaveLength(0);
    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');
  });
});

describe('REGISTRY.hooks — config rota', () => {
  it('nombre que no existe en REGISTRY.hooks ⇒ 500 y NO escribe', () => {
    const s = scenario_({ create: ['no-existe'] }, []);
    expectStatus(
      () => resourceCreate_(s.ss, s.resource, s.map, { method: 'POST', payload: { key: 'p1' } }),
      500,
      'Hook ausente',
    );
    // Falla cerrado ANTES de tocar la hoja: nada queda a medias.
    expect(s.sheet.rows().map((r) => r[0])).not.toContain('p1');
  });

  it('un nombre roto hace fallar a TODO el grupo (sin emisión parcial)', () => {
    const s = scenario_({ create: ['recorder', 'no-existe'] }, []);
    expectStatus(
      () => resourceCreate_(s.ss, s.resource, s.map, { method: 'POST', payload: { key: 'p1' } }),
      500,
      'Hook ausente',
    );
    expect(fired).toHaveLength(0);
  });

  it('`hooks` mal declarado (no objeto / acción no lista) ⇒ 500', () => {
    const s1 = scenario_({ create: 'recorder' }, []);
    expectStatus(
      () => resourceCreate_(s1.ss, s1.resource, s1.map, { method: 'POST', payload: { key: 'a' } }),
      500,
      'hooks',
    );

    const s2 = scenario_([], []);
    expectStatus(
      () => resourceCreate_(s2.ss, s2.resource, s2.map, { method: 'POST', payload: { key: 'b' } }),
      500,
      'hooks',
    );
  });
});

describe('REGISTRY.hooks — un hook que lanza no rompe la escritura', () => {
  it('la escritura se conserva y la respuesta sale igual', () => {
    REGISTRY.hooks.boom = () => {
      throw new Error('falla adrede');
    };
    const s = scenario_({ create: ['boom'] }, []);

    const out = resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'Pan' },
    });

    // El hecho ya es irreversible: el hook es reacción, no la causa.
    expect(s.sheet.rows().map((r) => r[0])).toContain('p1');
    expect(out).toBeDefined();
    expect(out.key ?? out.slug ?? JSON.stringify(out)).toBeTruthy();
  });
});
