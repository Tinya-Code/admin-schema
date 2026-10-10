// api/__tests__/list-params — R6.5: el canal `params` del listado (F8).
//
// Lo que éste archivo cubre y ninguna otra parte cubre:
//
//  1. **`param` es un operando de condición más**: una vista puede pedir el
//     valor en `payload.params` y el motor lo compara igual que con
//     `value`/`from`/`ref`. Sin esa clave (o sin `params`) la condición NO
//     resuelve ⇒ la vista devuelve vacía, sin 500 y sin invertir `not` —
//     «mejor ocultar de más que filtrar de menos».
//  2. **`params` es ENTRADA del navegador y se valida ANTES de leer la
//     hoja**: objeto, ≤ 10 claves, valores texto de ≤ 500 caracteres. Si
//     no, 422 con `errors[]` y `path` relativo al payload (misma forma que
//     la validación del router). Un `eq ''` cruzándose con filas realmente
//     vacías sería un filtro que nadie pidió — por eso el valor resuelto
//     vacío viaja AUSENTE desde el front y la clave ausente falla cerrado.
//  3. **Regresión F8**: `readRulesCtx_` publica los hechos de cada relación
//     bajo `ctx[<recurso destino>]` — una vista `ref:` consume ese mapa. Si
//     la clave pasara a ser el campo, `ref` dejaría de resolver y la vista
//     devolvería vacía sin avisar.
//
// Se entra por `dispatchResource_`, la puerta real: es la única forma de
// probar el orden validación ⇒ lectura ⇒ filtro. La hoja es la fixture en
// memoria de `_sheets.js`.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let dispatchResource_;
let storageMap_;
let readRulesCtx_;
let evalCondition_;
let originalOpenSpreadsheet;
let seq = 0;

const SHEET = '__params_sheet__';
const CAT_SHEET = '__params_cats__';

/** Cuatro filas: tres PEND y una OK, con su categoría (una inactiva). */
const GRID = [
  ['key', 'name', 'status', 'category'],
  ['r1', 'Uno', 'PEND', 'bebidas'],
  ['r2', 'Dos', 'OK', 'pan'],
  ['r3', 'Tres', 'PEND', 'inventada'],
  ['r4', 'Cuatro', 'PEND', 'bebidas'],
];

/** Categorías: `pan` está inactiva → `in-active` debe excluirla. */
const CATS = [
  ['slug', 'name', 'active'],
  ['bebidas', 'Bebidas', true],
  ['pan', 'Pan', false],
];

/**
 * Dos recursos en la misma hoja fake: el que lista y el que aporta los
 * hechos de la relación. `extra` pisa lo que el caso necesite probar.
 */
function fixture_(extra = {}) {
  const id = '__params_' + ++seq;
  const target = id + '_cats';
  REGISTRY.resources[target] = {
    id: target,
    kind: 'collection',
    sheet: CAT_SHEET,
    keyField: 'slug',
    titleField: 'name',
    activeField: 'active',
  };
  const resource = {
    id,
    kind: 'collection',
    sheet: SHEET,
    keyField: 'key',
    titleField: 'name',
    ordering: 'none',
    activeField: 'active',
    onDelete: 'none',
    dependents: [],
    listProjection: ['key', 'name', 'status', 'category'],
    imageFolder: null,
    views: {
      // Operando `param`: el valor lo manda el cliente en payload.params.
      porEstado: { where: [{ field: 'status', op: 'eq', param: 'estado' }] },
      // Operando `ref`: el mapa lo arma readRulesCtx_ con la relación.
      categoriaActiva: {
        where: [{ field: 'category', op: 'in-active', ref: target }],
        sort: [{ field: 'key', dir: 'asc' }],
      },
    },
    policies: { access: { read: 'admin', write: 'admin' }, lock: false },
    exposeToFront: false,
    operations: {
      list: { shape: { envelope: 'list', pick: ['key', 'name', 'status', 'category'] } },
      get: true,
    },
    fields: [
      { key: 'key', type: 'text', required: true, immutable: true },
      { key: 'name', type: 'text', required: true },
      { key: 'status', type: 'text', required: true },
      { key: 'category', type: 'relation', source: { resource: target, valueField: 'slug' } },
    ],
    ...extra,
  };
  REGISTRY.resources[id] = resource;
  const ss = fakeApp_({ [SHEET]: fakeSheet_(GRID), [CAT_SHEET]: fakeSheet_(CATS) });
  return { id, target, resource, map: storageMap_(resource), ss };
}

/** El despacho real, con la hoja resuelta por la fixture. */
function call_(fixture, payload = {}) {
  globalThis.openSpreadsheet_ = () => fixture.ss;
  return dispatchResource_(fixture.resource, { method: 'GET', path: '/x', params: {}, payload });
}

/** Devuelve el error lanzado; si no lanza, devuelve null. */
function errorOf_(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}

/** El error 422 con `errors[]`; falla si no llegó. */
function expect422(fn) {
  const err = errorOf_(fn);
  expect(err, 'esperaba un 422').toBeDefined();
  expect(err.apiStatus).toBe(422);
  expect(err.apiErrors, 'el 422 lleva errors[]').toBeInstanceOf(Array);
  expect(err.apiErrors.length).toBeGreaterThan(0);
  return err;
}

beforeAll(() => {
  loadBackend();
  dispatchResource_ = globalThis.dispatchResource_;
  storageMap_ = globalThis.storageMap_;
  readRulesCtx_ = globalThis.readRulesCtx_;
  evalCondition_ = globalThis.evalCondition_;
});

beforeEach(() => {
  REGISTRY = globalThis.REGISTRY;
  originalOpenSpreadsheet = globalThis.openSpreadsheet_;
});

afterEach(() => {
  globalThis.openSpreadsheet_ = originalOpenSpreadsheet;
  for (const id of Object.keys(REGISTRY.resources)) {
    if (id.startsWith('__params_')) delete REGISTRY.resources[id];
  }
});

// ── 1. `param` como operando de la vista ───────────────────────────────────

describe('R6.5 · operando `param` en las vistas', () => {
  it('filtra con lo que el cliente mandó en payload.params', () => {
    const out = call_(fixture_(), { view: 'porEstado', params: { estado: 'PEND' } });
    expect(out.items.map((i) => i.key)).toEqual(['r1', 'r3', 'r4']);
    expect(out.total).toBe(3);
  });

  it('otro valor devuelve el otro conjunto: el operando es data, no config', () => {
    const out = call_(fixture_(), { view: 'porEstado', params: { estado: 'OK' } });
    expect(out.items.map((i) => i.key)).toEqual(['r2']);
  });

  it('clave ausente ⇒ fail-closed: vacío, sin 500 y sin invertir `not`', () => {
    const fixture = fixture_({
      views: {
        // El NOT es la trampa: si el operando no resuelve y se invierte,
        // la vista devolvería TODAS las filas — que es filtrar de más.
        noOk: { where: [{ field: 'status', op: 'eq', param: 'estado', not: true }] },
      },
    });
    expect(call_(fixture, { view: 'noOk', params: {} }).items).toHaveLength(0);
    expect(call_(fixture, { view: 'noOk' }).items).toHaveLength(0);
    // Con el parámetro sí resuelve: neq implícito ⇒ las tres PEND.
    expect(call_(fixture, { view: 'noOk', params: { estado: 'OK' } }).items).toHaveLength(3);
  });

  it('sin el parámetro la condición NO resuelve (null, no false)', () => {
    // `null` es «no pude resolver» y `false` es «no coincide»: dentro de un
    // grupo `or`/`all` no son lo mismo, y el `not` NO se aplica sobre un
    // operando que no resolvió (mejor ocultar de más que filtrar de menos).
    const cond = { field: 'status', op: 'eq', param: 'estado', not: true };
    const fila = { status: 'PEND' };
    expect(evalCondition_(cond, fila, {})).toBeNull();
    expect(evalCondition_(cond, fila, { params: {} })).toBeNull();
    // Con el parámetro el operando resuelve y recién ahí invierte el `not`.
    expect(evalCondition_(cond, fila, { params: { estado: 'OK' } })).toBe(true);
    expect(evalCondition_(cond, fila, { params: { estado: 'PEND' } })).toBe(false);
  });

  it('un params con claves de sobra no rompe el sobre estándar', () => {
    const out = call_(fixture_(), {
      view: 'porEstado',
      params: { estado: 'PEND', muletilla: 'ignorada' },
    });
    expect(Object.keys(out).sort()).toEqual(['items', 'nextCursor', 'total']);
  });
});

// ── 2. `params` validado ANTES de leer la hoja ─────────────────────────────

describe('R6.5 · `params` es entrada del navegador: 422 con errors[]', () => {
  it('no-objeto (texto o lista) ⇒ 422 con path `params`', () => {
    const err = expect422(() => call_(fixture_(), { view: 'porEstado', params: 'PEND' }));
    expect(err.apiErrors[0].code).toBe('VALIDATION_PARAMS');
    expect(err.apiErrors[0].path).toBe('params');

    const lista = expect422(() => call_(fixture_(), { view: 'porEstado', params: ['estado'] }));
    expect(lista.apiErrors[0].path).toBe('params');
  });

  it('valor que no es texto ⇒ 422 con path `params.<nombre>`', () => {
    const err = expect422(() => call_(fixture_(), { view: 'porEstado', params: { estado: 7 } }));
    expect(err.apiErrors[0].code).toBe('VALIDATION_PARAMS');
    expect(err.apiErrors[0].path).toBe('params.estado');
    expect(err.apiErrors[0].message).toContain('texto');
  });

  it('más de 10 parámetros ⇒ 422 (no es una query string, es entrada)', () => {
    const params = {};
    for (let i = 0; i < 11; i++) params['p' + i] = 'x';
    const err = expect422(() => call_(fixture_(), { view: 'porEstado', params }));
    expect(err.apiErrors[0].path).toBe('params');
    expect(err.apiErrors[0].message).toContain('10');
  });

  it('parámetro de más de 500 caracteres ⇒ 422 con su path', () => {
    const err = expect422(() =>
      call_(fixture_(), { view: 'porEstado', params: { estado: 'x'.repeat(501) } }),
    );
    expect(err.apiErrors[0].path).toBe('params.estado');
    expect(err.apiErrors[0].message).toContain('500');
  });

  it('la validación corre ANTES de leer la hoja (entrada, no schema roto)', () => {
    const fixture = fixture_();
    // `call_` instala la hoja fake: acá no puede, porque la prueba ES que
    // el motor no la toque. Si leyera filas antes de validar, esto tiraría
    // el error de la hoja y no el 422.
    globalThis.openSpreadsheet_ = () => ({
      getSheetByName: () => ({
        getLastRow: () => {
          throw new Error('LEÍ LA HOJA');
        },
      }),
    });
    const err = expect422(() =>
      dispatchResource_(fixture.resource, {
        method: 'GET',
        path: '/x',
        params: {},
        payload: { view: 'porEstado', params: { estado: 5 } },
      }),
    );
    expect(err.apiErrors[0].code).toBe('VALIDATION_PARAMS');
  });

  it('params válido no vira error de servidor en un listado sin vista', () => {
    // `params` sólo filtra cuando una vista lo pide (`param:`); por sí solo
    // es contexto que el motor ignora.
    const out = call_(fixture_(), { params: { estado: 'PEND' } });
    expect(out.items).toHaveLength(4);
  });
});

// ── 3. ctx de relación (regresión de la migración a `source`) ──────────────

describe('R6.5 · ctx de relación para las vistas', () => {
  it('los hechos quedan bajo ctx[<recurso destino>] y consumen `ref`', () => {
    const fixture = fixture_();
    globalThis.openSpreadsheet_ = () => fixture.ss;
    const ctx = readRulesCtx_(fixture.ss, fixture.resource, fixture.map, [], {}, null);

    // La clave es el RECURSO (lo que una condición `ref:` pide), no el campo.
    expect(Object.keys(ctx[fixture.target])).toEqual(['bebidas', 'pan']);
    expect(ctx[fixture.target]['bebidas']).toBe(true);
    expect(ctx[fixture.target]['pan']).toBe(false); // inactiva ⇒ in-active la excluye
    expect(ctx.params).toEqual({}); // sin params, contexto vacío (fail-closed)
  });

  it('una vista con `ref:` devuelve sólo lo activo en la relación', () => {
    const out = call_(fixture_(), { view: 'categoriaActiva' });
    // r2 (pan, inactiva) y r3 (categoría inexistente) quedan fuera.
    expect(out.items.map((i) => i.key)).toEqual(['r1', 'r4']);
  });

  it('los params pedidos llegan a las condiciones de la vista', () => {
    const fixture = fixture_();
    globalThis.openSpreadsheet_ = () => fixture.ss;
    const ctx = readRulesCtx_(
      fixture.ss,
      fixture.resource,
      fixture.map,
      [],
      {},
      { estado: 'PEND' },
    );
    expect(ctx.params).toEqual({ estado: 'PEND' });
  });
});
