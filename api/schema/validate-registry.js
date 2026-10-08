// schema/validate-registry — Meta-schema del registro (R1.5, B12).
//
// Corre AL CARGAR. El orden de ficheración lo garantiza: dentro de
// `schema/` la ordenación alfabética pone `validate-registry.js` DESPUÉS de
// `endpoints/`, `enums/`, `resources/` y `types/`, así que todos los
// recursos ya se auto-registraron y `FIELD_TYPES` ya existe.
//
// Sirve para DOS consumidores con UN solo código:
//   • GAS  — el throw de abajo rompe el arranque de la webapp.
//   • Node — `scripts/contract-check.mjs` (npm run api:check) evalúa este
//     fichero junto a los resources y pinta el throw como rojo.
//
// Qué comprueba (B12):
//   1. claves desconocidas en un recurso/policy/operation/campo → typos
//   2. referencias rotas (titleField, listProjection, dependents, relation)
//   3. tipos, validadores, transforms, checks y hooks inexistentes
// La comparación con el FRONT (listProjection ⊇ listColumns) vive en
// contract-check: acá sólo hay verdad de back.

// ── Vocabulario conocido ───────────────────────────────────────────────────
// Añadir una clave al schema es una DECISIÓN consciente: hay que sumarla
// acá. Un typo (`titlefiled`) cae en cambio contra esta lista.

var KNOWN_RESOURCE_KEYS = [
  'id',
  'kind',
  'sheet',
  'keyField',
  'immutableKey',
  'titleField',
  'ordering',
  'orderStep',
  'activeField',
  'onDelete',
  'dependents',
  'listPick',
  'listProjection',
  'imageFolder',
  'kvColumns',
  'operations',
  'views',
  'checks',
  'hooks',
  'policies',
  'exposeToFront',
  'fields',
];

var KNOWN_POLICY_KEYS = ['access', 'audit', 'cache', 'lock'];
var KNOWN_OPERATION_KEYS = ['list', 'get', 'create', 'update', 'remove', 'reorder', 'bulk'];
// collection: filas con su propio key.  singleton: una fila KV (storageMap_).
// dashboard: descriptor SIN storage (`sheet: null`) que sólo expone datos
// calculados al front — no tiene filas que validar.
var KNOWN_RESOURCE_KINDS = ['collection', 'singleton', 'dashboard'];
var DEFAULT_KV_COLUMNS = ['key', 'value', 'type', 'note'];

// Válidos EN TODOS los field, sean del tipo que sean.
var KNOWN_FIELD_KEYS = [
  'key',
  'type',
  'required',
  'default',
  'unique',
  'immutable',
  'from',
  'pattern',
  'min',
  'max',
  'minLength',
  'maxLength',
  'minWords',
  'maxWords',
  'format',
  'enum',
  'system',
  'computed',
  // anidados
  'fields',
  'itemFields',
  'itemType',
  'extraColumns',
  'primaryFirst',
  'relation',
  'resource',
  'valueField',
  'labelField',
  'onlyActive',
  'sheet',
  'fk',
  'keyColumn',
  'valueColumn',
  'positionField',
];

// `KNOWN_FIELD_KEYS` hace doble trabajo: es la lista de claves válidas en un
// campo Y, para los validadores, la de las que 23-validate implementa de
// verdad — un `minLenght` (typo) cae contra ella en el check 1.

// ── 1 · Claves desconocidas ─────────────────────────────────────────────────

function unknownKeys_(where, obj, known) {
  var out = [];
  Object.keys(obj).forEach(function (k) {
    if (known.indexOf(k) === -1) out.push(where + ": clave desconocida '" + k + "'");
  });
  return out;
}

// ── Recorrido ───────────────────────────────────────────────────────────────

function walkFields_(where, fields, issues) {
  if (!Array.isArray(fields)) {
    issues.push(where + ': `fields` debe ser un arreglo');
    return;
  }
  fields.forEach(function (field, i) {
    var at = where + '[' + i + ']';
    if (!field || typeof field !== 'object') {
      issues.push(at + ': no es un objeto');
      return;
    }
    issues.push.apply(issues, unknownKeys_(at, field, KNOWN_FIELD_KEYS));

    // 3a. tipo de campo inexistente → el motor no sabe leerlo ni pintarlo.
    if (
      typeof field.type === 'string' &&
      !Object.prototype.hasOwnProperty.call(FIELD_TYPES, field.type)
    ) {
      issues.push(at + ": tipo de campo inexistente '" + field.type + "'");
    }

    // Los validadores se cubren en unknownKeys_: sólo existen los de
    // KNOWN_FIELD_KEYS, que es una lista a la vez de "clave válida" y de
    // "cosa que 23-validate sabe comprobar".

    // 2b. relación externa — acá, dentro del recorrido, para que también
    // aplique a un `relation` anidado dentro de un group o un list.
    if (field.type === 'relation' && typeof field.resource === 'string') {
      if (!Object.prototype.hasOwnProperty.call(REGISTRY.resources, field.resource)) {
        issues.push(
          at +
            ": relation '" +
            field.key +
            "' apunta al recurso '" +
            field.resource +
            "', que no existe",
        );
      }
    }

    if (field.fields) walkFields_(at + '.fields', field.fields, issues);
    if (field.itemFields) walkFields_(at + '.itemFields', field.itemFields, issues);
    if (field.extraColumns) walkFields_(at + '.extraColumns', field.extraColumns, issues);
  });
}

function fieldKeySet_(resource) {
  var keys = {};
  var walk = function (fields) {
    (fields || []).forEach(function (f) {
      if (!f || typeof f.key !== 'string') return;
      keys[f.key] = true;
      walk(f.fields);
      walk(f.itemFields);
      walk(f.extraColumns);
    });
  };
  walk(resource.fields);
  return keys;
}

function validateResource_(id, resource, issues) {
  var where = 'resources.' + id;

  // 1. claves de recurso
  issues.push.apply(issues, unknownKeys_(where, resource, KNOWN_RESOURCE_KEYS));

  if (KNOWN_RESOURCE_KINDS.indexOf(resource.kind) === -1) {
    issues.push(where + ": kind inválido '" + resource.kind + "'");
  }

  if (resource.policies && typeof resource.policies === 'object') {
    issues.push.apply(
      issues,
      unknownKeys_(where + '.policies', resource.policies, KNOWN_POLICY_KEYS),
    );
  }

  if (resource.operations && typeof resource.operations === 'object') {
    Object.keys(resource.operations).forEach(function (op) {
      if (KNOWN_OPERATION_KEYS.indexOf(op) === -1) {
        issues.push(where + ": operación desconocida '" + op + "'");
        return;
      }
      var decl = resource.operations[op];
      if (decl && typeof decl === 'object' && !Array.isArray(decl)) {
        issues.push.apply(
          issues,
          unknownKeys_(where + '.operations.' + op, decl, ['computed', 'shape']),
        );
      }
    });
  }

  var fieldKeys = fieldKeySet_(resource);

  // 2. referencias rotas
  //
  // Tres casos distintos que NO se pueden tratar igual:
  //   · collection  → keyField/titleField son campos del schema.
  //   · singleton   → vive en una hoja KV: `keyField` apunta a la columna
  //                    `key` del KV (24-crud.js:116 lo resuelve contra el
  //                    flat escrito), NO a un campo del schema.
  //   · descriptor  → `sheet: null` y sin filas: keyField/titleField son
  //                    etiquetas del front (dashboard), no hay nada que
  //                    comprobar contra `fields`.
  var isDescriptor = resource.sheet === null;

  if (resource.keyField !== undefined && resource.keyField !== null) {
    if (resource.kind === 'singleton') {
      var kvCols = resource.kvColumns || DEFAULT_KV_COLUMNS;
      if (kvCols.indexOf(resource.keyField) === -1) {
        issues.push(where + ": keyField '" + resource.keyField + "' no está en kvColumns");
      }
    } else if (!isDescriptor && !fieldKeys[resource.keyField]) {
      issues.push(where + ": keyField '" + resource.keyField + "' no es un campo del recurso");
    }
  }

  if (!isDescriptor) {
    if (resource.titleField !== undefined && resource.titleField !== null) {
      if (!fieldKeys[resource.titleField]) {
        issues.push(
          where + ": titleField '" + resource.titleField + "' no es un campo del recurso",
        );
      }
    }
    if (resource.activeField !== undefined && resource.activeField !== null) {
      if (!fieldKeys[resource.activeField]) {
        issues.push(
          where + ": activeField '" + resource.activeField + "' no es un campo del recurso",
        );
      }
    }
    if (resource.listProjection !== undefined && resource.listProjection !== null) {
      if (!Array.isArray(resource.listProjection)) {
        issues.push(where + ': listProjection debe ser un arreglo');
      } else {
        resource.listProjection.forEach(function (key) {
          if (!fieldKeys[key]) {
            issues.push(where + ": listProjection apunta a '" + key + "', que no es un campo");
          }
        });
      }
    }
  }
  (resource.dependents || []).forEach(function (dep) {
    if (!Object.prototype.hasOwnProperty.call(REGISTRY.resources, dep)) {
      issues.push(where + ": dependents apunta a '" + dep + "', que no es un recurso");
    }
  });

  // La comprobación de `relation` vive en walkFields_ para no perder los
  // anidados en group/list.

  walkFields_(where + '.fields', resource.fields, issues);

  // 3c. transforms de `operations.<op>.computed`
  Object.keys(resource.operations || {}).forEach(function (op) {
    var computed = resource.operations[op] && resource.operations[op].computed;
    if (!Array.isArray(computed)) return;
    computed.forEach(function (decl, i) {
      var at = where + '.operations.' + op + '.computed[' + i + ']';
      if (!decl || typeof decl !== 'object') {
        issues.push(at + ': no es un objeto');
        return;
      }
      if (typeof decl.transform !== 'string' || !REGISTRY.transforms[decl.transform]) {
        issues.push(at + ": transform inexistente '" + decl.transform + "'");
      }
      if (typeof decl.field !== 'string' || !fieldKeys[decl.field]) {
        issues.push(at + ": campo destino '" + decl.field + "' no existe en el recurso");
      }
      if (typeof decl.from !== 'string' || !fieldKeys[decl.from]) {
        issues.push(at + ": campo origen '" + decl.from + "' no existe en el recurso");
      }
    });
  });

  // 3d. checks inexistentes
  (resource.checks || []).forEach(function (decl, i) {
    var name = decl && decl.check;
    if (typeof name !== 'string' || !REGISTRY.checks[name]) {
      issues.push(where + '.checks[' + i + "]: check inexistente '" + name + "'");
    }
  });

  // 3e. hooks inexistentes
  Object.keys(resource.hooks || {}).forEach(function (op) {
    (resource.hooks[op] || []).forEach(function (name, i) {
      if (!REGISTRY.hooks[name]) {
        issues.push(where + '.hooks.' + op + '[' + i + "]: hook inexistente '" + name + "'");
      }
    });
  });
}

/** Devuelve TODOS los problemas (no corta en el primero). */
function validateRegistry_() {
  var issues = [];
  Object.keys(REGISTRY.resources).forEach(function (id) {
    validateResource_(id, REGISTRY.resources[id], issues);
  });

  // Ningún endpoint puede apuntar a una función sólo-de-editor (R2.2,
  // auth.md §4.7): el router cae a globalThis[handler], así que declararla
  // bastaría para exponerla por HTTP. Esto la hace fallar en el ARRANQUE.
  Object.keys(REGISTRY.endpoints).forEach(function (id) {
    var handler = REGISTRY.endpoints[id] && REGISTRY.endpoints[id].handler;
    if (typeof handler === 'string' && EDITOR_ONLY_FNS.indexOf(handler) !== -1) {
      issues.push(
        'endpoints.' + id + ": handler '" + handler + "' es sólo ejecutable desde el editor",
      );
    }
  });

  return issues;
}

// ── Al cargar ───────────────────────────────────────────────────────────────

function assertRegistryValid_() {
  var issues = validateRegistry_();
  if (issues.length === 0) return;
  throw new Error('REGISTRY inválido (' + issues.length + '):\n  - ' + issues.join('\n  - '));
}

assertRegistryValid_();
