// engine/27-views — Vistas declarativas: where/sort/limit/extends y la
// lectura con intención { filter, view, key } (mejoras §5).
//
// Se desacopla de engine/24-crud (F3): 24 llama listWithRules_ en runtime
// (resolución perezosa, misma garantía de orden que el resto del motor).
// Declaración en resource.views (objeto, no array de nombres):
//   {
//     where: [{ field, op, value?|from?|ref?, not? }, …],   AND de ops
//     sort:  [{ field, dir: 'asc'|'desc' }, …],
//     limit: <n>,
//     extends: '<otra vista>',   hereda su where (guard anti-ciclo)
//     handler: '<REGISTRY.handlers>'   escape hatch §6 (sin where)
//     aggregate: 'count'|'sum'|'avg',  devuelve UNA fila { value } y no
//               los ítems (refactormotor.md B6); sum/avg exigen `field`
//   }
// Operandos: value (literal) | from: '$item.<campo>' (ancla ctx.self,
// sin ancla ⇒ la condición no resuelve ⇒ false) | ref: '<recurso>'
// (mapa de hechos ctx[ref] que construye readRulesCtx_ — fail-closed).
// CONTRATO de lectura preservado (F3-5): el payload { filter, view, key }
// sigue mapeando con los MISMOS mensajes de error que la versión por
// nombres; filter aplica sólo el where de la vista (sin sort/limit/handler)
// y view aplica la vista completa. La base cacheada NUNCA se muta.
// Top-level: sólo declaraciones de funciones (se ejecutan en runtime).

// ── Resolución de declaraciones ────────────────────────────────────────────

// Where plano de una vista (hereda `extends`). 500 ante config rota (§16:
// el schema manda; un nombre sin implementación es error de configuración).
function resolveViewWhere_(resource, name, seen) {
  if (seen[name]) throw apiError_(500, 'extends circular en views: ' + name);
  var views = resource.views || {};
  if (!Object.prototype.hasOwnProperty.call(views, name)) {
    throw apiError_(500, 'Vista mal declarada: ' + name);
  }
  seen[name] = true;
  var view = views[name];
  if (!view || typeof view !== 'object' || Array.isArray(view)) {
    throw apiError_(500, 'Vista mal declarada: ' + name);
  }
  var conds = [];
  if (view.extends !== undefined && view.extends !== null) {
    if (typeof view.extends !== 'string') {
      throw apiError_(500, 'extends debe ser nombre de vista: ' + name);
    }
    if (view.handler) {
      throw apiError_(500, 'Una vista handler no puede ser base de extends: ' + name);
    }
    conds = conds.concat(resolveViewWhere_(resource, view.extends, seen));
  }
  if (view.where !== undefined && view.where !== null) {
    if (!Array.isArray(view.where)) {
      throw apiError_(500, 'where debe ser lista de condiciones: ' + name);
    }
    conds = conds.concat(view.where);
  }
  return conds;
}

// Operando de una condición. devuelve { ok, value }: ok=false significa
// "sin contexto no hay match" (fail-closed: la condición entera falla y el
// intérprete NO invierte `not` — mejor ocultar de más que filtrar de menos).
function resolveViewOperand_(cond, ctx) {
  if (Object.prototype.hasOwnProperty.call(cond, 'value')) {
    return { ok: true, value: cond.value };
  }
  if (typeof cond.from === 'string') {
    var match = /^\$item\.([A-Za-z0-9_]+)$/.exec(cond.from);
    if (!match) throw apiError_(500, 'from no soportado: ' + cond.from);
    var self = ctx && typeof ctx === 'object' ? ctx.self : null;
    if (!self || typeof self !== 'object') return { ok: false, value: undefined };
    return { ok: true, value: self[match[1]] };
  }
  if (typeof cond.ref === 'string') {
    var facts = ctx && typeof ctx === 'object' ? ctx[cond.ref] : null;
    if (!facts || typeof facts !== 'object') return { ok: false, value: undefined };
    return { ok: true, value: facts };
  }
  throw apiError_(500, 'Condición sin operando (value|from|ref): ' + (cond.field || '?'));
}

// Ops unarias: no llevan operando (value|from|ref); el intérprete las
// llama con expected = undefined.
var UNARY_VIEW_OPS_ = { empty: true, exists: true };

// Evalúa where (AND de condiciones) sobre un ítem con ctx {<ref>: facts, self}.
function evalWhere_(conds, item, ctx) {
  for (var i = 0; i < conds.length; i++) {
    var cond = conds[i];
    if (!cond || typeof cond !== 'object') throw apiError_(500, 'Condición mal declarada');
    if (typeof cond.field !== 'string' || typeof cond.op !== 'string') {
      throw apiError_(500, 'Condición sin field/op');
    }
    var op =
      Object.prototype.hasOwnProperty.call(REGISTRY.ops, cond.op) &&
      typeof REGISTRY.ops[cond.op] === 'function'
        ? REGISTRY.ops[cond.op]
        : null;
    if (!op) throw apiError_(500, 'Operador no registrado: ' + cond.op);
    var operand = UNARY_VIEW_OPS_[cond.op]
      ? { ok: true, value: undefined }
      : resolveViewOperand_(cond, ctx);
    if (!operand.ok) return false; // sin contexto ⇒ falla, sin invertir not
    var matched = op(item[cond.field], operand.value);
    if (cond.not === true) matched = !matched;
    if (!matched) return false;
  }
  return true;
}

// Orden declarado: multi-campo, numérico si ambos lados lo son, si no
// lexicográfico; estable (el runtime conserva el orden de empate).
function sortItems_(items, sort) {
  if (!Array.isArray(sort)) throw apiError_(500, 'sort debe ser lista');
  return items.slice().sort(function (a, b) {
    for (var i = 0; i < sort.length; i++) {
      var spec = sort[i];
      if (!spec || typeof spec.field !== 'string') {
        throw apiError_(500, 'sort mal declarado');
      }
      var dir = spec.dir === 'desc' ? -1 : 1;
      var va = a[spec.field];
      var vb = b[spec.field];
      var na = opsNumber_(va);
      var nb = opsNumber_(vb);
      var cmp;
      if (na !== null && nb !== null) cmp = na - nb;
      else cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });
}

// ── Lectura con intención filter/view por NOMBRE (Fase 8, contrato F3-5) ──
//
// { filter?: nombre, view?: nombre, key?: clave }:
//   filter → el where de la vista nombrada, por ítem (sin sort/limit)
//   view   → la vista completa (extends + where + sort/limit, o handler)
//   key    → ancla ctx.self con el ítem de esa clave (vistas que excluyen
//            un producto); clave inexistente → 404
// El nombre DEBE estar declarado en resource.views; si no → 400.
// Declarado con handler ausente de REGISTRY → 500 (el schema manda, §16).
// Shape (F5): el resultado se envuelve con el envelope de la forma
// efectiva (vista con shape > operations.list.shape > 'plain'); las vistas
// con shape propio acotan campos del base ya proyectado.
function listWithRules_(ss, resource, map, request) {
  var base = listCollection_(ss, resource, map);
  var payload = request.payload || {};
  var wantsFilter = payload.filter !== undefined && payload.filter !== null;
  var wantsView = payload.view !== undefined && payload.view !== null;
  // Shape del listado (F5): operations.list.shape; la vista declarada con
  // shape propio lo reemplaza (campos: acotado a lo que el base ya trae —
  // ampliar exigiría releer). Se valida acá aunque la lista esté vacía o
  // venga de caché (el shape por ítem no correría).
  var listShape = resolveListShape_(resource, null);
  if (listShape) validateShape_(resource, listShape);
  if (!wantsFilter && !wantsView) return shapeEnvelope_(base, listShape);
  var ctx = readRulesCtx_(ss, resource, map, base, payload);
  var items = base;
  if (wantsFilter) items = applyViewFilter_(resource, String(payload.filter), items, ctx);
  if (wantsView) items = applyDeclaredView_(resource, String(payload.view), items, ctx);
  var effShape = listShape;
  if (wantsView) {
    var viewShape = resolveListShape_(resource, String(payload.view));
    // applyView*/applyDeclaredView_ ya validaron que la vista existe.
    if (viewShape && viewShape !== listShape) {
      validateShape_(resource, viewShape);
      items = items.map(function (item) {
        return applyShape_(resource, item, viewShape);
      });
      effShape = viewShape;
    }
  }
  return shapeEnvelope_(items, effShape);
}

function applyViewFilter_(resource, name, items, ctx) {
  var views = resource.views || {};
  if (!Object.prototype.hasOwnProperty.call(views, name)) {
    throw apiError_(400, 'Filtro no disponible: ' + name);
  }
  var view = views[name];
  if (view && view.handler) throw apiError_(400, 'La regla no es un filtro: ' + name);
  var conds = resolveViewWhere_(resource, name, {});
  var out = [];
  items.forEach(function (item) {
    if (evalWhere_(conds, item, ctx)) out.push(item);
  });
  return out;
}

// ── Aggregate (refactormotor.md B6) ─────────────────────────────────────────

// Cláusulas admitidas. Con `aggregate` la vista devuelve UNA fila
// { value } en vez de los ítems: es el dato que consume un widget del panel,
// no un listado. Sin ella todo sigue funcionando igual (el escape hatch
// sigue siendo `handler`).
var VIEW_AGGREGATES_ = { count: true, sum: true, avg: true };

// Config rota ⇒ 500 (§16: el schema manda). Se valida ANTES de resolver la
// vista, para que falle igual con la lista vacía que con la cacheada.
function validateViewAggregate_(view, name) {
  if (!Object.prototype.hasOwnProperty.call(VIEW_AGGREGATES_, view.aggregate)) {
    throw apiError_(500, 'aggregate mal declarado: ' + name);
  }
  if (view.aggregate === 'sum' || view.aggregate === 'avg') {
    if (typeof view.field !== 'string' || view.field === '') {
      throw apiError_(500, 'aggregate ' + view.aggregate + ' exige `field`: ' + name);
    }
  }
  if (view.handler) {
    throw apiError_(500, 'Una vista handler no puede agregar: ' + name);
  }
  if (view.shape) {
    throw apiError_(500, 'Una vista aggregate no admite `shape`: ' + name);
  }
}

// Fila única con el resultado. `count` no usa `field`; `sum`/`avg` ignoran
// los valores no numéricos (semántica SQL de SUM/AVG con NULL) y `avg`
// divide entre los que SÍ aportaron. Sin ningún valor numérico devuelve
// `null` y no 0, que sería indistinguible de «promedio real igual a cero».
function aggregateItems_(view, items) {
  if (view.aggregate === 'count') return [{ value: items.length }];
  var sum = 0;
  var n = 0;
  items.forEach(function (item) {
    var num = opsNumber_(item[view.field]);
    if (num === null) return;
    sum += num;
    n++;
  });
  return [{ value: view.aggregate === 'sum' ? sum : n === 0 ? null : sum / n }];
}

function applyDeclaredView_(resource, name, items, ctx) {
  var views = resource.views || {};
  if (!Object.prototype.hasOwnProperty.call(views, name)) {
    throw apiError_(400, 'Vista no disponible: ' + name);
  }
  var view = views[name];
  if (!view || typeof view !== 'object' || Array.isArray(view)) {
    throw apiError_(500, 'Vista mal declarada: ' + name);
  }
  var hasAggregate = view.aggregate !== undefined && view.aggregate !== null;
  if (hasAggregate) validateViewAggregate_(view, name);
  if (view.handler) {
    var fn =
      typeof view.handler === 'string' &&
      Object.prototype.hasOwnProperty.call(REGISTRY.handlers, view.handler)
        ? REGISTRY.handlers[view.handler]
        : null;
    if (typeof fn !== 'function') {
      throw apiError_(500, 'Handler de vista ausente: ' + String(view.handler));
    }
    return fn(items, ctx);
  }
  var conds = resolveViewWhere_(resource, name, {});
  var out = [];
  items.forEach(function (item) {
    if (evalWhere_(conds, item, ctx)) out.push(item);
  });
  if (view.sort !== undefined && view.sort !== null) out = sortItems_(out, view.sort);
  if (typeof view.limit === 'number') out = out.slice(0, view.limit);
  // where ⇒ sort ⇒ limit ⇒ aggregate: el `limit` acota EL CONJUNTO que se
  // agrega ("suma de los 5 más grandes"), que es lo que se espera.
  if (hasAggregate) return aggregateItems_(view, out);
  return out;
}

// ctx para las vistas (contrato de rules/31, ahora modelo `ref:` §5): por
// cada relación declarada, ctx[<recurso destino>] = { valor: activo } — el
// motor NO nombra entidades: lee los ids desde el schema (una condición
// `ref: 'categories'` consume ctx.categories). Si el payload trae `key`,
// ctx.self es el ítem de la lista con esa clave (ancla de vistas tipo
// "relacionados"; `from: '$item.x'` lo lee).
function readRulesCtx_(ss, resource, map, items, payload) {
  var ctx = {};
  (resource.fields || []).forEach(function (field) {
    if (field.type !== 'relation' || !field.resource) return;
    var target = getResourceSchema(field.resource);
    if (target === null) throw apiError_(500, 'Relación no configurada: ' + field.resource);
    var data = readSheetData_(ss, target.sheet);
    var valueIdx = data.headers.indexOf(field.valueField);
    if (valueIdx === -1) throw apiError_(500, 'Columna inexistente: ' + field.valueField);
    var activeIdx = target.activeField ? data.headers.indexOf(target.activeField) : -1;
    var facts = {};
    data.rows.forEach(function (row) {
      facts[String(row.values[valueIdx])] =
        activeIdx === -1 ? true : truthyCell_(row.values[activeIdx]);
    });
    ctx[field.resource] = facts;
  });
  if (payload.key !== undefined && payload.key !== null && payload.key !== '') {
    var wanted = String(payload.key);
    var found = null;
    items.forEach(function (item) {
      if (found === null && String(item[map.keyField]) === wanted) found = item;
    });
    if (found === null) throw apiError_(404, 'No existe: ' + wanted);
    ctx.self = found;
  }
  return ctx;
}
