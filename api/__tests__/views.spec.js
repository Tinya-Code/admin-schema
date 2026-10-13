// api/__tests__/views — engine/27-views: evalWhere_, sortItems_,
// applyDeclaredView_ y la cláusula `aggregate` (refactormotor.md B6).
//
// ANTES de este fichero, 27-views.js tenía 253 líneas y 0 tests: son las
// funciones que ejecutan TODO lo declarativo de vistas, así que primero se
// fija su comportamiento actual (Parte A) y recién después se prueba la
// cláusula nueva (Parte B), que DEBE fallar antes del cambio (A6).
//
// Los errores de configuración son apiError_(500, …) con err.apiStatus;
// los de disponibilidad, 400. Se comprueba siempre el código y el fragmento.

import { beforeAll, describe, expect, it } from 'vitest';

import { fakeApp_, fakeSheet_ } from './_sheets.js';
import { loadBackend } from './_harness.js';

let evalWhere_;
let sortItems_;
let applyDeclaredView_;
let readRulesCtx_;
let storageMap_;
let REGISTRY;

beforeAll(() => {
  loadBackend();
  evalWhere_ = globalThis.evalWhere_;
  sortItems_ = globalThis.sortItems_;
  applyDeclaredView_ = globalThis.applyDeclaredView_;
  readRulesCtx_ = globalThis.readRulesCtx_;
  storageMap_ = globalThis.storageMap_;
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

describe('hasMany inverso', () => {
  it('expande filas relacionadas agrupadas por el campo padre', () => {
    const categories = REGISTRY.resources.categories;
    const oldViews = categories.views;
    categories.views = {
      __hasManyTest: { expand: ['products'], select: ['slug', 'products'] },
    };
    try {
      const ss = fakeApp_({
        products: fakeSheet_([
          ['slug', 'category_slug', 'name'],
          ['p1', 'cat-a', 'Producto A'],
          ['p2', 'cat-a', 'Producto B'],
          ['p3', 'cat-b', 'Producto C'],
        ]),
      });
      const parents = [{ slug: 'cat-a' }, { slug: 'cat-b' }, { slug: 'cat-c' }];
      const ctx = readRulesCtx_(
        ss,
        categories,
        storageMap_(categories),
        parents,
        { view: '__hasManyTest' },
        {},
      );
      const result = applyDeclaredView_(categories, '__hasManyTest', parents, ctx);

      expect(result.map((category) => category.products.map((product) => product.slug))).toEqual([
        ['p1', 'p2'],
        ['p3'],
        [],
      ]);
    } finally {
      categories.views = oldViews;
    }
  });

  it('falla en vez de truncar cuando se excede el límite declarado', () => {
    const categories = REGISTRY.resources.categories;
    const oldViews = categories.views;
    const oldLimit = categories.hasMany.products.limit;
    categories.views = { __hasManyLimitTest: { expand: ['products'] } };
    categories.hasMany.products.limit = 1;
    try {
      const ss = fakeApp_({
        products: fakeSheet_([
          ['slug', 'category_slug', 'name'],
          ['p1', 'cat-a', 'Producto A'],
          ['p2', 'cat-a', 'Producto B'],
        ]),
      });
      expect(() =>
        readRulesCtx_(
          ss,
          categories,
          storageMap_(categories),
          [{ slug: 'cat-a' }],
          { view: '__hasManyLimitTest' },
          {},
        ),
      ).toThrow(/supera su límite declarado/);
    } finally {
      categories.views = oldViews;
      categories.hasMany.products.limit = oldLimit;
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Parte B — cláusula `aggregate` (refactormotor.md B6)
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

// ─────────────────────────────────────────────────────────────
// Parte C — R6.1 «Vistas más potentes» (B6)
//
// Cinco ampliaciones aditivas de `views`. Estos tests FALLAN antes del cambio:
// hoy `where` es una AND plana, no hay `or`/`all`, `select` no proyecta
// (eso lo hace `view.shape.pick`, F5), `page` no pagina y `expand` no
// existe. Cada bloque fija un aspecto de una ampliación.
// ─────────────────────────────────────────────────────────────

describe('R6.1 · where estructurado (or / all)', () => {
  it('`or` es una disyunción entre condiciones', () => {
    // A y D son pendientes; B está entregado. `or` une: cumple cualquiera.
    const r = recurso({
      activoOPendiente: {
        where: {
          or: [
            { field: 'status', op: 'eq', value: 'pendiente' },
            { field: 'status', op: 'eq', value: 'entregado' },
          ],
        },
      },
    });
    expect(applyDeclaredView_(r, 'activoOPendiente', ITEMS, {}).map((i) => i.ref)).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
  });

  it('`all` exige que TODAS las subcondiciones se cumplan', () => {
    // Fixture limpio: el operador `gt` sobre un campo no-numérico cae a
    // comparación lexicográfica (comportamiento correcto de opOrdered_),
    // así que uso un campo numérico homogéneo para aislar la semántica de
    // `all` sin mezclarla con el fallback lexicográfico.
    const conMonto = [
      { ref: 'A', status: 'pendiente', monto: 10 },
      { ref: 'B', status: 'entregado', monto: 20 },
      { ref: 'C', status: 'pendiente', monto: 3 },
    ];
    const r = recurso({
      pendienteGrande: {
        where: {
          all: [
            { field: 'status', op: 'eq', value: 'pendiente' },
            { field: 'monto', op: 'gt', value: 6 },
          ],
        },
      },
    });
    expect(applyDeclaredView_(r, 'pendienteGrande', conMonto, {}).map((i) => i.ref)).toEqual(['A']);
  });

  it('anida or dentro de all y respeta el fail-closed de `from`', () => {
    const r = recurso({
      anidado: {
        where: {
          all: [
            { field: 'status', op: 'eq', value: 'pendiente' },
            {
              or: [
                { field: 'monto', op: 'gt', value: 6 },
                { field: 'monto', op: 'lt', value: 6 },
              ],
            },
          ],
        },
      },
    });
    expect(applyDeclaredView_(r, 'anidado', ITEMS, {}).map((i) => i.ref)).toEqual(['A', 'C', 'D']);
    // `from` sin ctx ⇒ la SUBcondición falla cerrada y el `or` entero no la
    // cuenta como verdadera (no invierte `not`).
    const r2 = recurso({
      conFrom: {
        where: {
          or: [
            { field: 'status', op: 'eq', value: 'pendiente' },
            { field: 'monto', op: 'gt', from: '$item.umbral' },
          ],
        },
      },
    });
    expect(applyDeclaredView_(r2, 'conFrom', ITEMS, {}).map((i) => i.ref)).toEqual(['A', 'C', 'D']);
  });

  it('tira 500 con or/all mal declarado (no-array, array vacío, subcondición rota)', () => {
    expectStatus(
      () => applyDeclaredView_(recurso({ v: { where: { or: 'no-array' } } }), 'v', ITEMS, {}),
      500,
      'or/all',
    );
    expectStatus(
      () => applyDeclaredView_(recurso({ v: { where: { all: [] } } }), 'v', ITEMS, {}),
      500,
      'or/all',
    );
    expectStatus(
      () =>
        applyDeclaredView_(
          recurso({ v: { where: { all: [{ field: 'x', op: 'no-existe', value: 1 }] } } }),
          'v',
          ITEMS,
          {},
        ),
      500,
      'Operador no registrado',
    );
  });
});

describe('R6.1 · sort por array (shorthand)', () => {
  it('acepta la forma corta `["-monto", "ref"]` (desc por prefijo -)', () => {
    const items = [
      { a: 'x', monto: 2 },
      { a: 'y', monto: 10 },
      { a: 'z', monto: 2 },
    ];
    // Ya lo soporta la forma larga; este test fija que la corta mapee igual.
    expect(sortItems_(items, ['-monto', 'a']).map((i) => i.monto)).toEqual([10, 2, 2]);
    expect(sortItems_(items, ['-monto', 'a']).map((i) => i.a)).toEqual(['y', 'x', 'z']);
  });

  it('tira 500 con entrada de sort no-string', () => {
    expectStatus(() => sortItems_([{ a: 1 }, { a: 2 }], [42]), 500, 'sort');
  });
});

describe('R6.1 · select (proyección por vista)', () => {
  // `select` acota la lista YA proyectada (listProjection) a los campos
  // declarados, en ese orden. El fixture debe declarar listProjection: la
  // vista opera sobre la salida del listado, no sobre la fila cruda.
  const PROYECTADO = ['ref', 'status', 'monto'];
  function recursoSelect(views) {
    return { id: 'demo', listProjection: PROYECTADO, views };
  }

  it('proyecta sólo los campos declarados en `select`', () => {
    const r = recursoSelect({
      resumen: {
        where: [{ field: 'status', op: 'eq', value: 'pendiente' }],
        select: ['ref', 'monto'],
      },
    });
    const out = applyDeclaredView_(r, 'resumen', ITEMS, {});
    expect(out).toEqual([
      { ref: 'A', monto: 10 },
      { ref: 'C', monto: 'no-numérico' },
      { ref: 'D', monto: 5 },
    ]);
  });

  it('`select` no muta los ítems de entrada', () => {
    const r = recursoSelect({ resumen: { select: ['ref'] } });
    applyDeclaredView_(r, 'resumen', ITEMS, {});
    expect(Object.keys(ITEMS[0]).sort()).toEqual(['monto', 'ref', 'status']);
  });

  it('tira 500 con select no-array o campo inexistente', () => {
    expectStatus(
      () => applyDeclaredView_(recursoSelect({ v: { select: 'ref' } }), 'v', ITEMS, {}),
      500,
      'select',
    );
    expectStatus(
      () => applyDeclaredView_(recursoSelect({ v: { select: ['no-existe'] } }), 'v', ITEMS, {}),
      500,
      'select',
    );
  });
});

describe('R6.1 · page (paginación)', () => {
  it('page corta el conjunto DESPUÉS de where+sort', () => {
    const r = recurso({
      paginado: {
        where: [{ field: 'status', op: 'eq', value: 'pendiente' }],
        sort: [{ field: 'ref', dir: 'asc' }],
        page: { size: 2, offset: 1 },
      },
    });
    // Pendientes: A, C, D → asc ⇒ A, C, D → offset 1, size 2 ⇒ C, D.
    expect(applyDeclaredView_(r, 'paginado', ITEMS, {}).map((i) => i.ref)).toEqual(['C', 'D']);
  });

  it('page sin offset arranca en 0 y size=0 devuelve vacío', () => {
    const r = recurso({ soloPrimero: { sort: [{ field: 'ref' }], page: { size: 1 } } });
    expect(applyDeclaredView_(r, 'soloPrimero', ITEMS, {}).map((i) => i.ref)).toEqual(['A']);
    const r2 = recurso({ nada: { page: { size: 0 } } });
    expect(applyDeclaredView_(r2, 'nada', ITEMS, {})).toEqual([]);
  });

  it('page compite con limit: si ambos están, page gana', () => {
    const r = recurso({
      mixto: { sort: [{ field: 'ref' }], limit: 3, page: { size: 1, offset: 1 } },
    });
    expect(applyDeclaredView_(r, 'mixto', ITEMS, {}).map((i) => i.ref)).toEqual(['B']);
  });

  it('tira 500 con page mal declarado', () => {
    expectStatus(
      () => applyDeclaredView_(recurso({ v: { page: 5 } }), 'v', ITEMS, {}),
      500,
      'page',
    );
    expectStatus(
      () => applyDeclaredView_(recurso({ v: { page: { size: 'x' } } }), 'v', ITEMS, {}),
      500,
      'page',
    );
    expectStatus(
      () => applyDeclaredView_(recurso({ v: { page: { size: -1 } } }), 'v', ITEMS, {}),
      500,
      'page',
    );
  });
});

describe('R6.1 · expand (expansión de relaciones)', () => {
  // `expand` NO lee la hoja destino (eso sería cambiar el contrato de
  // respuesta de la API). Lo que hace es traer al ítem la META de la
  // relación que `readRulesCtx_` ya construye en `ctx[<recurso>]` — un mapa
  // { clave: activo } — de modo que el front puede decidir con qué cruzar.
  // Un campo que no es `relation`, o que no existe en el recurso ⇒ 500.
  function recursoRelacion(fields, views) {
    return { id: 'demo', fields, views };
  }
  const CATS = [
    { key: 'category', type: 'relation', source: { resource: 'categories', valueField: 'slug' } },
    { key: 'ref', type: 'text' },
  ];

  it('expand inyecta el mapa de la relación declarada en ctx', () => {
    const r = recursoRelacion(CATS, {
      conCategoria: {
        where: [{ field: 'status', op: 'eq', value: 'pendiente' }],
        expand: ['category'],
      },
    });
    const items = [
      { ref: 'A', status: 'pendiente', category: 'bebidas' },
      { ref: 'B', status: 'entregado', category: 'pan' },
    ];
    const ctx = { categories: { bebidas: true, pan: false } };
    const out = applyDeclaredView_(r, 'conCategoria', items, ctx);
    // El where deja sólo A (B es 'entregado'). expand inyecta el MAPA de
    // hechos de la relación, y conserva la clave plana bajo `category_key`.
    expect(out).toEqual([
      {
        ref: 'A',
        status: 'pendiente',
        category: { bebidas: true, pan: false },
        category_key: 'bebidas',
      },
    ]);
    // Los ítems de entrada quedan intactos (no mutar).
    expect(items[0].category).toBe('bebidas');
  });

  it('expand conserva el resto de campos del ítem y la clave plana', () => {
    const r = recursoRelacion(CATS, { v: { expand: ['category'] } });
    const out = applyDeclaredView_(r, 'v', [{ ref: 'A', category: 'x' }], {
      categories: { x: true },
    });
    expect(out[0]).toEqual({
      ref: 'A',
      category: { x: true },
      category_key: 'x',
    });
  });

  it('expand de un campo no-relación o inexistente ⇒ 500', () => {
    expectStatus(
      () => applyDeclaredView_(recursoRelacion(CATS, { v: { expand: ['ref'] } }), 'v', ITEMS, {}),
      500,
      'expand',
    );
    expectStatus(
      () =>
        applyDeclaredView_(recursoRelacion(CATS, { v: { expand: ['no-existe'] } }), 'v', ITEMS, {}),
      500,
      'expand',
    );
  });

  it('tira 500 con expand no-array', () => {
    expectStatus(
      () =>
        applyDeclaredView_(recursoRelacion(CATS, { v: { expand: 'category' } }), 'v', ITEMS, {}),
      500,
      'expand',
    );
  });
});

// Parte D — `groupBy` en agregados (refactormotor.md R6.2 / decisión D9-5).
//
// `groupBy` agrupa por el VALOR CRUDO de cualquier campo (texto, fecha ISO,
// numérico) y devuelve UNA FILA POR GRUPO: [{ group, value }, …]. No parsea
// fechas — el backend guarda el dato crudo y el formateo vive en el front
// (el tipo `date` es `sheetFormat: 'text'`, ISO YYYY-MM-DD). Sin `groupBy`
// todo sigue igual: UNA fila { value }.
//
// Estos tests FALLAN antes del cambio: aggregateItems_ no conoce `groupBy`.
describe('aggregate con groupBy', () => {
  const ITEMS2 = [
    { ref: 'A', status: 'PENDIENTE', categoria: 'pan', monto: 10 },
    { ref: 'B', status: 'ENTREGADO', categoria: 'bebida', monto: 20 },
    { ref: 'C', status: 'PENDIENTE', categoria: 'pan', monto: 5 },
    { ref: 'D', status: 'ENTREGADO', categoria: 'pan', monto: 1 },
  ];

  it('count agrupado por un campo de texto', () => {
    const r = recurso({
      por_categoria: { aggregate: 'count', groupBy: 'categoria' },
    });
    expect(applyDeclaredView_(r, 'por_categoria', ITEMS2, {})).toEqual([
      { group: 'pan', value: 3 },
      { group: 'bebida', value: 1 },
    ]);
  });

  it('sum agrupado respeta el where (agrega sólo el subconjunto)', () => {
    const r = recurso({
      pendientes_por_categoria: {
        aggregate: 'sum',
        field: 'monto',
        groupBy: 'categoria',
        where: [{ field: 'status', op: 'eq', value: 'PENDIENTE' }],
      },
    });
    expect(applyDeclaredView_(r, 'pendientes_por_categoria', ITEMS2, {})).toEqual([
      { group: 'pan', value: 15 },
    ]);
  });

  it('avg agrupado ignora valores no numéricos por grupo', () => {
    const items = [
      { categoria: 'pan', monto: 10 },
      { categoria: 'pan', monto: 'x' },
      { categoria: 'bebida', monto: 4 },
    ];
    const r = recurso({ avg_cat: { aggregate: 'avg', field: 'monto', groupBy: 'categoria' } });
    expect(applyDeclaredView_(r, 'avg_cat', items, {})).toEqual([
      { group: 'pan', value: 10 },
      { group: 'bebida', value: 4 },
    ]);
  });

  it('agrupa por valor crudo de una fecha ISO (prefijo de día) sin parsear', () => {
    const items = [
      { fecha: '2024-03-15', total: 10 },
      { fecha: '2024-03-15', total: 20 },
      { fecha: '2024-03-16', total: 7 },
    ];
    const r = recurso({ por_dia: { aggregate: 'sum', field: 'total', groupBy: 'fecha' } });
    expect(applyDeclaredView_(r, 'por_dia', items, {})).toEqual([
      { group: '2024-03-15', value: 30 },
      { group: '2024-03-16', value: 7 },
    ]);
  });

  it('tira 500 con groupBy sin string', () => {
    expectStatus(
      () =>
        applyDeclaredView_(recurso({ v: { aggregate: 'count', groupBy: 42 } }), 'v', ITEMS2, {}),
      500,
      'groupBy',
    );
  });
});
