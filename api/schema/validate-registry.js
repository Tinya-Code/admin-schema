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
  'actions',
  'transitions',
  'policies',
  'exposeToFront',
  // F7 · R7.2 (auth §4.8): qué viaja a CADA frontend. `exposeToFront` es la
  // audiencia admin; la pública es lista blanca estricta y la leen los
  // endpoints `/p/*` (p. ej. handlePublicOrder).
  'audiences',
  'fields',
];

// Claves admitidas en un endpoint (B2 · R5.1): las históricas + el contrato
// declarativo input/output/cache/since. Un typo acá es un endpoint que el
// router lee a medias, así que cae en esta lista como cualquier recurso.
var KNOWN_ENDPOINT_KEYS = [
  'route',
  'method',
  'access',
  'limits',
  'handler',
  'resource',
  'input',
  'output',
  'cache',
  'since',
];

// Tipos admitidos en input/output de un endpoint: los de FIELD_TYPES más
// `secret`, que no es un tipo de storage sino la marca de «sólo presencia»
// (la contraseña del login).
var ENDPOINT_EXTRA_TYPES = ['secret'];

// Versión de un endpoint/capabilidad: '1.0', '1.2'…
var VERSION_PATTERN = /^\d+\.\d+$/;

var KNOWN_POLICY_KEYS = ['access', 'audit', 'cache', 'lock'];
var KNOWN_OPERATION_KEYS = ['list', 'get', 'create', 'update', 'remove', 'reorder', 'bulk'];
// Claves del objeto declarativo de cada operación (R5.3 añade `mode`).
var OPERATION_DECL_KEYS = ['computed', 'shape', 'mode'];
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
  // B8 · R7.4b — acceso fino por campo (misma gramática de niveles)
  'access',
  // anidados
  'fields',
  'itemFields',
  'itemType',
  'extraColumns',
  'primaryFirst',
  'relation',
  // F8 · R6.5 (D62): la fuente declarada de un `relation` (o de un select
  // con datos remotos) es un ÚNICO objeto `{ resource, view?, params?, … }`.
  // Las claves planas antiguas (`resource`/`valueField`/`labelField`) se
  // retiraron: un schema viejo choca acá contra la lista, no en runtime.
  'source',
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
      !Object.prototype.hasOwnProperty.call(REGISTRY.capabilities.fieldTypes, field.type)
    ) {
      issues.push(at + ": tipo de campo inexistente '" + field.type + "'");
    }

    // 3f. `computed` de columna → generador declarado (R3.15). Hoy el único
    // es 'now'; el motor lo distingue en 24-crud y la referencia rota cae
    // acá, en el arranque, no en runtime.
    if (field.computed !== undefined && field.computed !== null) {
      if (typeof field.computed !== 'string') {
        issues.push(at + ': `computed` debe ser el id de un generador');
      } else if (
        !Object.prototype.hasOwnProperty.call(REGISTRY.capabilities.computed, field.computed)
      ) {
        issues.push(at + ": computed inexistente '" + field.computed + "'");
      }
    }

    // B8 · R7.4b — `access` por campo: un typo acá es un campo que se
    // filtra de más o de menos en tráfico real, así que el arranque lo
    // reprueba con la MISMA gramática de niveles que las políticas.
    if (field.access !== undefined && field.access !== null) {
      var atAccess = at + '.access';
      if (typeof field.access !== 'object' || Array.isArray(field.access)) {
        issues.push(atAccess + ': debe ser un objeto { read?, write? }');
      } else {
        issues.push.apply(issues, unknownKeys_(atAccess, field.access, ['read', 'write']));
        ['read', 'write'].forEach(function (side) {
          var level = field.access[side];
          if (level === undefined || level === null) return;
          if (typeof level !== 'string' || ACCESS_LEVELS.indexOf(level) === -1) {
            issues.push(atAccess + '.' + side + ": nivel inválido '" + String(level) + "'");
          }
        });
      }
    }

    // Los validadores se cubren en unknownKeys_: sólo existen los de
    // KNOWN_FIELD_KEYS, que es una lista a la vez de "clave válida" y de
    // "cosa que 23-validate sabe comprobar".

    // 2b. relación externa — acá, dentro del recorrido, para que también
    // aplique a un `relation` anidado dentro de un group o un list. La
    // fuente vive en `field.source.resource` (F8 · R6.5); sin objeto o sin
    // recurso no hay nada que comprobar (lo levanta 23-validate en la
    // escritura y `walkFields_` no debe duplicar ese error).
    if (field.type === 'relation') {
      var src = field.source;
      if (src === undefined || src === null) {
        issues.push(at + ": relation '" + field.key + "' sin source declarado");
      } else if (typeof src !== 'object' || Array.isArray(src)) {
        issues.push(at + ': `source` debe ser un objeto { resource, view?, params? }');
      } else if (typeof src.resource !== 'string' || src.resource === '') {
        issues.push(at + ': `source.resource` debe ser el id de un recurso');
      } else if (!Object.prototype.hasOwnProperty.call(REGISTRY.resources, src.resource)) {
        issues.push(
          at +
            ": relation '" +
            field.key +
            "' apunta al recurso '" +
            src.resource +
            "', que no existe",
        );
      }
    }

    if (field.fields) walkFields_(at + '.fields', field.fields, issues);
    if (field.itemFields) walkFields_(at + '.itemFields', field.itemFields, issues);
    if (field.extraColumns) walkFields_(at + '.extraColumns', field.extraColumns, issues);
  });
}

// Tipo de un campo declarado (plano o anidado); `undefined` si no existe.
function fieldTypeOf_(resource, key) {
  var found = null;
  var walk = function (fields) {
    (fields || []).forEach(function (f) {
      if (found !== null) return;
      if (f && f.key === key) {
        found = f.type;
        return;
      }
      walk(f.fields);
      walk(f.itemFields);
      walk(f.extraColumns);
    });
  };
  walk(resource.fields);
  return found === null ? undefined : found;
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

// B3 · R5.4 — `acciones de dominio`: un cambio con nombre, declarado en el
// recurso y publicado como POST /<base>/<clave>/actions/<nombre>. Se juzga
// acá lo que el motor no puede: vocabulario, forma y las exclusiones que
// hacen falta para que la declaración sea inequívoca.
var ACTION_DECL_KEYS = ['from', 'set', 'handler', 'hooks', 'access'];
var ACTION_NAME_RE = /^[A-Za-z0-9_-]+$/;
// Vocabulario de `11-auth` §4.4, DUPLICADO a propósito: en runtime lo
// desconocido se convierte en `role:admin` (fail-closed correcto), pero eso
// esconde un typo en la declaración — acá el typo es ROJO.
var ACCESS_LEVELS = ['public', 'session', 'admin', 'role:admin', 'role:staff'];

function validateActions_(where, resource, issues) {
  var actions = resource.actions;
  if (actions === undefined || actions === null) return;
  if (typeof actions !== 'object' || Array.isArray(actions)) {
    issues.push(where + '.actions: debe ser un objeto de acciones');
    return;
  }
  var fieldKeys = fieldKeySet_(resource);

  Object.keys(actions).forEach(function (name) {
    var at = where + '.actions.' + name;
    if (!ACTION_NAME_RE.test(name)) {
      issues.push(at + ": nombre inválido '" + name + "' (letras, dígitos, _ y -)");
      return;
    }
    var decl = actions[name];
    if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
      issues.push(at + ': debe ser un objeto');
      return;
    }
    issues.push.apply(issues, unknownKeys_(at, decl, ACTION_DECL_KEYS));

    // Dos formas, mutuamente excluyentes: declarativa O escape hatch.
    var hasSet = decl.set !== undefined;
    var hasHandler = typeof decl.handler === 'string' && decl.handler !== '';
    if (hasSet === hasHandler) {
      issues.push(
        at + ": necesita 'set' (declarativa) o 'handler' (escape hatch), no ambas ni ninguna",
      );
    }

    var setKeys = null;
    if (hasSet) {
      setKeys =
        decl.set && typeof decl.set === 'object' && !Array.isArray(decl.set)
          ? Object.keys(decl.set)
          : null;
      if (setKeys === null || setKeys.length === 0) {
        issues.push(at + '.set: debe ser un objeto con al menos un campo');
      } else {
        setKeys.forEach(function (field) {
          if (!fieldKeys[field]) issues.push(at + '.set.' + field + ': campo inexistente');
        });
      }
    }

    // `from` se juzga FUERA del bloque de `set`: un `{ handler, from }` no
    // tiene estado que proteger y ese error quedaba tapado ahí adentro.
    if (decl.from !== undefined) {
      if (!Array.isArray(decl.from) || decl.from.length === 0) {
        issues.push(at + '.from: debe ser un array de valores permitidos');
      } else if (
        decl.from.some(function (v) {
          return v !== null && typeof v === 'object';
        })
      ) {
        issues.push(at + '.from: los valores deben ser escalares');
      } else if (setKeys === null) {
        issues.push(at + ": 'from' sin 'set': ¿qué estado protege?");
      } else if (setKeys.length !== 1) {
        issues.push(at + ": 'from' sólo aplica con UN campo en set (¿cuál compara?)");
      }
    }

    if (decl.handler !== undefined && (typeof decl.handler !== 'string' || decl.handler === '')) {
      issues.push(at + '.handler: debe ser el nombre de una función registrada');
    }

    if (decl.access !== undefined) {
      if (typeof decl.access !== 'string' || ACCESS_LEVELS.indexOf(decl.access.trim()) === -1) {
        issues.push(at + ": nivel de access inválido '" + String(decl.access) + "'");
      }
    }

    if (decl.hooks !== undefined) {
      if (!Array.isArray(decl.hooks)) {
        issues.push(at + '.hooks: debe ser un array de nombres');
      } else {
        decl.hooks.forEach(function (hookName, i) {
          if (!REGISTRY.capabilities.hooks[hookName]) {
            issues.push(at + '.hooks[' + i + "]: hook inexistente '" + hookName + "'");
          }
        });
      }
    }
  });
}

// B3 · R5.5 — `transitions`: máquina de estado por campo. Se juzga al
// arranque lo que el motor no puede ver: que el campo exista, que cada
// regla sea «valor actual → lista de permitidos» y que TODOS los valores
// referenciados estén en el `enum` del campo si el campo lo declara.
function validateTransitions_(where, resource, issues) {
  var machines = resource.transitions;
  if (machines === undefined || machines === null) return;
  if (typeof machines !== 'object' || Array.isArray(machines)) {
    issues.push(where + '.transitions: debe ser un objeto de máquinas por campo');
    return;
  }

  Object.keys(machines).forEach(function (field) {
    var at = where + '.transitions.' + field;
    var declaration = fieldKeySet_(resource)[field] !== undefined;
    if (!declaration) {
      issues.push(at + ': campo inexistente');
      return;
    }
    var rules = machines[field];
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
      issues.push(at + ': debe ser un mapa de valor actual → permitidos');
      return;
    }
    var states = Object.keys(rules);
    if (states.length === 0) {
      issues.push(at + ': máquina vacía (¿para qué declararla?)');
      return;
    }
    states.forEach(function (state) {
      var allowed = rules[state];
      if (!Array.isArray(allowed) || allowed.length === 0) {
        issues.push(at + '.' + state + ': debe ser un array de estados permitidos');
        return;
      }
      if (
        allowed.some(function (value) {
          return value !== null && typeof value === 'object';
        })
      ) {
        issues.push(at + '.' + state + ': los estados deben ser escalares');
      }
    });
  });

  // Si el campo declara `enum`, todo valor referenciado (clave o destino)
  // tiene que vivir ahí: una máquina que habla en un vocabulario que el
  // campo no acepta nunca se va a cumplir.
  resource.fields.forEach(function walk(field) {
    if (field.enum !== undefined && Array.isArray(field.enum)) {
      var machine = machines[field.key];
      if (machine && typeof machine === 'object') {
        Object.keys(machine).forEach(function (state) {
          if (field.enum.indexOf(state) === -1) {
            issues.push(
              where + '.transitions.' + field.key + '.' + state + ': no es un valor del enum',
            );
          }
          var allowed = machine[state];
          (Array.isArray(allowed) ? allowed : []).forEach(function (target) {
            if (field.enum.indexOf(target) === -1) {
              issues.push(
                where +
                  '.transitions.' +
                  field.key +
                  '.' +
                  state +
                  ': destino no declarado en el enum (' +
                  String(target) +
                  ')',
              );
            }
          });
        });
      }
    }
    (field.fields || []).forEach(walk);
    (field.itemFields || []).forEach(walk);
    (field.extraColumns || []).forEach(walk);
  });
}

// B3 · R5.3 — `operations`: el recurso decide qué tiene encendido; el motor
// sólo obedece (dispatchResource_ responde 405 a lo no declarado). Acá se
// juzga la DECLARACIÓN: vocabulario, tipos y los pocos tunings que hoy
// significa algo (`remove.mode`, `reorder`). Lo que el motor no implementa
// (`bulk`) no se puede encender: declararlo como activo es un rojo al
// arranque, no una promesa que nadie cumple.
var REMOVE_MODES = ['hard', 'soft', 'forbidden'];

function validateOperations_(where, resource, issues) {
  var ops = resource.operations;
  if (ops === undefined || ops === null) return;
  if (typeof ops !== 'object' || Array.isArray(ops)) {
    issues.push(where + '.operations: debe ser un objeto de operaciones');
    return;
  }

  Object.keys(ops).forEach(function (op) {
    if (KNOWN_OPERATION_KEYS.indexOf(op) === -1) {
      issues.push(where + ": operación desconocida '" + op + "'");
      return;
    }
    var at = where + '.operations.' + op;
    var decl = ops[op];

    if (decl === true || decl === false) {
      if (op === 'bulk' && decl === true) {
        issues.push(at + ": 'bulk' no está implementado en el motor todavía");
      }
      if (op === 'reorder' && decl === true && resource.ordering !== 'positioned') {
        issues.push(at + ": 'reorder' exige ordering: 'positioned' en el recurso");
      }
      return;
    }
    if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
      issues.push(at + ": debe ser true, false u objeto (llegó '" + typeof decl + "')");
      return;
    }

    issues.push.apply(issues, unknownKeys_(at, decl, OPERATION_DECL_KEYS));

    if (op === 'bulk') {
      issues.push(at + ": 'bulk' no está implementado en el motor todavía");
      return;
    }
    if (op === 'reorder' && resource.ordering !== 'positioned') {
      issues.push(at + ": 'reorder' exige ordering: 'positioned' en el recurso");
    }
    if (op === 'remove') {
      var mode = decl.mode === undefined ? 'hard' : decl.mode;
      if (REMOVE_MODES.indexOf(mode) === -1) {
        issues.push(at + ": mode inválido '" + mode + "' (hard | soft | forbidden)");
      } else if (mode === 'soft') {
        // La baja lógica escribe `activeField`: sin ese campo no hay dónde.
        if (!resource.activeField) {
          issues.push(at + ": mode 'soft' exige activeField en el recurso");
        } else if (fieldTypeOf_(resource, resource.activeField) !== 'boolean') {
          issues.push(
            at + ": activeField '" + resource.activeField + "' debe ser un campo boolean",
          );
        }
      }
    }
  });
}

// F7 · R7.2 — audiencias (auth §4.8): el recurso declara qué viaja a cada
// frontend. Dos nombres y nada más; una clave fuera de esta lista es un typo
// que el motor convertiría en silencio.
var AUDIENCE_NAMES = ['admin', 'public'];
var AUDIENCE_DECL_KEYS = ['listProjection', 'views', 'operations'];
// Lo público viaja SIN sesión ⇒ sólo lectura. Ninguna operación de escritura
// se acepta en la audiencia pública ni en el registro real.
var PUBLIC_AUDIENCE_OPERATIONS = ['list', 'get'];

/**
 * Audiencias de un recurso → ROJO al arranque si la declaración miente.
 *
 * Reglas (fail-closed en runtime, ROJO acá):
 *   · nombre y claves de la lista blanca — un typo no se convierte en nada;
 *   · `admin` exige `exposeToFront: true` — esa puerta ES la audiencia admin;
 *   · lo público es de sólo lectura y su `listProjection` sólo puede nombrar
 *     campos del recurso (así `customer_notes` no puede colarse por typo);
 *   · una operación de audiencia tiene que estar ENCENDIDA en el recurso:
 *     prometer `create` con `operations.create: false` es mentira de schema;
 *   · un recurso interno (`_users`, `_audit`…) nunca declara `public`.
 */
function validateAudiences_(id, where, resource, fieldKeys, issues) {
  if (resource.audiences === undefined || resource.audiences === null) return;
  if (typeof resource.audiences !== 'object' || Array.isArray(resource.audiences)) {
    issues.push(where + ".audiences: debe ser un objeto con 'admin' y/o 'public'");
    return;
  }
  if (id.indexOf('_') === 0 && resource.audiences['public'] !== undefined) {
    issues.push(where + ": recurso interno '" + id + "' no puede declarar audiencia 'public'");
  }

  var viewNames = Object.keys(resource.views || {});
  Object.keys(resource.audiences).forEach(function (name) {
    var at = where + '.audiences.' + name;
    if (AUDIENCE_NAMES.indexOf(name) === -1) {
      issues.push(at + ": audiencia desconocida (admite 'admin' y 'public')");
      return;
    }
    var decl = resource.audiences[name];
    if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
      issues.push(at + ': debe ser un objeto');
      return;
    }
    issues.push.apply(issues, unknownKeys_(at, decl, AUDIENCE_DECL_KEYS));

    if (name === 'admin' && resource.exposeToFront !== true) {
      issues.push(at + ": la audiencia 'admin' exige exposeToFront: true en el recurso");
    }

    if (decl.listProjection !== undefined) {
      if (!Array.isArray(decl.listProjection)) {
        issues.push(at + '.listProjection: debe ser un array de nombres de campo');
      } else {
        decl.listProjection.forEach(function (key) {
          if (typeof key !== 'string' || !fieldKeys[key]) {
            issues.push(at + ".listProjection '" + key + "' no es un campo del recurso");
          }
        });
      }
    }

    if (decl.views !== undefined) {
      if (!Array.isArray(decl.views)) {
        issues.push(at + '.views: debe ser un array de nombres de vista');
      } else {
        decl.views.forEach(function (view) {
          if (viewNames.indexOf(view) === -1) {
            issues.push(at + ".views '" + view + "' no es una vista del recurso");
          }
        });
      }
    }

    if (decl.operations !== undefined) {
      if (!Array.isArray(decl.operations)) {
        issues.push(at + '.operations: debe ser un array de nombres de operación');
      } else {
        decl.operations.forEach(function (op) {
          if (KNOWN_OPERATION_KEYS.indexOf(op) === -1) {
            issues.push(at + ": operación desconocida '" + op + "'");
            return;
          }
          if (name === 'public' && PUBLIC_AUDIENCE_OPERATIONS.indexOf(op) === -1) {
            issues.push(at + ": la audiencia 'public' es de sólo lectura ('" + op + "')");
            return;
          }
          var enabled = resource.operations ? resource.operations[op] : undefined;
          if (!operationEnabledDecl_(op, enabled)) {
            issues.push(at + ": '" + op + "' no está encendida en operations del recurso");
          }
        });
      }
    }
  });
}

// ¿La operación declarada en `resource.operations[op]` está encendida?
// Misma verdad que el dispatcher de 24-crud (false/ausente ⇒ 405; remove
// con mode 'forbidden' también), aquí para que la audiencia no prometa
// rutas que el motor no sirve.
function operationEnabledDecl_(op, decl) {
  if (decl === undefined || decl === null || decl === false) return false;
  if (op === 'remove' && decl === Object(decl) && decl.mode === 'forbidden') return false;
  return true;
}

// B8 · R7.4 — políticas de acceso. El umbral por GRUPO (`read`|`write`) ya
// existía y lo aplica el router; lo nuevo es el override por OPERACIÓN
// (`access.operations`), que el router no puede juzgar porque sólo ve el
// grupo — lo exige 24-crud, donde la operación ya se conoce. Acá se juzga
// la DECLARACIÓN:
//   · read/write y cada override tienen que ser un nivel del vocabulario;
//   · una operación desconocida en el mapa es un typo que nunca se aplica
//     (y `delete`/`read` del vocabulario viejo caen acá, no en runtime);
//   · el override tiene que estar ENCENDIDO en operations (mismo criterio
//     que en audiences: una política para una operación apagada es mentira);
//   · y no puede ser MÁS SUELTO que el umbral de su grupo: en tráfico real
//     el router ya exigió ese umbral, así que «más suelto» no afloja nada —
//     declara «cualquiera» donde el motor sigue exigiendo.
// Rangos de apretado (menos identidades que pasan ⇒ más apretado), iguales
// a los de 11-auth: public ⊂ session ⊂ role:staff ⊂ role:admin(≡admin).
var ACCESS_RANK = { public: 0, session: 1, 'role:staff': 2, 'role:admin': 3 };

function accessRank_(level) {
  return ACCESS_RANK[level === 'admin' ? 'role:admin' : level];
}

function validatePolicyAccess_(where, resource, issues) {
  var policies = resource.policies;
  if (!policies || typeof policies !== 'object') return;
  var access = policies.access;
  if (access === undefined || access === null) return;
  var at = where + '.policies.access';
  if (typeof access !== 'object' || Array.isArray(access)) {
    issues.push(at + ': debe ser un objeto de políticas');
    return;
  }
  issues.push.apply(issues, unknownKeys_(at, access, ['read', 'write', 'operations']));

  // Umbral por grupo. Ausente ⇒ 'admin' (la misma verdad que aplica el
  // router en policyAccess_). Ojo: la clave del rango es `role:admin` — el
  // alias `admin` sólo lo resuelve accessRank_.
  var thresholds = { read: accessRank_('admin'), write: accessRank_('admin') };
  ['read', 'write'].forEach(function (group) {
    var level = access[group];
    if (level === undefined || level === null) return;
    if (typeof level !== 'string' || ACCESS_LEVELS.indexOf(level) === -1) {
      issues.push(at + '.' + group + ": nivel inválido '" + String(level) + "'");
      return;
    }
    thresholds[group] = accessRank_(level);
  });

  var ops = access.operations;
  if (ops === undefined || ops === null) return;
  if (typeof ops !== 'object' || Array.isArray(ops)) {
    issues.push(at + '.operations: debe ser un mapa operación ⇒ nivel');
    return;
  }
  Object.keys(ops).forEach(function (op) {
    var opAt = at + '.operations.' + op;
    if (KNOWN_OPERATION_KEYS.indexOf(op) === -1) {
      issues.push(
        opAt +
          ': operación desconocida (el motor habla list, get, create, update, remove, reorder, bulk)',
      );
      return;
    }
    var level = ops[op];
    if (typeof level !== 'string' || ACCESS_LEVELS.indexOf(level) === -1) {
      issues.push(opAt + ": nivel inválido '" + String(level) + "'");
      return;
    }
    if (!operationEnabledDecl_(op, resource.operations ? resource.operations[op] : undefined)) {
      issues.push(
        opAt +
          ": '" +
          op +
          "' no está encendida en operations del recurso — la política nunca se aplica",
      );
      return;
    }
    var group = op === 'list' || op === 'get' ? 'read' : 'write';
    if (accessRank_(level) < thresholds[group]) {
      issues.push(
        opAt +
          ": '" +
          level +
          "' es más suelto que el umbral " +
          group +
          ' — en tráfico real el router ya lo exige, el override no afloja nada',
      );
    }
  });
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
  validatePolicyAccess_(where, resource, issues);

  var fieldKeys = fieldKeySet_(resource);
  validateOperations_(where, resource, issues);
  validateAudiences_(id, where, resource, fieldKeys, issues);
  validateActions_(where, resource, issues);
  validateTransitions_(where, resource, issues);

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
      if (typeof decl.transform !== 'string' || !REGISTRY.capabilities.computed[decl.transform]) {
        issues.push(at + ": transform inexistente '" + decl.transform + "'");
      } else {
        // args contra argsSchema (R3.15): `params` es lo declarable.
        var gen = REGISTRY.capabilities.computed[decl.transform];
        issues.push.apply(
          issues,
          capabilityArgsIssues_(at + '.params', gen.argsSchema, decl.params),
        );
      }
      if (typeof decl.field !== 'string' || !fieldKeys[decl.field]) {
        issues.push(at + ": campo destino '" + decl.field + "' no existe en el recurso");
      }
      if (typeof decl.from !== 'string' || !fieldKeys[decl.from]) {
        issues.push(at + ": campo origen '" + decl.from + "' no existe en el recurso");
      }
    });
  });

  // 3d. checks inexistentes + args contra argsSchema (R3.15)
  (resource.checks || []).forEach(function (decl, i) {
    var at = where + '.checks[' + i + ']';
    var name = decl && decl.check;
    var cap = typeof name === 'string' ? REGISTRY.capabilities.checks[name] : null;
    if (!cap) {
      issues.push(at + ": check inexistente '" + name + "'");
      return;
    }
    // La declaración ES el objeto entero: `check` no es argumento.
    var args = {};
    Object.keys(decl).forEach(function (key) {
      if (key !== 'check') args[key] = decl[key];
    });
    issues.push.apply(issues, capabilityArgsIssues_(at, cap.argsSchema, args));
  });

  // 3e. hooks (B9 · R5.6): juzga el VOCABULARIO del contrato — fase
  // conocida (HOOK_PHASES_, engine/30-events), entradas con forma de nombre
  // u objeto { id, onError }, política onError dentro de ERROR_POLICIES_ e
  // id registrado en capabilities.hooks.
  Object.keys(resource.hooks || {}).forEach(function (op) {
    if (!HOOK_PHASES_[op]) {
      issues.push(where + '.hooks.' + op + ': fase desconocida');
      return;
    }
    var list = resource.hooks[op];
    if (!Array.isArray(list)) {
      issues.push(where + '.hooks.' + op + ': debe ser una lista');
      return;
    }
    list.forEach(function (raw, i) {
      var at = where + '.hooks.' + op + '[' + i + ']';
      var isPlain = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
      var id = typeof raw === 'string' ? raw : isPlain ? raw.id : undefined;
      if (typeof id !== 'string' || id === '') {
        issues.push(at + ': debe ser un nombre u objeto { id, onError }');
        return;
      }
      if (isPlain && raw.onError !== undefined && ERROR_POLICIES_.indexOf(raw.onError) === -1) {
        issues.push(
          at + ".onError: '" + raw.onError + "' fuera de (" + ERROR_POLICIES_.join(' | ') + ')',
        );
      }
      if (!REGISTRY.capabilities.hooks[id]) {
        issues.push(at + ": hook inexistente '" + id + "'");
      }
    });
  });
}

// ¿Es un campo declarado ({ type: 'text', … }) y no un grupo de campos?
function isDeclaredField_(decl) {
  return (
    !!decl && typeof decl === 'object' && !Array.isArray(decl) && typeof decl.type === 'string'
  );
}

// Tipo de un campo de contrato: FIELD_TYPES o `secret` (B2 · R5.1).
function checkEndpointFieldType_(at, field, issues) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    issues.push(at + ': debe ser un campo { type, … }');
    return;
  }
  var type = field.type;
  if (
    typeof type !== 'string' ||
    (FIELD_TYPES[type] === undefined && ENDPOINT_EXTRA_TYPES.indexOf(type) === -1)
  ) {
    issues.push(at + ": tipo de campo inexistente '" + type + "'");
  }
}

// input/output: plano (campo por campo) o por grupos (`params`, `query`, …).
function validateEndpointFields_(where, decl, issues) {
  if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
    issues.push(where + ': debe ser un objeto de campos o de grupos de campos');
    return;
  }
  Object.keys(decl).forEach(function (key) {
    var entry = decl[key];
    var at = where + '.' + key;
    if (isDeclaredField_(entry)) {
      checkEndpointFieldType_(at, entry, issues);
      return;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push(at + ': no es un campo ni un grupo de campos');
      return;
    }
    Object.keys(entry).forEach(function (sub) {
      checkEndpointFieldType_(at + '.' + sub, entry[sub], issues);
    });
  });
}

// Contrato declarativo de un endpoint (B2 · R5.1).
function validateEndpoint_(id, endpoint, issues) {
  var where = 'endpoints.' + id;
  if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) {
    issues.push(where + ': debe ser un objeto');
    return;
  }
  issues.push.apply(issues, unknownKeys_(where, endpoint, KNOWN_ENDPOINT_KEYS));

  if (typeof endpoint.route !== 'string' || endpoint.route.charAt(0) !== '/') {
    issues.push(where + ": `route` debe empezar por '/'");
  }
  // Referencia rota: el handler resuelve `resource` para leer su schema
  // (dashboard, pinVerify, publicOrder), así que un id inexistente sólo se
  // descubre en la petición. Acá muere en el arranque.
  if (endpoint.resource !== undefined) {
    if (typeof endpoint.resource !== 'string') {
      issues.push(where + ': `resource` debe ser el id de un recurso');
    } else if (REGISTRY.resources[endpoint.resource] === undefined) {
      issues.push(where + ": resource inexistente '" + endpoint.resource + "'");
    }
  }
  if (endpoint.input !== undefined) {
    validateEndpointFields_(where + '.input', endpoint.input, issues);
  }
  if (endpoint.output !== undefined) {
    validateEndpointFields_(where + '.output', endpoint.output, issues);
  }
  if (
    endpoint.since !== undefined &&
    (typeof endpoint.since !== 'string' || !VERSION_PATTERN.test(endpoint.since))
  ) {
    issues.push(where + ": `since` debe ser una versión tipo '1.0'");
  }
  // `cache` hoy es declaración sin consumidor (R5.1 la admite y la valida);
  // el que la cuelgue de un handler tendrá la forma ya comprobada acá.
  if (endpoint.cache !== undefined) {
    var cache = endpoint.cache;
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
      issues.push(where + '.cache: debe ser un objeto { ttl, key }');
    } else {
      issues.push.apply(issues, unknownKeys_(where + '.cache', cache, ['ttl', 'key']));
      if (typeof cache.ttl !== 'number' || !isFinite(cache.ttl) || cache.ttl <= 0) {
        issues.push(where + '.cache: `ttl` debe ser un número de segundos > 0');
      }
      if (
        !Array.isArray(cache.key) ||
        cache.key.length === 0 ||
        cache.key.some(function (k) {
          return typeof k !== 'string' || k === '';
        })
      ) {
        issues.push(where + '.cache: `key` debe ser un arreglo de nombres de campo');
      }
    }
  }
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
    var endpoint = REGISTRY.endpoints[id];
    var handler = endpoint && endpoint.handler;
    if (typeof handler === 'string' && EDITOR_ONLY_FNS.indexOf(handler) !== -1) {
      issues.push(
        'endpoints.' + id + ": handler '" + handler + "' es sólo ejecutable desde el editor",
      );
    }
    validateEndpoint_(id, endpoint, issues);
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
