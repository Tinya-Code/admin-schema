// api/__tests__/views — engine/27-views: evalWhere_, sortItems_,
// applyDeclaredView_ y la cláusula `aggregate` (motor-plan T2b / M2).
//
// ANTES de este fichero, 27-views.js tenía 253 líneas y 0 tests: son las
// funciones que ejecutan TODO lo declarativo de vistas, así que primero se
// fija su comportamiento actual (Parte A) y recién después se prueba la
// cláusula nueva (Parte B), que DEBE fallar antes del cambio (A6).
//
// Los errores de configuración son apiError_(500, …) con err.apiStatus;
// los de disponibilidad, 400. Se comprueba siempre el código y el fragmento.

import { beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let evalWhere_;
let sortItems_;
let applyDeclaredView_;
let REGISTRY;

beforeAll(() => {
  loadBackend();
  evalWhere_ = globalThis.evalWhere_;
  sortItems_ = globalThis.sortItems_;
  applyDeclaredView_ = globalThis.applyDeclaredView_;
  REGISTRY = globalThis.REGISTRY;
});

/** Cuatro filas: cubren estado, numérico y no-numérico en `monto`. */
const ITEMS = [
  { ref: 'A', status: 'pendiente', monto: 10 },
  { ref: 'B', status: 'entregado', monto: 20 },
  { ref: 'C', status: 'pendiente', monto: 'no-numérico' },
  { ref: 'D', status: 'pendiente', monto: 5 },
];

/** Recurso mínimo: sólo `views`. */
function recurso(views) {
  return { id: 'demo', views };
}

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

// ─────────────────────────────────────────────────────────────
// Parte A — comportamiento PREVIO (regresión: verde ANTES del cambio)
// ─────────────────────────────────────────────────────────────

describe('evalWhere_', () => {
  it('aplica AND entre condiciones y respeta `not`', () => {
    const conds = [{ field: 'status', op: 'eq', value: 'pendiente' }];
    expect(evalWhere_(conds, ITEMS[0], {})).toBe(true);
    expect(evalWhere_(conds, ITEMS[1], {})).toBe(false);
    expect(
      evalWhere_([{ field: 'status', op: 'eq', value: 'pendiente', not: true }], ITEMS[1], {}),
    ).toBe(true);
  });

  it('sin contexto, `from` falla cerrado y NO invierte `not`', () => {
    // Fail-closed documentado en 27-views:78-79: operand.ok = false ⇒ return
    // false ANTES de la inversión (línea 100), así que `not: true` no convierte
    // el falso en verdadero.
    const conds = [{ field: 'monto', op: 'gt', from: '$item.umbral', not: true }];
    expect(evalWhere_(conds, ITEMS[0], {})).toBe(false);
  });

  it('`from` resuelve contra ctx.self', () => {
    const conds = [{ field: 'monto', op: 'gt', from: '$item.umbral' }];
    expect(evalWhere_(conds, { monto: 10 }, { self: { umbral: 5 } })).toBe(true);
    expect(evalWhere_(conds, { monto: 10 }, { self: { umbral: 50 } })).toBe(false);
  });

  it('tira 500 ante op no registrado o condición mal formada', () => {
    expectStatus(
      () => evalWhere_([{ field: 'x', op: 'no-existe', value: 1 }], {}, {}),
      500,
      'Operador no registrado',
    );
    expectStatus(() => evalWhere_([{ op: 'eq', value: 1 }], {}, {}), 500, 'Condición sin field/op');
    expectStatus(
      () => evalWhere_([{ field: 'x', op: 'eq' }], {}, {}),
      500,
      'Condición sin operando',
    );
  });
});

describe('sortItems_', () => {
  it('ordena numérico de verdad y respeta dir y multi-campo', () => {
    const items = [
      { a: 2, b: 'x' },
      { a: 10, b: 'y' },
      { a: 2, b: 'z' },
    ];
    // 2 < 10 numérico (NO lexicográfico: '10' < '2' sería al revés).
    expect(sortItems_(items, [{ field: 'a', dir: 'asc' }]).map((i) => i.a)).toEqual([2, 2, 10]);
    expect(sortItems_(items, [{ field: 'a', dir: 'desc' }]).map((i) => i.a)).toEqual([10, 2, 2]);
    expect(
      sortItems_(items, [{ field: 'a' }, { field: 'b', dir: 'desc' }]).map((i) => i.b),
    ).toEqual(['z', 'x', 'y']);
  });

  it('no muta la entrada y tira 500 con sort mal declarado', () => {
    const items = [{ a: 2 }, { a: 1 }];
    sortItems_(items, [{ field: 'a' }]);
    expect(items.map((i) => i.a)).toEqual([2, 1]);

    expectStatus(() => sortItems_([], 'no-es-lista'), 500, 'sort debe ser lista');
    // Dos ítems, no uno: con un solo elemento `Array.prototype.sort` nunca
    // invoca el comparador y `sort mal declarado` no llegaría a lanzar.
    expectStatus(() => sortItems_([{}, {}], [{ dir: 'asc' }]), 500, 'sort mal declarado');
  });
});

describe('applyDeclaredView_', () => {
  it('aplica where + sort + limit sobre los ítems', () => {
    const r = recurso({
      pendientes: {
        where: [{ field: 'status', op: 'eq', value: 'pendiente' }],
        // Ordena por `ref` (texto) y no por `monto`: `10 < 'no-numérico'`
        // compara NÚMEROS ⇒ NaN ⇒ empate, y el orden final no quedaría
        // determinado por el código. Eso ya lo cubre sortItems_ con datos
        // limpios; acá lo que importa es que where+sort+limit se encadenan.
        sort: [{ field: 'ref', dir: 'desc' }],
        limit: 2,
      },
    });
    // Pendientes: A, C, D → desc ⇒ D, C, A → limit 2.
    expect(applyDeclaredView_(r, 'pendientes', ITEMS, {}).map((i) => i.ref)).toEqual(['D', 'C']);
  });

  it('`extends` hereda el where de la base y los ciclos tiran 500', () => {
    const r = recurso({
      base: { where: [{ field: 'status', op: 'eq', value: 'pendiente' }] },
      hijo: { extends: 'base' },
      ciclico: { extends: 'ciclico' },
    });
    expect(applyDeclaredView_(r, 'hijo', ITEMS, {}).map((i) => i.ref)).toEqual(['A', 'C', 'D']);
    expectStatus(() => applyDeclaredView_(r, 'ciclico', ITEMS, {}), 500, 'circular');
  });

  it('vista no declarada ⇒ 400; handler ausente ⇒ 500', () => {
    expectStatus(
      () => applyDeclaredView_(recurso({}), 'nope', ITEMS, {}),
      400,
      'Vista no disponible',
    );
    expectStatus(
      () => applyDeclaredView_(recurso({ h: { handler: 'no-existe' } }), 'h', ITEMS, {}),
      500,
      'Handler de vista ausente',
    );
  });

  it('`handler` reemplaza el filtrado y recibe (items, ctx)', () => {
    const original = REGISTRY.handlers.prueba;
    REGISTRY.handlers.prueba = (items, ctx) => [{ ref: 'HANDLER', n: items.length, tiene: !!ctx }];
    try {
      const r = recurso({ h: { handler: 'prueba' } });
      expect(applyDeclaredView_(r, 'h', ITEMS, { self: ITEMS[0] })).toEqual([
        { ref: 'HANDLER', n: 4, tiene: true },
      ]);
    } finally {
      if (original === undefined) delete REGISTRY.handlers.prueba;
      else REGISTRY.handlers.prueba = original;
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Parte B — cláusula `aggregate` (motor-plan T2b / M2)
// Estos tests FALLAN antes del cambio: sin `aggregate` la vista devuelve
// los ítems filtrados en vez de una fila con el total.
// ─────────────────────────────────────────────────────────────

describe('aggregate', () => {
  it('count devuelve UNA fila con el total tras where/limit', () => {
    const r = recurso({
      pendientes: {
        where: [{ field: 'status', op: 'eq', value: 'pendiente' }],
        aggregate: 'count',
      },
      top: {
        where: [{ field: 'status', op: 'eq', value: 'pendiente' }],
        sort: [{ field: 'monto', dir: 'asc' }],
        limit: 2,
        aggregate: 'count',
      },
      nada: {
        where: [{ field: 'status', op: 'eq', value: 'otro-estado' }],
        aggregate: 'count',
      },
    });
    expect(applyDeclaredView_(r, 'pendientes', ITEMS, {})).toEqual([{ value: 3 }]);
    expect(applyDeclaredView_(r, 'top', ITEMS, {})).toEqual([{ value: 2 }]);
    expect(applyDeclaredView_(r, 'nada', ITEMS, {})).toEqual([{ value: 0 }]);
  });

  it('sum acumula los numéricos y saltea los que no lo son (semántica SQL)', () => {
    const r = recurso({ todos: { aggregate: 'sum', field: 'monto' } });
    // 10 + 20 + 5; 'no-numérico' se ignora en vez de sumar 0.
    expect(applyDeclaredView_(r, 'todos', ITEMS, {})).toEqual([{ value: 35 }]);
  });

  it('avg divide entre los numéricos y da null si no hay ninguno', () => {
    const r = recurso({
      dos: {
        where: [{ field: 'ref', op: 'in', value: ['A', 'B'] }],
        aggregate: 'avg',
        field: 'monto',
      },
      ninguno: {
        where: [{ field: 'ref', op: 'in', value: ['Z'] }],
        aggregate: 'avg',
        field: 'monto',
      },
    });
    expect(applyDeclaredView_(r, 'dos', ITEMS, {})).toEqual([{ value: 15 }]);
    expect(applyDeclaredView_(r, 'ninguno', ITEMS, {})).toEqual([{ value: null }]);
  });

  it('tira 500 con aggregate roto', () => {
    expectStatus(
      () => applyDeclaredView_(recurso({ v: { aggregate: 'mediana' } }), 'v', ITEMS, {}),
      500,
      'aggregate mal declarado',
    );
    expectStatus(
      () => applyDeclaredView_(recurso({ v: { aggregate: 'sum' } }), 'v', ITEMS, {}),
      500,
      'exige `field`',
    );
    expectStatus(
      () =>
        applyDeclaredView_(
          recurso({ v: { aggregate: 'sum', field: 'monto', handler: 'x' } }),
          'v',
          ITEMS,
          {},
        ),
      500,
      'handler',
    );
    expectStatus(
      () => applyDeclaredView_(recurso({ v: { aggregate: 'count', shape: {} } }), 'v', ITEMS, {}),
      500,
      'shape',
    );
  });
});
