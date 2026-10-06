// api/__tests__/check-ctx — engine/23-validate: `checkCtx.currentChildren`
// (pickpass-plan Fase 1.1 / T1.2, TEST PRIMERO).
//
// Los checks declarados sólo reciben `ctx = { ss, isNew, key, current,
// children }`, y `children` son SOLO las hijas del payload
// (childrenForValidation_, 24-crud:636). `current` es SOLO columnas
// (flatToContract_). Ninguno de los dos da el historial YA GUARDADO, que es
// lo que necesita `history-append-only`.
//
// Esta pieza lo embona: el snapshot de hijos guardados viaja como
// `ctx.currentChildren`. Se prueba por separado de los checks para que el
// fallo señale el plumbing y no la lógica de negocio.
//
// Llamar a resourceCreate_/resourcePut_ directamente (no dispatchResource_),
// inyectando el `ss` fake de _sheets.js.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let storageMap_;
let resourceCreate_;
let resourcePut_;

const RESOURCE_ID = '__ctx_test__';
const MAIN = '__ctx_main__';
const CHILD = '__ctx_items__';

const SINGLETON_ID = '__ctx_singleton__';
const SINGLETON_SHEET = '__ctx_singleton__';

/** Últimos ctx capturados — uno por pase de validación (pre-lock y lock). */
let seen;

/** Sonda: no valida nada, sólo registra el scope que recibe. */
function probeScope_(scope) {
  seen.push(scope.ctx);
  return [];
}

function collection_(hooks) {
  return {
    id: RESOURCE_ID,
    kind: 'collection',
    sheet: MAIN,
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
    checks: [{ check: 'probe-ctx' }],
    fields: [
      { key: 'key', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
      {
        key: 'items',
        type: 'list',
        sheet: CHILD,
        fk: 'owner',
        itemFields: [{ key: 'note', type: 'text' }],
      },
    ],
    ...(hooks || {}),
  };
}

function singleton_() {
  return {
    id: SINGLETON_ID,
    kind: 'singleton',
    sheet: SINGLETON_SHEET,
    kvColumns: ['key', 'value', 'type', 'note'],
    keyField: 'key',
    titleField: null,
    ordering: 'none',
    activeField: null,
    onDelete: 'none',
    dependents: [],
    listProjection: null,
    imageFolder: null,
    views: {},
    policies: { access: { read: 'admin', write: 'admin' }, lock: false },
    exposeToFront: false,
    checks: [{ check: 'probe-ctx' }],
    fields: [{ key: 'f1', type: 'text' }],
  };
}

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  storageMap_ = globalThis.storageMap_;
  resourceCreate_ = globalThis.resourceCreate_;
  resourcePut_ = globalThis.resourcePut_;

  REGISTRY.checks['probe-ctx'] = probeScope_;
});

beforeEach(() => {
  seen = [];
});

// ─────────────────────────────────────────────────────────────
// FALLA antes del cambio: checkCtx no lleva `currentChildren`, así que la
// sonda ve undefined y el objeto de hijos guardados nunca llega.
// ─────────────────────────────────────────────────────────────

describe('checkCtx.currentChildren', () => {
  it('create: es objeto y no arrastra hijos guardados (aún no existe)', () => {
    const resource = collection_();
    const map = storageMap_(resource);
    const ss = fakeApp_({
      [MAIN]: fakeSheet_([['key', 'name']]),
      [CHILD]: fakeSheet_([['owner', 'note']]),
    });

    resourceCreate_(ss, resource, map, { method: 'POST', payload: { key: 'o1', name: 'Pan' } });

    expect(seen.length).toBeGreaterThan(0);
    seen.forEach((ctx) => {
      expect(ctx.currentChildren, 'currentChildren debe ser objeto').toBeTypeOf('object');
      expect(ctx.currentChildren).not.toBeNull();
      expect(ctx.currentChildren).toEqual({});
    });
  });

  it('update: entrega el snapshot de hijos YA guardado en el sheet', () => {
    const resource = collection_();
    const map = storageMap_(resource);
    const ss = fakeApp_({
      [MAIN]: fakeSheet_([
        ['key', 'name'],
        ['o1', 'Pan integral'],
      ]),
      [CHILD]: fakeSheet_([
        ['owner', 'note'],
        ['o1', 'línea 1'],
        ['o1', 'línea 2'],
        ['otro', 'no es mío'],
      ]),
    });

    resourcePut_(ss, resource, map, {
      method: 'PUT',
      params: { key: 'o1' },
      payload: { name: 'Pan de campo' },
    });

    expect(seen.length).toBeGreaterThan(0);
    // Cada pase (pre-lock y lock) recibe el snapshot de ESTE registro y sólo
    // de este: 'otro' no puede colarse.
    seen.forEach((ctx) => {
      expect(ctx.currentChildren).toBeTypeOf('object');
      expect(ctx.currentChildren.items).toEqual([{ note: 'línea 1' }, { note: 'línea 2' }]);
      expect(ctx.key).toBe('o1');
    });
  });

  it('singleton update: entrega los hijos guardados (fk nulo = dueño de todo)', () => {
    const resource = singleton_();
    const map = storageMap_(resource);
    const ss = fakeApp_({
      [SINGLETON_SHEET]: fakeSheet_([
        ['key', 'value', 'type', 'note'],
        ['f1', 'valor inicial', 'text', ''],
      ]),
      ['__ctx_singleton_items__']: fakeSheet_([['note']]),
    });

    resourcePut_(ss, resource, map, { method: 'PUT', payload: { f1: 'nuevo' } });

    expect(seen.length).toBeGreaterThan(0);
    seen.forEach((ctx) => {
      expect(ctx.currentChildren).toBeTypeOf('object');
      expect(ctx.currentChildren).not.toBeNull();
    });
  });

  it('los hijos guardados y los del payload conviven: `children` sigue siendo el payload', () => {
    const resource = collection_();
    const map = storageMap_(resource);
    const ss = fakeApp_({
      [MAIN]: fakeSheet_([
        ['key', 'name'],
        ['o1', 'Pan'],
      ]),
      [CHILD]: fakeSheet_([
        ['owner', 'note'],
        ['o1', 'guardado'],
      ]),
    });

    resourcePut_(ss, resource, map, {
      method: 'PUT',
      params: { key: 'o1' },
      payload: { name: 'Pan', items: [{ note: 'entrante' }] },
    });

    const ctx = seen[seen.length - 1];
    // Ambos vienen keyeados por la clave del campo hijo (childrenForValidation_
    // y readChildren_ usan la misma forma, que es la que consume
    // effectiveChildren_).
    expect(ctx.children).toEqual({ items: [{ note: 'entrante' }] }); // lo que trae el payload
    expect(ctx.currentChildren).toEqual({ items: [{ note: 'guardado' }] }); // lo guardado
  });
});
