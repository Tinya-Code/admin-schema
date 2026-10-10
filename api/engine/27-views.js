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
    // where plano es una lista de condiciones; R6.1 también admite un
    // grupo de primer nivel {or|all: [...]}. Un objeto que no sea grupo
    // se rechaza acá (500), igual que la lista no-array.
    var isGroup = typeof view.where === 'object' && !Array.isArray(view.where);
    var isFlat = Array.isArray(view.where);
    if (isGroup) {
      var gk = Object.prototype.hasOwnProperty.call(view.where, 'or')
        ? 'or'
        : Object.prototype.hasOwnProperty.call(view.where, 'all')
          ? 'all'
          : null;
      if (gk === null) throw apiError_(500, 'where debe ser lista de condiciones: ' + name);
    } else if (!isFlat) {
      throw apiError_(500, 'where debe ser lista de condiciones: ' + name);
    }
    conds = conds.concat(isGroup ? [view.where] : view.where);
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
    if (evalCondition_(conds[i], item, ctx) !== true) return false;
  }
  return true;
}

// Un nodo de `where` puede ser: (a) una condición plana {field, op, ...} —
// el caso histórico; (b) un grupo `or: [nodos]`; (c) un grupo `all: [nodos]`.
// Un grupo es un objeto con UNA sola de esas claves. Devuelve el resultado
// lógico; `null` significa "no pudo resolver por falta de contexto"
// (fail-closed) — el `or` lo trata como no-verdadero sin invertir `not`.
function evalCondition_(cond, item, ctx) {
  if (!cond || typeof cond !== 'object' || Array.isArray(cond)) {
    throw apiError_(500, 'Condición mal declarada');
  }
  var hasOr = Object.prototype.hasOwnProperty.call(cond, 'or');
  var hasAll = Object.prototype.hasOwnProperty.call(cond, 'all');
  if (hasOr || hasAll) {
    if (hasOr && hasAll) throw apiError_(500, 'or/all no pueden coexistir');
    var key = hasOr ? 'or' : 'all';
    return evalGroup_(key, cond[key], item, ctx);
  }
  return evalLeaf_(cond, item, ctx);
}

// Evalúa un grupo `or`/`all` sobre una lista de subnodos. Cada subnodo pasa
// por evalCondition_ de nuevo ⇒ anidamiento libre. La semántica de fail-closed
// se propaga: `null` de una rama no cuenta como verdadera en `or` ni como
// falsa en `all` (simplemente no aporta), conservando «mejor ocultar de más
// que filtrar de menos».
function evalGroup_(key, conds, item, ctx) {
  if (!Array.isArray(conds) || conds.length === 0) {
    throw apiError_(500, 'or/all debe ser lista no vacía');
  }
  for (var i = 0; i < conds.length; i++) {
    var r = evalCondition_(conds[i], item, ctx);
    if (key === 'or' && r === true) return true;
    if (key === 'all' && r !== true) return r === null ? null : false;
  }
  return key === 'all' ? true : false;
}

// Condición plana: field + op + operando (value|from|ref), con `not`.
// Devuelve true/false, o null si el operando no resuelve (fail-closed).
function evalLeaf_(cond, item, ctx) {
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
  if (!operand.ok) return null; // sin contexto ⇒ no resuelve, sin invertir not
  var matched = op(item[cond.field], operand.value);
  if (cond.not === true) matched = !matched;
  return matched;
}

// Orden declarado: multi-campo, numérico si ambos lados lo son, si no
// lexicográfico; estable (el runtime conserva el orden de empate).
// R6.1: además de la forma larga [{ field, dir }], admite la corta
// ["-campo", "campo"] — el guion inicial es `desc`.
function sortItems_(items, sort) {
  if (!Array.isArray(sort)) throw apiError_(500, 'sort debe ser lista');
  var norm = [];
  for (var i = 0; i < sort.length; i++) {
    var s = sort[i];
    if (typeof s === 'string') {
      var desc = s.charAt(0) === '-';
      var field = desc ? s.slice(1) : s;
      if (field === '') throw apiError_(500, 'sort mal declarado');
      norm.push({ field: field, dir: desc ? 'desc' : 'asc' });
      continue;
    }
    if (!s || typeof s !== 'object' || typeof s.field !== 'string') {
      throw apiError_(500, 'sort mal declarado');
    }
    norm.push(s);
  }
  return items.slice().sort(function (a, b) {
    for (var i = 0; i < norm.length; i++) {
      var spec = norm[i];
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
  if (view.groupBy !== undefined && view.groupBy !== null) {
    if (typeof view.groupBy !== 'string' || view.groupBy === '') {
      throw apiError_(500, 'groupBy debe ser un string con el campo en ' + name);
    }
  }
}

// Acumulador de un grupo. `count` no usa `field`; `sum`/`avg` ignoran los
// valores no numéricos (semántica SQL) y `avg` divide entre los que aportaron.
// Sin ningún valor numérico `avg` devuelve `null`, no 0 (indistinguible de
// «promedio real igual a cero»).
function aggregateGroup_(fn, field, rows) {
  if (fn === 'count') return rows.length;
  var sum = 0;
  var n = 0;
  rows.forEach(function (item) {
    var num = opsNumber_(item[field]);
    if (num === null) return;
    sum += num;
    n++;
  });
  return fn === 'sum' ? sum : n === 0 ? null : sum / n;
}

// Una fila con el resultado. Sin `groupBy` devuelve [{ value: … }]; con él,
// una fila por grupo [{ group, value }, …] agrupando por el VALOR CRUDO del
// campo (el `where` ya acotó el conjunto antes de llegar acá).
function aggregateItems_(view, items) {
  if (view.groupBy === undefined || view.groupBy === null) {
    return [{ value: aggregateGroup_(view.aggregate, view.field, items) }];
  }
  var key = view.groupBy;
  var orden = [];
  var porGrupo = {};
  items.forEach(function (item) {
    var g = item[key];
    if (!Object.prototype.hasOwnProperty.call(porGrupo, g)) {
      porGrupo[g] = [];
      orden.push(g);
    }
    porGrupo[g].push(item);
  });
  return orden.map(function (g) {
    return { group: g, value: aggregateGroup_(view.aggregate, view.field, porGrupo[g]) };
  });
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
  if (view.page !== undefined && view.page !== null) {
    out = applyViewPage_(out, view.page, name);
  } else if (typeof view.limit === 'number') {
    out = out.slice(0, view.limit);
  }
  // where ⇒ sort ⇒ page|limit ⇒ expand ⇒ select ⇒ aggregate: el recorte
  // acota EL CONJUNTO que se agrega ("suma de los 5 más grandes"), que es lo
  // que se espera. `page` pisa a `limit` si ambas están (R6.1): la
  // paginación es el recorte definitivo. `expand` y `select` sólo aplican a
  // la lista de ítems — un aggregate devuelve UNA fila y no se proyecta.
  if (hasAggregate) return aggregateItems_(view, out);
  if (view.expand !== undefined && view.expand !== null) {
    out = out.map(function (item) {
      return applyViewExpand_(resource, item, view.expand, ctx, name);
    });
  }
  if (view.select !== undefined && view.select !== null) {
    out = out.map(function (item) {
      return applyViewSelect_(resource, item, view.select, name);
    });
  }
  return out;
}

// R6.1 · paginación declarada: page: { size, offset? }.
// `size` es obligatorio y ≥ 0; `offset` opcional y ≥ 0 (default 0).
// Un objeto no-objeto, o un size/offset no-numérico o negativo ⇒ 500 (config
// rota, §16). Se aplica DESPUÉS de sort ⇒ la página es estable sobre el orden
// declarado.
function applyViewPage_(items, page, name) {
  if (!page || typeof page !== 'object' || Array.isArray(page)) {
    throw apiError_(500, 'page mal declarada en ' + name);
  }
  var size = page.size;
  var offset = page.offset === undefined ? 0 : page.offset;
  if (typeof size !== 'number' || !isFinite(size) || size < 0) {
    throw apiError_(500, 'page.size debe ser número ≥ 0 en ' + name);
  }
  if (typeof offset !== 'number' || !isFinite(offset) || offset < 0) {
    throw apiError_(500, 'page.offset debe ser número ≥ 0 en ' + name);
  }
  return items.slice(offset, offset + size);
}

// R6.1 · proyección declarada: select: [campo, …].
// Devuelve sólo los campos listados, en el orden declarado. Un campo que no
// existe en el recurso ⇒ 500 (config rota, §16). Opera sobre la lista ya
// proyectada (listProjection), no sobre la fila cruda.
function applyViewSelect_(resource, item, select, name) {
  if (!Array.isArray(select) || select.length === 0) {
    throw apiError_(500, 'select debe ser lista no vacía en ' + name);
  }
  var known = {};
  (resource.listProjection || []).forEach(function (k) {
    known[k] = true;
  });
  var out = {};
  for (var i = 0; i < select.length; i++) {
    var k = select[i];
    if (typeof k !== 'string' || !known[k]) {
      throw apiError_(500, 'select: campo inexistente ' + String(k) + ' en ' + name);
    }
    if (Object.prototype.hasOwnProperty.call(item, k)) out[k] = item[k];
  }
  return out;
}

// R6.1 · expansión de relaciones: expand: [campo-relación, …].
// Para cada campo de tipo `relation` listado, sustituye el valor plano (la
// clave del registro destino) por el objeto de hechos que readRulesCtx_ ya
// construyó en ctx[<recurso destino>] — sin releer hojas. El valor plano se
// conserva bajo `_key` para que el front pueda seguir cruzando. Un campo que
// no es `relation`, o que no existe, o cuyo destino no está en ctx ⇒ 500
// (config rota, §16).
function applyViewExpand_(resource, item, expand, ctx, name) {
  if (!Array.isArray(expand) || expand.length === 0) {
    throw apiError_(500, 'expand debe ser lista no vacía en ' + name);
  }
  var byKey = {};
  (resource.fields || []).forEach(function (f) {
    byKey[f.key] = f;
  });
  var out = {};
  Object.keys(item).forEach(function (k) {
    out[k] = item[k];
  });
  for (var i = 0; i < expand.length; i++) {
    var key = expand[i];
    var field = byKey[key];
    if (!field || field.type !== 'relation' || !field.resource) {
      throw apiError_(500, 'expand: ' + String(key) + ' no es relación en ' + name);
    }
    var facts = ctx && ctx[field.resource];
    if (!facts || typeof facts !== 'object') {
      throw apiError_(500, 'expand: relación ' + field.resource + ' sin contexto en ' + name);
    }
    var flat = item[key];
    if (flat === undefined || flat === null || flat === '') continue;
    out[key + '_key'] = flat;
    out[key] = facts;
  }
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
