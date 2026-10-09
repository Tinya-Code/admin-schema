// primitives/ops — Operadores genéricos de consulta (mejoras §5).
//
// Auto-registro en REGISTRY.ops; los interpreta engine/27-views
// (evalWhere_ resuelve el operando y llama fn(actual, expected)).
// Contrato de fn(actual, expected) → bool:
//   actual   = valor proyectado del ítem en ese campo;
//   expected = operando ya resuelto por el intérprete (literal `value`,
//              valor de `$item.x` desde la ancla, o mapa de hechos `ref`).
// Los booleanos pasan por truthyCell_ (celda de Sheets 'TRUE'/true);
// `not: true` en la condición lo invierte el intérprete (no cada fn).
// Cero nombres de dominio: son DATOS genéricos, no primitivas de catálogo.
// Top-level: funciones + asignación a literal de REGISTRY.ops.

// ¿v es numérico para comparaciones ordenadas? ('' / bool / vacío ⇒ no).
function opsNumber_(value) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') {
    return null;
  }
  var n = Number(value);
  return isFinite(n) ? n : null;
}

function opEq_(actual, expected) {
  if (expected === true || expected === false) return truthyCell_(actual) === expected;
  return String(actual) === String(expected);
}

function opIn_(actual, expected) {
  if (!Array.isArray(expected)) return false;
  var wanted = String(actual);
  for (var i = 0; i < expected.length; i++) {
    if (String(expected[i]) === wanted) return true;
  }
  return false;
}

function opOrdered_(actual, expected, test) {
  var a = opsNumber_(actual);
  var e = opsNumber_(expected);
  if (a !== null && e !== null) return test(a, e);
  // No numéricos ⇒ comparación lexicográfica (determinista por código de
  // unidad; sin locale para que el resultado sea estable entre corridas).
  return test(String(actual), String(expected));
}

function opContains_(actual, expected) {
  return String(actual).indexOf(String(expected)) !== -1;
}

function opRegex_(actual, expected) {
  return new RegExp(String(expected)).test(String(actual));
}

// in-active: `actual` existe en el mapa de hechos `expected` (ctx[ref] =>
// { valor: activo }) Y está activo. Desconocido/inactivo ⇒ false (fail-closed:
// mejor ocultar de más que filtrar de menos).
function opInActive_(actual, expected) {
  if (!expected || typeof expected !== 'object') return false;
  var key = String(actual);
  if (!Object.prototype.hasOwnProperty.call(expected, key)) return false;
  return truthyCell_(expected[key]);
}

REGISTRY.ops = {
  eq: opEq_,
  neq: function (actual, expected) {
    return !opEq_(actual, expected);
  },
  in: opIn_,
  nin: function (actual, expected) {
    return !opIn_(actual, expected);
  },
  gt: function (actual, expected) {
    return opOrdered_(actual, expected, function (a, e) {
      return a > e;
    });
  },
  gte: function (actual, expected) {
    return opOrdered_(actual, expected, function (a, e) {
      return a >= e;
    });
  },
  lt: function (actual, expected) {
    return opOrdered_(actual, expected, function (a, e) {
      return a < e;
    });
  },
  lte: function (actual, expected) {
    return opOrdered_(actual, expected, function (a, e) {
      return a <= e;
    });
  },
  contains: opContains_,
  starts: function (actual, expected) {
    return String(actual).indexOf(String(expected)) === 0;
  },
  regex: opRegex_,
  empty: function (actual) {
    return isEmptyValue_(actual);
  },
  exists: function (actual) {
    return !isEmptyValue_(actual);
  },
  'in-active': opInActive_,
};
