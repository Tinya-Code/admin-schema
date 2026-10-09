// primitives/handlers/schema — Proyección pública del schema (baseapi §12).
// Resuelto desde `REGISTRY.endpoints.schema` (schema/endpoints/schema), no
// por código en el router.
//
// Rol del endpoint (D1): CONTRATO LEGIBLE — inspección, debug y clientes
// futuros. El admin NO lo consume en runtime: declara sus propios schemas en
// `src/app/schemas/*.schema.ts` y la sincronización back ↔ front la verifica
// el check estático `scripts/contract-check.mjs` (npm run api:check), no un
// merge en memoria. Acá sólo viaja lo estructural — campos, tipos, required,
// enums, patrones, rangos, relaciones, orden y listProjection (§12). JAMÁS
// hojas, columnas internas, reglas, propiedades ni token (§12 «Nunca se
// publica»): para imágenes el schema sólo indica el tipo `image` y la firma
// se pide aparte (§11.3).
//
// Además del modelo se publican metadatos públicos (F7-1), parte del
// contrato legible:
//   - operations: método + ruta efectiva por operación (derivados con
//     core/10-router `resourceRoute_`, la misma fuente que despacha) y la
//     forma pública declarada (shape: pick/include/rename/nest/envelope).
//   - views: where/sort/limit/extends como metadatos — SIN operandos
//     internos (`from: '$item.x'` es expresión de runtime y el nombre del
//     `handler` es implementación; `ref` sí viaja: F7-2 lo expone como
//     metadato de relación, no como datos).
//   - policies.access: { read, write } normalizado (fail-closed 'admin'),
//     lo mínimo para menú/acciones. cache/audit/lock/limits NO viajan.
// Salida: { resources: { <id>: { id, kind, keyField, titleField, ordering,
//                                listProjection, operations, views,
//                                policies, fields } } }
// Sólo recursos con exposeToFront: true.

function handleSchema() {
  var resources = {};
  Object.keys(REGISTRY.resources).forEach(function (id) {
    var resource = getResourceSchema(id);
    if (resource === null || resource.exposeToFront !== true) return;
    resources[id] = projectResourceSchema_(resource);
  });
  return { resources: resources };
}

// Recurso → proyección de UI. Lista blanca de claves: lo que no se nombra
// acá NO viaja (añadir una clave es una decisión, no un accidente).
function projectResourceSchema_(resource) {
  return {
    id: resource.id,
    kind: resource.kind,
    keyField: resource.keyField,
    titleField: resource.titleField,
    ordering: resource.ordering,
    listProjection: resource.listProjection,
    operations: projectOperations_(resource),
    views: projectViews_(resource),
    policies: projectPolicies_(resource),
    fields: resource.fields.map(projectField_),
  };
}

// ── F7-1: operaciones (métodos y rutas efectivas) ───────────────────────────

// Recurso → rutas efectivas por operación. Los nombres y semántica son los
// que despacha engine/24-crud (GET ⇒ list|get, POST ⇒ create, PUT ⇒ update,
// DELETE ⇒ delete); singleton: sólo get/update en su base. La ruta sale de
// `resourceRoute_` (core/10-router) — misma fuente que la tabla de despacho,
// así el front nunca recibe una ruta que el router no resuelva.
function projectOperations_(resource) {
  var base = resourceRoute_(resource);
  var declared = resource.operations || {};
  var out = {};
  if (resource.kind === 'singleton') {
    addOperation_(out, 'get', 'GET', base, declared.get);
    addOperation_(out, 'update', 'PUT', base, declared.update);
    return out;
  }
  addOperation_(out, 'list', 'GET', base, declared.list);
  addOperation_(out, 'get', 'GET', base + '/{key}', declared.get);
  addOperation_(out, 'create', 'POST', base, declared.create);
  addOperation_(out, 'update', 'PUT', base + '/{key}', declared.update);
  addOperation_(out, 'remove', 'DELETE', base + '/{key}', declared.remove);
  return out;
}

function addOperation_(out, name, method, path, declared) {
  var entry = { method: method, path: path };
  if (declared && declared.shape !== undefined) {
    entry.shape = projectShape_(declared.shape);
  }
  out[name] = entry;
}

// Shape declarado → sólo sus claves públicas (lista blanca). Las cinco son
// metadatos de la FORMA de la respuesta — el cliente observa esa respuesta
// de todos modos; nada de hojas, columnas, props ni reglas.
var PROJECTED_SHAPE_KEYS = ['pick', 'include', 'rename', 'nest', 'envelope'];

function projectShape_(shape) {
  var out = {};
  PROJECTED_SHAPE_KEYS.forEach(function (name) {
    if (shape[name] !== undefined) out[name] = shape[name];
  });
  return out;
}

// ── F7-1: vistas (metadatos públicos) ───────────────────────────────────────

// resource.views → proyección por nombre. Publica la forma declarativa
// (where/sort/limit/extends); una vista `handler` (escape hatch §6) sólo
// anota `custom: true`: su nombre y parámetros son implementación.
function projectViews_(resource) {
  var views = resource.views;
  if (views === undefined || views === null) return undefined;
  var out = {};
  Object.keys(views).forEach(function (name) {
    var view = views[name];
    if (!view || typeof view !== 'object' || Array.isArray(view)) return;
    if (view.handler !== undefined) {
      out[name] = { custom: true };
      return;
    }
    var entry = {};
    if (Array.isArray(view.where)) {
      entry.where = view.where.map(projectCondition_).filter(function (cond) {
        return cond !== null;
      });
    }
    if (Array.isArray(view.sort)) {
      entry.sort = view.sort
        .filter(function (step) {
          return step !== null && typeof step === 'object';
        })
        .map(function (step) {
          return { field: step.field, dir: step.dir };
        });
    }
    if (typeof view.limit === 'number') entry.limit = view.limit;
    if (typeof view.extends === 'string') entry.extends = view.extends;
    out[name] = entry;
  });
  return out;
}

// Condición → pública: field/op/not, el literal `value` y `ref` (metadato
// de relación, F7-2). `from: '$item.x'` NO viaja: es expresión interna de
// runtime (engine/27-views).
function projectCondition_(cond) {
  if (!cond || typeof cond !== 'object' || Array.isArray(cond)) return null;
  var out = { field: cond.field, op: cond.op };
  if (cond.not !== undefined) out.not = cond.not;
  if (Object.prototype.hasOwnProperty.call(cond, 'value')) out.value = cond.value;
  if (typeof cond.ref === 'string') out.ref = cond.ref;
  return out;
}

// ── F7-1: políticas públicas ────────────────────────────────────────────────

// resource.policies.access → { read, write } normalizado con las MISMAS
// reglas que normalizeAccess_ (core/10-router): ausencia o valor roto ⇒
// 'admin' (fail-closed). Sólo access: cache/audit/lock/limits son
// internals de operación, el menú y las acciones no los necesitan.
function projectPolicies_(resource) {
  var declared = (resource.policies && resource.policies.access) || {};
  return {
    access: {
      read: normalizeAccessValue_(declared.read),
      write: normalizeAccessValue_(declared.write),
    },
  };
}

function normalizeAccessValue_(value) {
  return typeof value === 'string' && value !== '' ? value : 'admin';
}

// Claves escalares opcionales: se copian sólo si existen en el schema.
// `from` (campo de origen de un slug) viaja porque el widget del front lo
// necesita para autogenerar en el formulario.
var PROJECTED_SCALAR_KEYS = [
  'default',
  'pattern',
  'min',
  'max',
  'minLength',
  'maxLength',
  'minWords',
  'maxWords',
  'unique',
  'immutable',
  'from',
];

// Campo → proyección (recursiva para group/list/string-list).
function projectField_(field) {
  var out = {
    key: field.key,
    type: field.type,
    required: field.required === true, // SIEMPRE boolean, presente o no
  };
  PROJECTED_SCALAR_KEYS.forEach(function (name) {
    if (field[name] !== undefined) out[name] = field[name];
  });

  // Enum declarativo: nombre interno ('availability') → valores (array).
  if (field.enum !== undefined) {
    out.enum =
      typeof field.enum === 'string' && SHEET_ENUMS[field.enum]
        ? SHEET_ENUMS[field.enum]
        : field.enum;
  }

  if (field.type === 'relation') {
    // Aplanado: mismo shape que RelationField del front (§5 de base.md).
    out.relation = {
      resource: field.resource,
      valueField: field.valueField,
      labelField: field.labelField,
      onlyActive: field.onlyActive === true,
    };
  } else if (field.type === 'group') {
    out.fields = field.fields.map(projectField_);
  } else if (field.type === 'list') {
    out.itemFields = field.itemFields.map(projectField_);
    if (field.primaryFirst !== undefined) out.primaryFirst = field.primaryFirst;
  } else if (field.type === 'string-list') {
    if (field.itemType !== undefined) out.itemType = field.itemType;
    out.extraColumns = (field.extraColumns || []).map(projectField_);
  }
  // key-value: sin extra — sus claves (sheet, fk, keyColumn…) son internas.
  return out;
}
