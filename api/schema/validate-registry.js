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
  'commandsRoute',
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
  'hasMany',
  'listPick',
  'listProjection',
  'imageFolder',
  'kvColumns',
  'operations',
  'views',
  'checks',
  'hooks',
  'actions',
  'commands',
  'transitions',
  // R9.5.6 — jobs programados (B14 · O5): triggers de GAS instalados por
  // setupTriggers_ desde el editor, nunca desde un request (O3).
  'schedules',
  // R9.5.7 — webhooks salientes (B14 · O5): entrega HTTP por fase post,
  // firmada con AUTH_SECRET. Un webhook inválido es rojo de arranque.
  'webhooks',
  // R9.5.8 — notificaciones salientes (B14 · O5): un mail por entrada por
  // fase post, dentro de la cuota MailApp. Una notificación inválida es
  // roja de arranque.
  'notify',
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
  'errors',
  'issuesGrant',
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
var KNOWN_OPERATION_KEYS = [
  'list',
  'get',
  'create',
  'update',
  'remove',
  'reorder',
  'bulk',
  'export', // R9.5.4 — volcado plano de los campos declarados
  'import', // R9.5.4 — filas creadas por el MISMO pipeline que el create
];
// Claves del objeto declarativo de cada operación (R5.3 añade `mode`).
var OPERATION_DECL_KEYS = ['computed', 'shape', 'mode'];
// Claves del objeto declarativo de export/import (R9.5.4): `fields` lista las
// claves que viajan, `format` el formato del volcado (export). El import
// ignora `format` — entra como objetos, no como CSV (el front lo parsea).
var IO_DECL_KEYS = ['fields', 'format'];
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
  // R9.5.3 — formatos firmados por campo (tipo `file`/`image`).
  'formats',
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

    // R9.5.3 · `formats` — la lista de extensiones que el backend FIRMA
    // para ese campo (upload-signature). Un typo acá firmaría formatos que
    // nadie sube, así que el arranque la reprueba: sólo en campos de
    // archivo y como extensiones normalizadas, sin duplicados.
    if (field.formats !== undefined && field.formats !== null) {
      var atFormats = at + '.formats';
      if (field.type !== 'file' && field.type !== 'image') {
        issues.push(atFormats + ": sólo existe en campos tipo 'file' o 'image'");
      } else if (typeof field.formats !== 'string' || field.formats.trim() === '') {
        issues.push(atFormats + ": debe ser una lista de extensiones, p. ej. 'pdf,docx'");
      } else {
        var seenFormats = {};
        field.formats.split(',').forEach(function (part) {
          var ext = part.trim().toLowerCase();
          if (!/^[a-z0-9]{1,10}$/.test(ext)) {
            issues.push(atFormats + ": extensión inválida '" + part.trim() + "'");
          } else if (Object.prototype.hasOwnProperty.call(seenFormats, ext)) {
            issues.push(atFormats + ": extensión duplicada '" + ext + "'");
          }
          seenFormats[ext] = true;
        });
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

// R7.6 — subseto de fieldKeySet_: sólo los campos `secret` (recursivo).
function secretFieldKeys_(fields) {
  var keys = {};
  var walk = function (list) {
    (list || []).forEach(function (f) {
      if (!f || typeof f.key !== 'string') return;
      if (f.type === 'secret') keys[f.key] = true;
      walk(f.fields);
      walk(f.itemFields);
      walk(f.extraColumns);
    });
  };
  walk(fields);
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
var DELETE_POLICIES = ['none', 'restrict', 'cascade-children', 'cascade', 'nullify'];

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
      if (op === 'import' && decl === true) {
        issues.push.apply(issues, ioImportNeedsCreate_(at, resource));
      }
      if (op === 'export' && decl === true && resource.kind !== 'collection') {
        issues.push(at + ": 'export' sólo existe en colecciones");
      }
      if (op === 'import' && decl === true && resource.kind !== 'collection') {
        issues.push(at + ": 'import' sólo existe en colecciones");
      }
      return;
    }
    if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
      issues.push(at + ": debe ser true, false u objeto (llegó '" + typeof decl + "')");
      return;
    }

    // R9.5.4: export/import tienen SU vocabulario de claves — mezclarlo con el
    // de las CRUD aceptaría en silencio un `shape` que el motor ignoraría.
    if (op === 'export' || op === 'import') {
      issues.push.apply(issues, unknownKeys_(at, decl, IO_DECL_KEYS));
      issues.push.apply(issues, ioDeclarationIssues_(at, resource, op, decl));
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

// ── R9.5.4 · import/export declarativo ─────────────────────────────────────
//
// ROJO al arranque si la declaración miente (§0.5 · fail-loud):
//   · `fields` son claves de campo TOP-LEVEL existentes;
//   · export sólo campos ESCALARES no-secret: un volcado es dato plano (los
//     hijos van a hojas aparte) y un secreto JAMÁS sale (R7.6, §0.5);
//   · import sólo campos ESCRIBIBLES: ni system ni computados (los pone el
//     motor; dejarlos en la lista blanca sería prometer un import que nunca
//     puede fijarlos);
//   · format ∈ { csv, json }; import en colecciones y con create encendido
//     (importar ES crear — sin pipeline de create no hay por dónde).

function ioDeclarationIssues_(at, resource, op, decl) {
  var issues = [];
  if (op === 'export' && resource.kind !== 'collection') {
    issues.push(at + ": 'export' sólo existe en colecciones");
    return issues; // sin collection no hay filas que volcar ni validar
  }
  if (op === 'import') {
    if (resource.kind !== 'collection') {
      issues.push(at + ": 'import' sólo existe en colecciones");
      return issues;
    }
    issues.push.apply(issues, ioImportNeedsCreate_(at, resource));
  }
  if (decl.format !== undefined && ['csv', 'json'].indexOf(decl.format) === -1) {
    issues.push(at + ".format: inválido '" + decl.format + "' (csv | json)");
  }
  // `format` sólo describe el VOLCADO: el import entra como objetos (el
  // front los parsea), así que declararlo acá sería una clave que el motor
  // ignora — rojo, no silencio (fail-loud).
  if (op === 'import' && decl.format !== undefined) {
    issues.push(at + '.format: no existe en import — el volcado entra como objetos');
  }
  if (decl.fields !== undefined) {
    issues.push.apply(issues, ioFieldListIssues_(at, resource, op, decl.fields));
  }
  return issues;
}

// Importar ES crear: sin `operations.create` encendido no hay pipeline que
// ejecute la fila — declararlo es una ruta que en tráfico corta con 405.
function ioImportNeedsCreate_(at, resource) {
  var createDecl = resource.operations ? resource.operations.create : undefined;
  if (operationEnabledDecl_('create', createDecl)) return [];
  return [at + ": 'import' exige operations.create encendido en el recurso"];
}

// La lista blanca de campos: arreglo no vacío de claves top-level únicas y
// del tipo correcto para la operación. Un campo anidado es «inexistente»:
// sólo existen los que declaran `resource.fields`.
function ioFieldListIssues_(at, resource, op, fields) {
  var issues = [];
  if (!Array.isArray(fields) || fields.length === 0) {
    issues.push(at + '.fields: debe ser un arreglo de claves de campo');
    return issues;
  }
  var seen = {};
  fields.forEach(function (key) {
    var fieldAt = at + '.fields';
    if (typeof key !== 'string' || key === '') {
      issues.push(fieldAt + ': las claves deben ser strings');
      return;
    }
    if (seen[key] === true) {
      issues.push(fieldAt + ": clave duplicada '" + key + "'");
      return;
    }
    seen[key] = true;
    var field = null;
    (resource.fields || []).forEach(function (candidate) {
      if (candidate.key === key) field = candidate;
    });
    if (field === null) {
      issues.push(fieldAt + ": campo inexistente '" + key + "'");
      return;
    }
    var type = fieldTypeOf_(resource, key);
    if (op === 'export') {
      if (type === 'secret') {
        issues.push(fieldAt + ": '" + key + "' es secret: un export nunca lo voltea");
      } else if (
        type === 'group' ||
        type === 'list' ||
        type === 'string-list' ||
        type === 'key-value'
      ) {
        issues.push(fieldAt + ": '" + key + "' vive en la hoja hija: exporta sólo escalares");
      }
    } else if (field.system === true || (field.computed !== undefined && field.computed !== null)) {
      issues.push(fieldAt + ": '" + key + "' es system/computed: lo pone el motor, no se importa");
    }
  });
  return issues;
}

// ── R9.5.6 · jobs programados ─────────────────────────────────────────────
//
// ROJO al arranque si la declaración miente (§0.5 · fail-loud):
//   · `schedules` es un ARREGLO de objetos con las claves EXACTAS
//     { id, cron, handler, args } — una clave de más es un typo que el
//     motor ignoraría en silencio;
//   · `id` string no vacío y único (acá dentro del recurso; el cruce entre
//     recursos lo juzga validateRegistry_, como las rutas de commands);
//   · `cron` en uno de los patrones de ClockTriggerBuilder que el motor
//     sabe instalar (parseScheduleCron_, engine/34-schedules): cualquier
//     otra cosa es un trigger que nadie podría crear;
//   · `handler` nombre de función — NO se comprueba su existencia acá: el
//     escape hatch §6 resuelve en REGISTRY.handlers o globalThis y un
//     handler ausente falla RUIDOSO en setup (editor) y en runtime;
//   · `handler` jamás puede ser una función sólo-de-editor: el trigger
//     corre con privilegios plenos y exponer `setupAll` vía cron abriría
//     la puerta que EDITOR_ONLY_FNS cierra por HTTP;
//   · `args` objeto opcional (el job lo recibe tal cual).
function validateSchedules_(where, resource, issues) {
  var schedules = resource.schedules;
  if (schedules === undefined || schedules === null) return;
  if (!Array.isArray(schedules)) {
    issues.push(where + '.schedules: debe ser un arreglo de jobs programados');
    return;
  }
  var seen = {};
  schedules.forEach(function (decl, index) {
    var at = where + '.schedules[' + index + ']';
    if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
      issues.push(at + ': debe ser un objeto { id, cron, handler, args }');
      return;
    }
    issues.push.apply(issues, unknownKeys_(at, decl, SCHEDULE_DECL_KEYS_));

    if (typeof decl.id !== 'string' || decl.id.trim() === '') {
      issues.push(at + '.id: debe ser un string no vacío');
    } else if (seen[decl.id] === true) {
      issues.push(at + ".id: '" + decl.id + "' ya se usa en otro schedule del recurso");
    } else {
      seen[decl.id] = true;
    }

    if (typeof decl.cron !== 'string' || decl.cron.trim() === '') {
      issues.push(at + '.cron: debe ser un string con un patrón GAS soportado');
    } else if (parseScheduleCron_(decl.cron) === null) {
      issues.push(
        at +
          ".cron: patrón no soportado '" +
          decl.cron +
          "' (everyMinutes(n) | everyHours(n) | atHour(h) | atHour(h) onWeekDay(día))",
      );
    }

    if (typeof decl.handler !== 'string' || decl.handler.trim() === '') {
      issues.push(at + '.handler: debe ser un nombre de función no vacío');
    } else if (EDITOR_ONLY_FNS.indexOf(decl.handler) !== -1) {
      issues.push(at + ".handler: '" + decl.handler + "' es sólo ejecutable desde el editor");
    }

    if (
      decl.args !== undefined &&
      (typeof decl.args !== 'object' || decl.args === null || Array.isArray(decl.args))
    ) {
      issues.push(at + '.args: debe ser un objeto (o ausente)');
    }
  });
}

// ── R9.5.7 · webhooks salientes ─────────────────────────────────────────────
//
// ROJO al arranque si la declaración miente (§0.5 · fail-loud): un webhook
// mal declarado no "se ignora" en runtime — ROMPE el arranque.
//   · `webhooks` es un ARREGLO de objetos con las claves EXACTAS
//     { on, url, sign } — una clave de más es un typo que el motor
//     ignoraría en silencio;
//   · `on` sólo admite fases POST de HOOK_PHASES_ (engine/30-events):
//     afterCreate/afterUpdate/onStatusChange + los alias legacy
//     create/update/delete/reorder. `beforeCreate` se rechaza con mensaje
//     propio: un webhook pre-escritura se dispararía antes de saber si la
//     escritura ocurre y su semántica de fallo (O4, nunca rollback) no
//     aplica;
//   · `url` string https:// absoluto — fail-closed: ni http ni relativa;
//   · `sign` booleano opcional (default false): firma HMAC-SHA256 del
//     cuerpo con AUTH_SECRET (§0.5 — no hay segundo secreto);
//   · el par { on, url } es único dentro del recurso: el MISMO evento
//     entregado dos veces a la MISMA URL es declaración duplicada, no
//     reintento (el motor entrega UNA vez y no reintenta).
function validateWebhooks_(where, resource, issues) {
  var webhooks = resource.webhooks;
  if (webhooks === undefined || webhooks === null) return;
  if (!Array.isArray(webhooks)) {
    issues.push(where + '.webhooks: debe ser un arreglo de webhooks');
    return;
  }
  var seen = {};
  webhooks.forEach(function (decl, index) {
    var at = where + '.webhooks[' + index + ']';
    if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
      issues.push(at + ': debe ser un objeto { on, url, sign }');
      return;
    }
    issues.push.apply(issues, unknownKeys_(at, decl, WEBHOOK_DECL_KEYS_));

    if (typeof decl.on !== 'string' || decl.on.trim() === '') {
      issues.push(at + '.on: debe ser el nombre de una fase');
    } else if (!Object.prototype.hasOwnProperty.call(HOOK_PHASES_, decl.on)) {
      issues.push(at + ".on: fase desconocida '" + decl.on + "'");
    } else if (HOOK_PHASES_[decl.on] !== 'post') {
      issues.push(
        at +
          ".on: '" +
          decl.on +
          "' es una fase PRE (corre antes de escribir) — un webhook sólo puede reaccionar a fases post",
      );
    }

    if (typeof decl.url !== 'string' || decl.url.trim() === '') {
      issues.push(at + '.url: debe ser una URL https absoluta');
    } else if (decl.url.indexOf('https://') !== 0) {
      issues.push(at + ".url: '" + decl.url + "' debe empezar por https:// (fail-closed)");
    }

    if (decl.sign !== undefined && typeof decl.sign !== 'boolean') {
      issues.push(at + '.sign: debe ser booleano (o ausente)');
    }

    if (typeof decl.on === 'string' && typeof decl.url === 'string') {
      var pair = decl.on + ' → ' + decl.url;
      if (seen[pair] === true) {
        issues.push(
          at + ": el par on/url '" + pair + "' ya se entrega en otro webhook del recurso",
        );
      } else {
        seen[pair] = true;
      }
    }
  });
}

// ── R9.5.8 · notificaciones salientes ──────────────────────────────────────
//
// ROJO al arranque si la declaración miente (§0.5 · fail-loud): una
// notificación mal declarada no "se ignora" en runtime — ROMPE el arranque.
//   · `notify` es un ARREGLO de objetos con las claves EXACTAS
//     { on, channel, template, to, subject? } — una clave de más es un typo
//     que el motor ignoraría en silencio. ⚠️ DESVIACIÓN DOCUMENTADA: la spec
//     (refactormotor.md:499) escribe UN objeto `notify: { on, channel,
//     template }`; acá es un arreglo COMO `webhooks` para poder avisar en
//     varios eventos (o al mismo evento a varios destinatarios) con el mismo
//     vocabulario y la misma validación por entrada;
//   · `on` sólo admite fases POST de HOOK_PHASES_ (engine/30-events):
//     afterCreate/afterUpdate/onStatusChange + los alias legacy
//     create/update/delete/reorder. `beforeCreate` se rechaza con mensaje
//     propio: una notificación pre-escritura se dispararía antes de saber
//     si la escritura ocurre (O4 no aplica);
//   · `channel` sólo 'email' HOY: es el único canal con cuota CONOCIDA
//     (MailApp, 100/día en el plano gratuito). `whatsapp`
//     (refactormotor.md:499) es TRABAJO FUTURO — sin integración declarada
//     ni cuota conocida en este proyecto: aceptarlo sería mentira de schema
//     (fail-closed);
//   · `template` string no vacío — texto plano con placeholders `{campo}`
//     que el motor resuelve contra el payload. §0.5 · SIN secretos: el
//     renderer sólo lee ctx.payload/ctx.summary, no existe mecanismo que
//     lea campos secretos;
//   · `to` string no vacío: email literal o placeholder `{campo}`
//     (el destinatario NO estaba en la spec: es una suma documentada);
//   · `subject` opcional — si existe, string no vacío (default derivado
//     por el motor: `resource.id · fase`);
//   · el par { on, to } es único dentro del recurso: el MISMO evento al
//     MISMO destinatario dos veces es declaración duplicada, no reintento
//     (el motor envía UNA vez, sin reintentos, y la cuota es finita).
function validateNotifications_(where, resource, issues) {
  var notify = resource.notify;
  if (notify === undefined || notify === null) return;
  if (!Array.isArray(notify)) {
    issues.push(where + '.notify: debe ser un arreglo de notificaciones');
    return;
  }
  var seen = {};
  notify.forEach(function (decl, index) {
    var at = where + '.notify[' + index + ']';
    if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
      issues.push(at + ': debe ser un objeto { on, channel, template, to, subject? }');
      return;
    }
    issues.push.apply(issues, unknownKeys_(at, decl, NOTIFY_DECL_KEYS_));

    if (typeof decl.on !== 'string' || decl.on.trim() === '') {
      issues.push(at + '.on: debe ser el nombre de una fase');
    } else if (!Object.prototype.hasOwnProperty.call(HOOK_PHASES_, decl.on)) {
      issues.push(at + ".on: fase desconocida '" + decl.on + "'");
    } else if (HOOK_PHASES_[decl.on] !== 'post') {
      issues.push(
        at +
          ".on: '" +
          decl.on +
          "' es una fase PRE (corre antes de escribir) — una notificación sólo puede reaccionar a fases post",
      );
    }

    if (typeof decl.channel !== 'string' || decl.channel.trim() === '') {
      issues.push(at + ".channel: debe ser 'email' (hoy único canal con cuota conocida)");
    } else if (NOTIFY_CHANNELS_.indexOf(decl.channel) === -1) {
      issues.push(
        at +
          ".channel: sólo 'email' es un canal con cuota conocida hoy (MailApp 100/día) — se recibió '" +
          decl.channel +
          "'",
      );
    }

    if (typeof decl.template !== 'string' || decl.template.trim() === '') {
      issues.push(at + '.template: debe ser un string no vacío (el texto del mensaje)');
    }

    if (typeof decl.to !== 'string' || decl.to.trim() === '') {
      issues.push(at + '.to: debe ser un string no vacío (email literal o placeholder {campo})');
    }

    if (
      decl.subject !== undefined &&
      (typeof decl.subject !== 'string' || decl.subject.trim() === '')
    ) {
      issues.push(at + '.subject: debe ser un string no vacío (o ausente)');
    }

    if (typeof decl.on === 'string' && typeof decl.to === 'string') {
      var pair = decl.on + ' → ' + decl.to;
      if (seen[pair] === true) {
        issues.push(
          at + ": el par on/to '" + pair + "' ya se envía en otra notificación del recurso",
        );
      } else {
        seen[pair] = true;
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

function validatePolicyAccess_(where, resource, fieldKeys, issues) {
  var policies = resource.policies;
  if (!policies || typeof policies !== 'object') return;
  var access = policies.access;
  if (access === undefined || access === null) return;
  var at = where + '.policies.access';
  if (typeof access !== 'object' || Array.isArray(access)) {
    issues.push(at + ': debe ser un objeto de políticas');
    return;
  }
  issues.push.apply(issues, unknownKeys_(at, access, ['read', 'write', 'operations', 'scope']));

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

  // C · R7.4c — scope por fila: entradas por nivel con la MISMA gramática
  // where de las vistas. Un scope roto silenciaría filas o las dejaría
  // pasar: rojo al arranque, como todo lo demás de access.
  var scope = access.scope;
  if (scope !== undefined && scope !== null) {
    var atScope = at + '.scope';
    if (resource.kind === 'singleton') {
      issues.push(atScope + ': scope no aplica a un singleton (no hay filas que filtrar)');
    } else if (typeof scope !== 'object' || Array.isArray(scope)) {
      issues.push(atScope + ': debe ser un mapa nivel ⇒ where');
    } else {
      var scopeLevels = Object.keys(scope);
      if (scopeLevels.length === 0) {
        // Sin entradas, TODO queda fuera de scope: o es un error, o es un
        // recurso apagado declarado como políticas — ningún caso sano.
        issues.push(atScope + ': scope vacío — declara al menos un nivel o quítalo');
      }
      scopeLevels.forEach(function (level) {
        var atLevel = atScope + '.' + level;
        if (ACCESS_LEVELS.indexOf(level) === -1) {
          issues.push(atLevel + ": nivel inválido '" + level + "'");
          return;
        }
        validateScopeWhere_(atLevel, scope[level], fieldKeys, issues);
      });
    }
  }

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
          ': operación desconocida (el motor habla list, get, create, update, remove, reorder, bulk, export, import)',
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
    // R9.5.4: `export` es una LECTURA (vuelca datos) y obedece el umbral de
    // read; `import` escribe y obedece el de write.
    var group = op === 'list' || op === 'get' || op === 'export' ? 'read' : 'write';
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

// R9.5.1 · auditoría configurable (B14). `policies.audit` era un booleano y
// sigue admitiéndolo; ahora además acepta un objeto que declara QUÉ auditar
// y CUÁNDO caduca:
//
//   audit: true                    → la traza de siempre (sin cambios)
//   audit: { fields: [...], retention: <días> }
//
//   · `fields`     → claves de campo del recurso que el summary del
//                    `_audit_log` agrega como `· campo=valor`.
//   · `retention`  → días de vida de las filas de ESE recurso en la traza.
//                    Se hace efectivo FUERA del request (O3): endpoint
//                    `POST /admin/audit-prune` y `npm run audit:prune`,
//                    jamás podando en cada escritura.
//
// Todo lo que esté mal acá tira el arranque (R1.5): un `fields` con un
// typo auditaría en silencio nada, y un `retention` con cero días vaciaría
// la traza en la primera poda — dos fallos silenciosos que este registro
// existe justamente para impedir.
function validatePolicyAudit_(where, resource, fieldKeys, issues) {
  var policies = resource.policies;
  if (!policies || typeof policies !== 'object') return;
  var audit = policies.audit;
  if (audit === undefined || audit === null) return;
  var at = where + '.policies.audit';
  if (typeof audit === 'boolean') return; // forma histórica: auditWrite_ ya la conoce
  if (typeof audit !== 'object' || Array.isArray(audit)) {
    issues.push(at + ': debe ser true, false o un objeto { fields, retention }');
    return;
  }
  issues.push.apply(issues, unknownKeys_(at, audit, ['fields', 'retention']));

  // `fields`: sólo claves TOP-LEVEL del schema y nunca `secret`. Anidadas no
  // sirven: el registro que lee el summary es plano (grupo ⇒ objeto) y
  // secret jamás se copia fuera del recurso que lo guarda.
  var topKeys = {};
  var topSecrets = {};
  (resource.fields || []).forEach(function (field) {
    if (!field || typeof field.key !== 'string') return;
    topKeys[field.key] = true;
    if (field.type === 'secret') topSecrets[field.key] = true;
  });
  if (audit.fields !== undefined && audit.fields !== null) {
    if (!Array.isArray(audit.fields)) {
      issues.push(at + '.fields: debe ser un arreglo de claves de campo');
    } else {
      audit.fields.forEach(function (key, index) {
        var atField = at + '.fields[' + index + ']';
        if (typeof key !== 'string' || key === '') {
          issues.push(atField + ': cada entrada debe ser una clave de campo no vacía');
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(fieldKeys, key)) {
          issues.push(atField + ": campo inexistente '" + key + "'");
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(topKeys, key)) {
          issues.push(
            atField +
              ": '" +
              key +
              "' no es un campo top-level (los anidados no están en el registro plano de la traza)",
          );
          return;
        }
        if (Object.prototype.hasOwnProperty.call(topSecrets, key)) {
          issues.push(atField + ": '" + key + "' es secret — no se audita (sólo presencia)");
        }
      });
    }
  }

  if (audit.retention !== undefined && audit.retention !== null) {
    var retention = audit.retention;
    if (
      typeof retention !== 'number' ||
      !isFinite(retention) ||
      Math.floor(retention) !== retention
    ) {
      issues.push(at + '.retention: debe ser un entero de días');
    } else if (retention < 1) {
      issues.push(at + '.retention: mínimo 1 día — 0 vaciaría la traza en la primera poda');
    }
  }
}

// Where de scope: la MISMA gramática que las vistas (plano, `or`, `all`,
// con anidamiento libre), acotada a lo que el intérprete conoce — campo del
// recurso y op registrada. Los operandos no se replican acá: evalWhere_ ya
// es fail-closed en runtime; esto caza la rotura obvia en el arranque.
function validateScopeWhere_(where, node, fieldKeys, issues) {
  // Lista plana (el caso): arreglo de nodos, y cada nodo puede ser una
  // condición plana o un grupo con UNA sola de or/all.
  if (Array.isArray(node)) {
    node.forEach(function (cond, i) {
      validateScopeNode_(where + '[' + i + ']', cond, fieldKeys, issues);
    });
    return;
  }
  if (node === null || typeof node !== 'object') {
    issues.push(where + ': debe ser un arreglo de condiciones (where de vista)');
    return;
  }
  // Un objeto en la raíz sólo puede ser un grupo ({ or: [...] } sin envoltorio).
  var rootGroup = Object.prototype.hasOwnProperty.call(node, 'or')
    ? 'or'
    : Object.prototype.hasOwnProperty.call(node, 'all')
      ? 'all'
      : null;
  if (rootGroup === null || Object.keys(node).length !== 1) {
    issues.push(where + ": la raíz debe ser un arreglo o UN grupo ('or' | 'all')");
    return;
  }
  if (!Array.isArray(node[rootGroup])) {
    issues.push(where + '.' + rootGroup + ': debe ser una lista de nodos');
    return;
  }
  node[rootGroup].forEach(function (kid, i) {
    validateScopeNode_(where + '.' + rootGroup + '[' + i + ']', kid, fieldKeys, issues);
  });
}

function validateScopeNode_(where, cond, fieldKeys, issues) {
  if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) {
    issues.push(where + ': no es un nodo de where');
    return;
  }
  var hasOr = Object.prototype.hasOwnProperty.call(cond, 'or');
  var hasAll = Object.prototype.hasOwnProperty.call(cond, 'all');
  if (hasOr || hasAll) {
    if (hasOr && hasAll) {
      issues.push(where + ": 'or' y 'all' no pueden coexistir");
      return;
    }
    var groupKey = hasOr ? 'or' : 'all';
    var kids = cond[groupKey];
    if (!Array.isArray(kids)) {
      issues.push(where + '.' + groupKey + ': debe ser una lista de nodos');
      return;
    }
    kids.forEach(function (kid, j) {
      validateScopeNode_(where + '.' + groupKey + '[' + j + ']', kid, fieldKeys, issues);
    });
    return;
  }
  if (typeof cond.field !== 'string' || cond.field === '') {
    issues.push(where + '.field: debe ser el nombre de un campo');
    return;
  }
  if (!fieldKeys[cond.field]) {
    issues.push(where + ": campo inexistente '" + cond.field + "'");
    return;
  }
  if (typeof cond.op !== 'string' || !Object.prototype.hasOwnProperty.call(REGISTRY.ops, cond.op)) {
    issues.push(where + ": op desconocida '" + String(cond.op) + "'");
  }
}

function validateHasMany_(where, id, resource, issues) {
  if (resource.hasMany === undefined || resource.hasMany === null) return;
  if (typeof resource.hasMany !== 'object' || Array.isArray(resource.hasMany)) {
    issues.push(where + '.hasMany: debe ser un objeto');
    return;
  }

  var declaredInverseFields = {};
  Object.keys(resource.hasMany).forEach(function (name) {
    var at = where + '.hasMany.' + name;
    var declaration = resource.hasMany[name];
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
      issues.push(at + ': alias debe ser un identificador válido');
    }
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
      issues.push(at + ': debe ser un objeto');
      return;
    }
    issues.push.apply(issues, unknownKeys_(at, declaration, ['resource', 'field', 'limit']));
    if (typeof declaration.resource !== 'string' || declaration.resource === '') {
      issues.push(at + '.resource: debe identificar el recurso hijo');
      return;
    }
    var child = REGISTRY.resources[declaration.resource];
    if (!child) {
      issues.push(at + ": recurso inexistente '" + declaration.resource + "'");
      return;
    }
    var field = declaredField_(child.fields, declaration.field);
    var inverseKey = declaration.resource + '.' + declaration.field;
    if (declaredInverseFields[inverseKey]) {
      issues.push(at + ': relación inversa ya declarada como ' + declaredInverseFields[inverseKey]);
    } else {
      declaredInverseFields[inverseKey] = name;
    }
    if (!field || field.type !== 'relation' || !field.source || field.source.resource !== id) {
      issues.push(
        at +
          ".field: debe ser una relación del recurso '" +
          declaration.resource +
          "' que apunte a '" +
          id +
          "'",
      );
    } else {
      var parentField = field.source.valueField || resource.keyField;
      if (fieldTypeOf_(resource, parentField) === undefined) {
        issues.push(at + ": la relación usa un campo padre inexistente '" + parentField + "'");
      }
    }
    if (
      typeof declaration.limit !== 'number' ||
      !isFinite(declaration.limit) ||
      declaration.limit < 1 ||
      declaration.limit > MAX_HAS_MANY_EXPANSION_ ||
      Math.floor(declaration.limit) !== declaration.limit
    ) {
      issues.push(at + '.limit: debe ser un entero entre 1 y ' + MAX_HAS_MANY_EXPANSION_);
    }
  });
}

function relationFieldsTo_(resourceId) {
  var result = [];
  Object.keys(REGISTRY.resources).forEach(function (childId) {
    var child = REGISTRY.resources[childId];
    var walk = function (fields) {
      (fields || []).forEach(function (field) {
        if (
          field &&
          field.type === 'relation' &&
          field.source &&
          field.source.resource === resourceId
        ) {
          result.push({ resource: childId, field: field });
        }
        if (field && typeof field === 'object') {
          walk(field.fields);
          walk(field.itemFields);
          walk(field.extraColumns);
        }
      });
    };
    walk(child && child.fields);
  });
  return result;
}

function validateDeletePolicies_(issues) {
  var cascadeGraph = {};
  Object.keys(REGISTRY.resources).forEach(function (id) {
    var resource = REGISTRY.resources[id];
    var relations = relationFieldsTo_(id);
    if (relations.length > 0 && resource.onDelete === undefined) {
      issues.push('resources.' + id + ': declara onDelete porque otros recursos lo referencian');
    }
    if (
      relations.length > 0 &&
      (resource.onDelete === 'none' || resource.onDelete === 'cascade-children')
    ) {
      issues.push(
        'resources.' +
          id +
          ": onDelete '" +
          resource.onDelete +
          "' no resuelve relaciones entrantes; usa restrict, cascade o nullify",
      );
    }
    var children = {};
    relations.forEach(function (relation) {
      children[relation.resource] = true;
      if (resource.onDelete === 'nullify' && relation.field.required === true) {
        issues.push(
          'resources.' +
            id +
            ".onDelete 'nullify' no puede limpiar la relación required '" +
            relation.resource +
            '.' +
            relation.field.key +
            "'",
        );
      }
    });
    if (resource.onDelete === 'cascade') cascadeGraph[id] = Object.keys(children);
    (resource.dependents || []).forEach(function (dependent) {
      if (!children[dependent]) {
        issues.push(
          'resources.' +
            id +
            ".dependents incluye '" +
            dependent +
            "', pero no tiene una relación hacia este recurso",
        );
      }
    });
  });

  var visiting = {};
  var visited = {};
  var visit = function (id, path) {
    if (visiting[id]) {
      issues.push(
        'resources.' +
          id +
          ': ciclo de políticas onDelete cascade (' +
          path.concat(id).join(' → ') +
          ')',
      );
      return;
    }
    if (visited[id]) return;
    visiting[id] = true;
    (cascadeGraph[id] || []).forEach(function (childId) {
      if (cascadeGraph[childId]) visit(childId, path.concat(id));
    });
    delete visiting[id];
    visited[id] = true;
  };
  Object.keys(cascadeGraph).forEach(function (id) {
    visit(id, []);
  });
}

function validateViewExpands_(where, resource, issues) {
  Object.keys(resource.views || {}).forEach(function (name) {
    var view = resource.views[name];
    if (!view || typeof view !== 'object' || view.expand === undefined) return;
    var at = where + '.views.' + name + '.expand';
    if (!Array.isArray(view.expand) || view.expand.length === 0) {
      issues.push(at + ': debe ser una lista no vacía');
      return;
    }
    view.expand.forEach(function (key) {
      if (typeof key !== 'string') {
        issues.push(at + ': cada entrada debe ser texto');
        return;
      }
      var field = declaredField_(resource.fields, key);
      var inverse = resource.hasMany && Object.prototype.hasOwnProperty.call(resource.hasMany, key);
      if ((!field || field.type !== 'relation') && !inverse) {
        issues.push(at + ": campo o hasMany inexistente '" + key + "'");
        return;
      }
      if (inverse) {
        var declaration = resource.hasMany[key];
        var child = REGISTRY.resources[declaration.resource];
        var relation = child && declaredField_(child.fields, declaration.field);
        var parentField =
          relation && relation.source ? relation.source.valueField || resource.keyField : null;
        var listShape =
          resource.operations && resource.operations.list ? resource.operations.list.shape : null;
        var selected = null;
        if (listShape && Array.isArray(listShape.pick)) {
          selected = listShape.pick.concat(listShape.include || []);
        } else if (listShape && listShape.pick === 'list') {
          selected = resource.listProjection || [];
        } else if (!listShape && Array.isArray(resource.listProjection)) {
          selected = resource.listProjection;
        }
        if (parentField && selected && selected.indexOf(parentField) === -1) {
          issues.push(
            at + ": hasMany '" + key + "' requiere incluir '" + parentField + "' en el listado",
          );
        }
      }
    });
  });
}

function validateResource_(id, resource, issues) {
  var where = 'resources.' + id;

  // 1. claves de recurso
  issues.push.apply(issues, unknownKeys_(where, resource, KNOWN_RESOURCE_KEYS));
  if (resource.onDelete !== undefined && DELETE_POLICIES.indexOf(resource.onDelete) === -1) {
    issues.push(where + ".onDelete: política desconocida '" + String(resource.onDelete) + "'");
  }

  if (resource.commandsRoute !== undefined) {
    if (
      typeof resource.commandsRoute !== 'string' ||
      !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(resource.commandsRoute)
    ) {
      issues.push(where + '.commandsRoute: debe ser una ruta base absoluta sin parámetros');
    }
    if (resource.commands === undefined) {
      issues.push(where + '.commandsRoute: sólo aplica a recursos con commands');
    }
  }

  if (KNOWN_RESOURCE_KINDS.indexOf(resource.kind) === -1) {
    issues.push(where + ": kind inválido '" + resource.kind + "'");
  }

  if (resource.policies && typeof resource.policies === 'object') {
    issues.push.apply(
      issues,
      unknownKeys_(where + '.policies', resource.policies, KNOWN_POLICY_KEYS),
    );
  }
  var fieldKeys = fieldKeySet_(resource);
  validatePolicyAccess_(where, resource, fieldKeys, issues);
  validatePolicyAudit_(where, resource, fieldKeys, issues);

  validateOperations_(where, resource, issues);
  validateAudiences_(id, where, resource, fieldKeys, issues);
  validateActions_(where, resource, issues);
  validateCommands_(where, id, resource, issues);
  validateTransitions_(where, resource, issues);
  validateSchedules_(where, resource, issues);
  validateWebhooks_(where, resource, issues);
  validateNotifications_(where, resource, issues);

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
        var secretKeys = secretFieldKeys_(resource.fields);
        resource.listProjection.forEach(function (key) {
          if (!fieldKeys[key]) {
            issues.push(where + ": listProjection apunta a '" + key + "', que no es un campo");
          } else if (secretKeys[key]) {
            // R7.6: un campo `secret` jamás se proyecta — nombrarlo acá es
            // una promesa imposible (ni /admin/schema lo publica).
            issues.push(
              where +
                ": listProjection incluye '" +
                key +
                "', que es un campo secret (nunca se proyecta)",
            );
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
  validateHasMany_(where, id, resource, issues);
  validateViewExpands_(where, resource, issues);

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
  if (endpoint.errors !== undefined) {
    if (!Array.isArray(endpoint.errors)) {
      issues.push(where + '.errors: debe ser un arreglo de { status, code?, description }');
    } else {
      var errorStatuses = {};
      endpoint.errors.forEach(function (decl, index) {
        var errorWhere = where + '.errors[' + index + ']';
        if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
          issues.push(errorWhere + ': debe ser un objeto { status, code?, description }');
          return;
        }
        issues.push.apply(
          issues,
          unknownKeys_(errorWhere, decl, ['status', 'code', 'description']),
        );
        if (
          typeof decl.status !== 'number' ||
          !isFinite(decl.status) ||
          Math.floor(decl.status) !== decl.status ||
          decl.status < 400 ||
          decl.status > 599
        ) {
          issues.push(errorWhere + '.status: debe ser un entero entre 400 y 599');
        } else if (errorStatuses[decl.status]) {
          issues.push(errorWhere + '.status: no debe repetirse');
        } else {
          errorStatuses[decl.status] = true;
        }

        if (typeof decl.description !== 'string' || decl.description.trim() === '') {
          issues.push(errorWhere + '.description: debe ser texto no vacío');
        }
        if (
          decl.code !== undefined &&
          (typeof decl.code !== 'string' || !/^[A-Z][A-Z0-9_]+$/.test(decl.code))
        ) {
          issues.push(errorWhere + '.code: debe ser un código estable en MAYÚSCULAS');
        }
      });
    }
  }
  if (endpoint.issuesGrant !== undefined && typeof endpoint.issuesGrant !== 'string') {
    issues.push(where + '.issuesGrant: debe ser el id de un perfil de grant');
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

// F1 · Contrato mínimo de comandos, grants y cargas. Las referencias de
// valores son intencionalmente cerradas: no hay paths dinámicos ni eval.
var COMMAND_NAME_RE = /^[A-Za-z0-9_-]+$/;
var COMMAND_INPUT_KEYS = [
  'type',
  'required',
  'enum',
  'format',
  'pattern',
  'min',
  'max',
  'minLength',
  'maxLength',
  'profile',
];
var COMMAND_DECL_KEYS = [
  'input',
  'output',
  'access',
  'grant',
  'limits',
  'preconditions',
  'changes',
  'events',
  'errors',
  'idempotency',
  'handler',
];
var COMMAND_EVENT_KEYS = ['appendTo', 'values', 'operationIdField', 'when'];
var COMMAND_REFERENCE_KEYS = ['from', 'value', 'generated'];
var GRANT_PROFILE_KEYS = [
  'purpose',
  'issuedBy',
  'resource',
  'command',
  'keyParam',
  'ttlSeconds',
  'maxUses',
  'consume',
];
var UPLOAD_PROFILE_KEYS = [
  'provider',
  'resource',
  'grant',
  'mimeTypes',
  'maxBytes',
  'ttlSeconds',
  'namespace',
];
var SAFE_PROFILE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
var DOMAIN_GENERATORS = ['now', 'key', 'actor'];

function commandFieldMap_(fields, where, issues, allowUpload) {
  var result = {};
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    issues.push(where + ': debe ser un objeto plano de campos');
    return result;
  }
  Object.keys(fields).forEach(function (key) {
    var at = where + '.' + key;
    var decl = fields[key];
    if (!COMMAND_NAME_RE.test(key)) {
      issues.push(at + ': nombre de campo inválido');
    }
    if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
      issues.push(at + ': debe ser un objeto { type, required? }');
      return;
    }
    issues.push.apply(issues, unknownKeys_(at, decl, COMMAND_INPUT_KEYS));
    if (typeof decl.type !== 'string') {
      issues.push(at + '.type: debe ser un tipo de campo');
    } else if (
      !(allowUpload && decl.type === 'upload') &&
      !Object.prototype.hasOwnProperty.call(REGISTRY.capabilities.fieldTypes, decl.type)
    ) {
      issues.push(at + ": tipo de campo inexistente '" + decl.type + "'");
    }
    if (decl.type === 'upload') {
      if (!allowUpload) {
        issues.push(at + ": type 'upload' sólo se admite en input");
      }
      if (
        typeof decl.profile !== 'string' ||
        !Object.prototype.hasOwnProperty.call(REGISTRY.uploadProfiles, decl.profile)
      ) {
        issues.push(at + ": perfil de carga inexistente '" + String(decl.profile) + "'");
      }
    } else if (decl.profile !== undefined) {
      issues.push(at + '.profile: sólo aplica a type upload');
    }
    if (!allowUpload && decl.type === 'secret') {
      issues.push(at + ": type 'secret' sólo se admite en input");
    }
    if (decl.required !== undefined && typeof decl.required !== 'boolean') {
      issues.push(at + '.required: debe ser boolean');
    }
    ['min', 'max', 'minLength', 'maxLength'].forEach(function (bound) {
      if (
        decl[bound] !== undefined &&
        (typeof decl[bound] !== 'number' || !isFinite(decl[bound]) || decl[bound] < 0)
      ) {
        issues.push(at + '.' + bound + ': debe ser un número >= 0');
      }
    });
    if (typeof decl.min === 'number' && typeof decl.max === 'number' && decl.min > decl.max) {
      issues.push(at + ': min no puede ser mayor que max');
    }
    if (
      typeof decl.minLength === 'number' &&
      typeof decl.maxLength === 'number' &&
      decl.minLength > decl.maxLength
    ) {
      issues.push(at + ': minLength no puede ser mayor que maxLength');
    }
    if (
      decl.enum !== undefined &&
      (!Array.isArray(decl.enum) ||
        decl.enum.length === 0 ||
        decl.enum.some(function (value) {
          return value !== null && typeof value === 'object';
        }))
    ) {
      issues.push(at + '.enum: debe ser un array no vacío de valores escalares');
    }
    if (decl.enum !== undefined && decl.type !== 'select' && decl.type !== 'multiselect') {
      issues.push(at + '.enum: sólo aplica a select o multiselect');
    }
    if (
      (decl.min !== undefined || decl.max !== undefined) &&
      decl.type !== 'number' &&
      decl.type !== 'currency' &&
      decl.type !== 'date'
    ) {
      issues.push(at + ': min/max sólo aplican a number, currency o date');
    }
    if (
      (decl.minLength !== undefined || decl.maxLength !== undefined) &&
      ['text', 'textarea', 'slug', 'email', 'phone', 'url', 'readonly-text'].indexOf(decl.type) ===
        -1
    ) {
      issues.push(at + ': minLength/maxLength requieren un tipo de texto');
    }
    ['format', 'pattern'].forEach(function (key) {
      if (decl[key] !== undefined && typeof decl[key] !== 'string') {
        issues.push(at + '.' + key + ': debe ser texto');
      }
    });
    result[key] = decl;
  });
  return result;
}

function declaredField_(fields, key) {
  var found = null;
  (fields || []).some(function (field) {
    if (!field || typeof field !== 'object') return false;
    if (field.key === key) {
      found = field;
      return true;
    }
    found =
      declaredField_(field.fields, key) ||
      declaredField_(field.itemFields, key) ||
      declaredField_(field.extraColumns, key);
    return found !== null;
  });
  return found;
}

function scalarValue_(value) {
  return value === null || ['string', 'number', 'boolean'].indexOf(typeof value) !== -1;
}

function validateCommandReference_(where, ref, input, target, issues) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
    issues.push(where + ': debe ser una referencia declarada');
    return;
  }
  var keys = Object.keys(ref);
  issues.push.apply(issues, unknownKeys_(where, ref, COMMAND_REFERENCE_KEYS));
  if (keys.length !== 1) {
    issues.push(where + ': debe declarar exactamente una de from, value o generated');
    return;
  }
  if (
    target &&
    (target.system === true || target.computed !== undefined) &&
    (typeof target.computed !== 'string' || ref.generated !== target.computed)
  ) {
    issues.push(where + ': campo generado sólo admite su generador declarado');
    return;
  }
  if (ref.from !== undefined) {
    var match = typeof ref.from === 'string' && /^input\.([A-Za-z0-9_-]+)$/.exec(ref.from);
    if (!match || !Object.prototype.hasOwnProperty.call(input, match[1])) {
      issues.push(where + ": referencia input inválida '" + String(ref.from) + "'");
      return;
    }
    var inputType = input[match[1]].type;
    var targetType = target && target.type;
    if (
      inputType === 'upload'
        ? targetType !== 'image'
        : inputType === 'secret' || (targetType !== undefined && inputType !== targetType)
    ) {
      issues.push(where + ': tipo de input incompatible con el campo destino');
    }
    if (target && target.required === true && input[match[1]].required !== true) {
      issues.push(where + ': el input debe ser required para escribir un campo requerido');
    }
    if (
      Array.isArray(input[match[1]].enum) &&
      target &&
      Array.isArray(target.enum) &&
      input[match[1]].enum.some(function (value) {
        return target.enum.indexOf(value) === -1;
      })
    ) {
      issues.push(where + ': el enum del input excede el enum del campo destino');
    }
  } else if (ref.value !== undefined) {
    if (!scalarValue_(ref.value)) {
      issues.push(where + '.value: debe ser un valor escalar');
    } else if (target && Array.isArray(target.enum) && target.enum.indexOf(ref.value) === -1) {
      issues.push(where + '.value: no pertenece al enum del campo destino');
    }
  } else if (ref.generated !== undefined) {
    if (DOMAIN_GENERATORS.indexOf(ref.generated) === -1) {
      issues.push(where + ": generador inexistente '" + String(ref.generated) + "'");
    } else if (target && ref.generated === 'now' && target.type !== 'readonly-text') {
      issues.push(where + ".generated 'now' exige un campo readonly-text");
    } else if (target && ref.generated === 'key' && target.type !== 'text') {
      issues.push(where + ".generated 'key' exige un campo text");
    }
  }
}

function validateCommand_(where, resourceId, resource, name, decl, issues) {
  var at = where + '.commands.' + name;
  if (!COMMAND_NAME_RE.test(name)) {
    issues.push(at + ": nombre inválido '" + name + "'");
    return;
  }
  if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
    issues.push(at + ': debe ser un objeto');
    return;
  }
  issues.push.apply(issues, unknownKeys_(at, decl, COMMAND_DECL_KEYS));
  var input = commandFieldMap_(decl.input, at + '.input', issues, true);
  var output = commandFieldMap_(decl.output, at + '.output', issues, false);
  if (typeof decl.access !== 'string' || ACCESS_LEVELS.indexOf(decl.access) === -1) {
    issues.push(at + ": access inválido '" + String(decl.access) + "'");
  }
  if (decl.access === 'public' && typeof decl.grant !== 'string') {
    issues.push(at + ': un comando public requiere un grant');
  }
  if (decl.grant !== undefined) {
    var grant = REGISTRY.grantProfiles[decl.grant];
    if (!Object.prototype.hasOwnProperty.call(REGISTRY.grantProfiles, decl.grant)) {
      issues.push(at + ": perfil de grant inexistente '" + String(decl.grant) + "'");
    } else if (
      !grant ||
      typeof grant !== 'object' ||
      grant.resource !== resourceId ||
      grant.command !== name
    ) {
      issues.push(at + '.grant: el perfil no está vinculado a este recurso y comando');
    }
  }
  Object.keys(input).forEach(function (key) {
    var field = input[key];
    if (field.type !== 'upload') return;
    var profile = REGISTRY.uploadProfiles[field.profile];
    if (
      profile &&
      typeof profile === 'object' &&
      (profile.resource !== resourceId || profile.grant !== decl.grant)
    ) {
      issues.push(at + '.input.' + key + ': el perfil de carga debe compartir resource y grant');
    }
  });
  if (
    decl.limits !== undefined &&
    (typeof decl.limits !== 'string' || !/^[1-9]\d*\/(min|hour|day)$/.test(decl.limits))
  ) {
    issues.push(at + '.limits: formato inválido (ej. 5/min)');
  }
  if (
    decl.idempotency !== 'required' &&
    decl.idempotency !== 'optional' &&
    decl.idempotency !== 'none'
  ) {
    issues.push(at + ".idempotency: debe ser 'required', 'optional' o 'none'");
  }
  if (decl.handler !== undefined) {
    if (
      typeof decl.handler !== 'string' ||
      !Object.prototype.hasOwnProperty.call(REGISTRY.capabilities.handlers, decl.handler)
    ) {
      issues.push(at + ": handler inexistente '" + String(decl.handler) + "'");
    }
    if (
      decl.changes !== undefined ||
      decl.events !== undefined ||
      decl.preconditions !== undefined
    ) {
      issues.push(at + ': handler custom no se combina con cambios, eventos ni precondiciones DSL');
    }
  } else if (decl.changes === undefined && decl.events === undefined) {
    issues.push(at + ': necesita changes, events o un handler custom');
  }

  if (decl.preconditions !== undefined) {
    if (!Array.isArray(decl.preconditions)) {
      issues.push(at + '.preconditions: debe ser un array de { field, op, value }');
    } else {
      decl.preconditions.forEach(function (condition, index) {
        var conditionAt = at + '.preconditions[' + index + ']';
        if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
          issues.push(conditionAt + ': debe ser un objeto');
          return;
        }
        issues.push.apply(issues, unknownKeys_(conditionAt, condition, ['field', 'op', 'value']));
        if (!declaredField_(resource.fields, condition.field)) {
          issues.push(conditionAt + ": campo inexistente '" + String(condition.field) + "'");
        }
        if (
          typeof condition.op !== 'string' ||
          !Object.prototype.hasOwnProperty.call(REGISTRY.ops, condition.op)
        ) {
          issues.push(conditionAt + ": op inexistente '" + String(condition.op) + "'");
        }
        if (!scalarValue_(condition.value) && !Array.isArray(condition.value)) {
          issues.push(conditionAt + '.value: debe ser escalar o array');
        }
        if (
          Array.isArray(condition.value) &&
          condition.value.some(function (value) {
            return !scalarValue_(value);
          })
        ) {
          issues.push(conditionAt + '.value: los elementos deben ser escalares');
        }
        var conditionField = declaredField_(resource.fields, condition.field);
        if (
          conditionField &&
          Array.isArray(conditionField.enum) &&
          (Array.isArray(condition.value) ? condition.value : [condition.value]).some(
            function (value) {
              return conditionField.enum.indexOf(value) === -1;
            },
          )
        ) {
          issues.push(conditionAt + '.value: contiene un valor fuera del enum del campo');
        }
      });
    }
  }

  if (decl.changes !== undefined) {
    if (!decl.changes || typeof decl.changes !== 'object' || Array.isArray(decl.changes)) {
      issues.push(at + '.changes: debe ser un objeto campo → referencia');
    } else {
      Object.keys(decl.changes).forEach(function (key) {
        var target = declaredField_(resource.fields, key);
        var changeAt = at + '.changes.' + key;
        if (!target) {
          issues.push(changeAt + ': campo inexistente');
          return;
        }
        if ((FIELD_TYPES[target.type] || {}).storage !== 'column') {
          issues.push(changeAt + ': changes sólo admite campos escalares almacenados en la fila');
          return;
        }
        if (key === resource.keyField || target.type === 'secret' || target.immutable === true) {
          issues.push(changeAt + ': el campo no admite cambios de comando');
          return;
        }
        validateCommandReference_(changeAt, decl.changes[key], input, target, issues);
      });
      if (Object.keys(decl.changes).length === 0) {
        issues.push(at + '.changes: no puede estar vacío');
      }
    }
  }

  if (decl.events !== undefined) {
    if (!Array.isArray(decl.events)) {
      issues.push(at + '.events: debe ser un array de eventos');
    } else if (decl.events.length === 0) {
      issues.push(at + '.events: no puede estar vacío');
    } else {
      decl.events.forEach(function (event, index) {
        var eventAt = at + '.events[' + index + ']';
        if (!event || typeof event !== 'object' || Array.isArray(event)) {
          issues.push(eventAt + ': debe ser un objeto');
          return;
        }
        issues.push.apply(issues, unknownKeys_(eventAt, event, COMMAND_EVENT_KEYS));
        var list = (resource.fields || []).find(function (field) {
          return field.key === event.appendTo && field.type === 'list';
        });
        if (!list) {
          issues.push(eventAt + ": appendTo debe referir a un campo list de '" + resourceId + "'");
          return;
        }
        if (event.operationIdField !== undefined) {
          var operationIdField = (list.itemFields || []).find(function (field) {
            return field.key === event.operationIdField;
          });
          if (
            !operationIdField ||
            operationIdField.system !== true ||
            operationIdField.type !== 'readonly-text' ||
            operationIdField.computed !== undefined
          ) {
            issues.push(
              eventAt +
                '.operationIdField: debe referir a un campo readonly-text system sin computed',
            );
          }
        }
        if (
          (decl.grant !== undefined || decl.idempotency !== 'none') &&
          event.operationIdField === undefined
        ) {
          issues.push(eventAt + '.operationIdField: es obligatorio para comandos recuperables');
        }
        if (event.when !== undefined) {
          if (!event.when || typeof event.when !== 'object' || Array.isArray(event.when)) {
            issues.push(eventAt + '.when: debe ser una condición declarativa');
          } else {
            issues.push.apply(
              issues,
              unknownKeys_(eventAt + '.when', event.when, ['field', 'op', 'value']),
            );
            if (!declaredField_(resource.fields, event.when.field)) {
              issues.push(eventAt + '.when: campo inexistente');
            }
            if (
              typeof event.when.op !== 'string' ||
              !Object.prototype.hasOwnProperty.call(REGISTRY.ops, event.when.op)
            ) {
              issues.push(eventAt + '.when: operador inexistente');
            }
            if (!scalarValue_(event.when.value) && !Array.isArray(event.when.value)) {
              issues.push(eventAt + '.when.value: debe ser escalar o array');
            }
            var whenField = declaredField_(resource.fields, event.when.field);
            if (
              whenField &&
              Array.isArray(whenField.enum) &&
              (Array.isArray(event.when.value) ? event.when.value : [event.when.value]).some(
                function (value) {
                  return whenField.enum.indexOf(value) === -1;
                },
              )
            ) {
              issues.push(eventAt + '.when.value: contiene un valor fuera del enum del campo');
            }
          }
        }
        if (!event.values || typeof event.values !== 'object' || Array.isArray(event.values)) {
          issues.push(eventAt + '.values: debe ser un objeto de campos del item');
          return;
        }
        Object.keys(event.values).forEach(function (key) {
          var target = (list.itemFields || []).find(function (field) {
            return field.key === key;
          });
          if (!target) {
            issues.push(eventAt + '.values.' + key + ': campo inexistente en itemFields');
            return;
          }
          if (target.system === true || target.computed !== undefined) {
            issues.push(eventAt + '.values.' + key + ': el campo se genera automáticamente');
            return;
          }
          validateCommandReference_(
            eventAt + '.values.' + key,
            event.values[key],
            input,
            target,
            issues,
          );
        });
        (list.itemFields || []).forEach(function (field) {
          if (
            field.required === true &&
            field.system !== true &&
            !Object.prototype.hasOwnProperty.call(event.values, field.key)
          ) {
            issues.push(eventAt + '.values: falta el campo requerido ' + field.key);
          }
        });
        if (Object.keys(event.values || {}).length === 0) {
          issues.push(eventAt + '.values: no puede estar vacío');
        }
      });
    }
  }

  if (decl.errors !== undefined) {
    if (!Array.isArray(decl.errors)) {
      issues.push(at + '.errors: debe ser un array de { status, code, message }');
    } else {
      var codes = {};
      decl.errors.forEach(function (error, index) {
        var errorAt = at + '.errors[' + index + ']';
        if (!error || typeof error !== 'object' || Array.isArray(error)) {
          issues.push(errorAt + ': debe ser un objeto');
          return;
        }
        issues.push.apply(issues, unknownKeys_(errorAt, error, ['status', 'code', 'message']));
        if (
          typeof error.status !== 'number' ||
          Math.floor(error.status) !== error.status ||
          error.status < 400 ||
          error.status > 599
        ) {
          issues.push(errorAt + '.status: debe ser un entero entre 400 y 599');
        }
        if (typeof error.code !== 'string' || !/^[A-Z][A-Z0-9_]+$/.test(error.code)) {
          issues.push(errorAt + '.code: debe ser un código estable en MAYÚSCULAS');
        } else if (codes[error.code]) {
          issues.push(errorAt + '.code: no debe repetirse');
        } else {
          codes[error.code] = true;
        }
        if (typeof error.message !== 'string' || error.message.trim() === '') {
          issues.push(errorAt + '.message: debe ser texto no vacío');
        }
      });
    }
  }

  Object.keys(output).forEach(function (key) {
    if (output[key].type === 'upload') {
      issues.push(at + '.output.' + key + ": type 'upload' no se admite en output");
    }
  });
}

function validateCommands_(where, resourceId, resource, issues) {
  if (resource.commands === undefined || resource.commands === null) return;
  if (typeof resource.commands !== 'object' || Array.isArray(resource.commands)) {
    issues.push(where + '.commands: debe ser un objeto de comandos');
    return;
  }
  Object.keys(resource.commands).forEach(function (name) {
    validateCommand_(where, resourceId, resource, name, resource.commands[name], issues);
  });
}

function validateGrantProfiles_(issues) {
  Object.keys(REGISTRY.grantProfiles).forEach(function (id) {
    var at = 'grantProfiles.' + id;
    var grant = REGISTRY.grantProfiles[id];
    if (!SAFE_PROFILE_ID_RE.test(id)) issues.push(at + ': id inválido');
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)) {
      issues.push(at + ': debe ser un objeto');
      return;
    }
    issues.push.apply(issues, unknownKeys_(at, grant, GRANT_PROFILE_KEYS));
    if (typeof grant.purpose !== 'string' || grant.purpose.trim() === '') {
      issues.push(at + '.purpose: debe ser texto no vacío');
    }
    var endpoint = REGISTRY.endpoints[grant.issuedBy];
    if (
      typeof grant.issuedBy !== 'string' ||
      !Object.prototype.hasOwnProperty.call(REGISTRY.endpoints, grant.issuedBy)
    ) {
      issues.push(at + ": endpoint emisor inexistente '" + String(grant.issuedBy) + "'");
    } else if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) {
      issues.push(at + ": endpoint emisor inválido '" + String(grant.issuedBy) + "'");
    } else {
      if (endpoint.method !== 'POST') {
        issues.push(at + '.issuedBy: endpoint emisor debe usar POST');
      }
      if (
        typeof endpoint.limits !== 'string' ||
        !/^[1-9]\d*\/(min|hour|day)$/.test(endpoint.limits)
      ) {
        issues.push(at + '.issuedBy: endpoint emisor debe declarar límites válidos');
      }
      if (endpoint.issuesGrant !== id) {
        issues.push(at + ": el endpoint emisor debe declarar issuesGrant: '" + id + "'");
      }
      if (endpoint.resource !== grant.resource) {
        issues.push(at + '.resource: debe coincidir con el resource del endpoint emisor');
      }
      if (
        typeof grant.keyParam !== 'string' ||
        typeof endpoint.route !== 'string' ||
        endpoint.route.split('/').indexOf(':' + grant.keyParam) === -1
      ) {
        issues.push(at + '.keyParam: debe ser un parámetro de la ruta del endpoint emisor');
      }
      var routeInput =
        endpoint.input && endpoint.input.params && endpoint.input.params[grant.keyParam];
      if (!routeInput || routeInput.required !== true) {
        issues.push(at + '.keyParam: debe declararse como parámetro requerido en endpoint.input');
      }
    }
    var resource = REGISTRY.resources[grant.resource];
    if (
      typeof grant.resource !== 'string' ||
      !Object.prototype.hasOwnProperty.call(REGISTRY.resources, grant.resource)
    ) {
      issues.push(at + ": resource inexistente '" + String(grant.resource) + "'");
    } else if (
      !resource ||
      typeof resource !== 'object' ||
      !resource.commands ||
      !Object.prototype.hasOwnProperty.call(resource.commands, grant.command)
    ) {
      issues.push(at + ": command inexistente '" + String(grant.command) + "'");
    } else if (
      !resource.commands[grant.command] ||
      typeof resource.commands[grant.command] !== 'object' ||
      resource.commands[grant.command].grant !== id
    ) {
      issues.push(at + ": el comando debe declarar grant: '" + id + "'");
    }
    if (
      typeof grant.ttlSeconds !== 'number' ||
      !isFinite(grant.ttlSeconds) ||
      Math.floor(grant.ttlSeconds) !== grant.ttlSeconds ||
      grant.ttlSeconds <= 0
    ) {
      issues.push(at + '.ttlSeconds: debe ser un número > 0');
    }
    if (
      typeof grant.maxUses !== 'number' ||
      Math.floor(grant.maxUses) !== grant.maxUses ||
      grant.maxUses < 1
    ) {
      issues.push(at + '.maxUses: debe ser un entero >= 1');
    }
    if (grant.consume !== 'on-success') {
      issues.push(at + ".consume: debe ser 'on-success'");
    }
  });
  Object.keys(REGISTRY.endpoints).forEach(function (id) {
    var endpoint = REGISTRY.endpoints[id];
    if (endpoint && endpoint.issuesGrant !== undefined) {
      var profile = REGISTRY.grantProfiles[endpoint.issuesGrant];
      if (
        typeof endpoint.issuesGrant !== 'string' ||
        !Object.prototype.hasOwnProperty.call(REGISTRY.grantProfiles, endpoint.issuesGrant)
      ) {
        issues.push(
          'endpoints.' + id + ": grantProfile inexistente '" + endpoint.issuesGrant + "'",
        );
      } else if (!profile || typeof profile !== 'object' || profile.issuedBy !== id) {
        issues.push(
          'endpoints.' +
            id +
            ".issuesGrant: el perfil declara otro emisor ('" +
            profile.issuedBy +
            "')",
        );
      }
    }
  });
}

function validateUploadProfiles_(issues) {
  Object.keys(REGISTRY.uploadProfiles).forEach(function (id) {
    var at = 'uploadProfiles.' + id;
    var profile = REGISTRY.uploadProfiles[id];
    if (!SAFE_PROFILE_ID_RE.test(id)) issues.push(at + ': id inválido');
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      issues.push(at + ': debe ser un objeto');
      return;
    }
    issues.push.apply(issues, unknownKeys_(at, profile, UPLOAD_PROFILE_KEYS));
    if (!Object.prototype.hasOwnProperty.call(REGISTRY.capabilities.adapters, profile.provider)) {
      issues.push(at + ": adapter inexistente '" + String(profile.provider) + "'");
    } else {
      var adapter = REGISTRY.capabilities.adapters[profile.provider];
      if (!adapter || typeof adapter.signUpload !== 'function') {
        issues.push(at + '.provider: adapter debe implementar signUpload');
      }
      if (!adapter || typeof adapter.verifyUpload !== 'function') {
        issues.push(at + '.provider: adapter debe implementar verifyUpload');
      }
      if (
        adapter &&
        Array.isArray(adapter.supportedMimeTypes) &&
        Array.isArray(profile.mimeTypes) &&
        profile.mimeTypes.some(function (mime) {
          return adapter.supportedMimeTypes.indexOf(mime) === -1;
        })
      ) {
        issues.push(at + '.mimeTypes: contiene un MIME no soportado por el adapter');
      }
    }
    if (
      typeof profile.resource !== 'string' ||
      !Object.prototype.hasOwnProperty.call(REGISTRY.resources, profile.resource)
    ) {
      issues.push(at + ": resource inexistente '" + String(profile.resource) + "'");
    }
    var grant = REGISTRY.grantProfiles[profile.grant];
    if (!Object.prototype.hasOwnProperty.call(REGISTRY.grantProfiles, profile.grant)) {
      issues.push(at + ": grant inexistente '" + String(profile.grant) + "'");
    } else if (!grant || typeof grant !== 'object' || grant.resource !== profile.resource) {
      issues.push(at + '.grant: el grant debe estar vinculado al mismo resource');
    }
    if (
      !Array.isArray(profile.mimeTypes) ||
      profile.mimeTypes.length === 0 ||
      profile.mimeTypes.some(function (mime) {
        return typeof mime !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime);
      })
    ) {
      issues.push(at + '.mimeTypes: debe ser un array no vacío de MIME types');
    }
    if (
      typeof profile.maxBytes !== 'number' ||
      !isFinite(profile.maxBytes) ||
      Math.floor(profile.maxBytes) !== profile.maxBytes ||
      profile.maxBytes <= 0
    ) {
      issues.push(at + '.maxBytes: debe ser un número > 0');
    }
    if (
      typeof profile.ttlSeconds !== 'number' ||
      !isFinite(profile.ttlSeconds) ||
      Math.floor(profile.ttlSeconds) !== profile.ttlSeconds ||
      profile.ttlSeconds <= 0
    ) {
      issues.push(at + '.ttlSeconds: debe ser un número > 0');
    }
    if (typeof profile.namespace !== 'string' || !/^[A-Za-z0-9_-]+$/.test(profile.namespace)) {
      issues.push(at + '.namespace: debe ser un segmento seguro de ruta');
    }
  });
}

/** Devuelve TODOS los problemas (no corta en el primero). */
function validateRegistry_() {
  var issues = [];
  var commandRoutes = {};
  var scheduleIds = {}; // R9.5.6: el id del schedule es la clave del mapa trigger ↔ job
  Object.keys(REGISTRY.resources).forEach(function (id) {
    var resource = REGISTRY.resources[id];
    validateResource_(id, resource, issues);

    // R9.5.6 — unicidad GLOBAL del id de schedule: el trigger handler de GAS
    // es único en el PROYECTO, así que dos jobs con el mismo id se pisarían
    // en el mapa SCHEDULE_TRIGGERS. Un duplicado DENTRO del recurso ya lo
    // juzga validateSchedules_; ésta es la otra punta: entre recursos.
    var schedules = resource && resource.schedules;
    if (Array.isArray(schedules)) {
      schedules.forEach(function (decl, index) {
        if (
          !decl ||
          typeof decl !== 'object' ||
          typeof decl.id !== 'string' ||
          decl.id.trim() === ''
        ) {
          return; // lo juzga validateSchedules_
        }
        var owner = scheduleIds[decl.id];
        if (owner !== undefined && owner !== 'resources.' + id) {
          issues.push(
            'resources.' +
              id +
              '.schedules[' +
              index +
              "]: id '" +
              decl.id +
              "' ya usado por " +
              owner,
          );
          return;
        }
        scheduleIds[decl.id] = 'resources.' + id;
      });
    }

    if (!resource || !resource.commands || Object.keys(resource.commands).length === 0) return;
    var route =
      resource.commandsRoute ||
      resource.route ||
      '/' + (resource.scope || 'admin') + '/' + resource.id;
    if (commandRoutes[route]) {
      issues.push(
        'resources.' + id + '.commandsRoute: ruta de commands ya usada por ' + commandRoutes[route],
      );
    } else {
      commandRoutes[route] = id;
    }
  });
  validateDeletePolicies_(issues);

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

  validateGrantProfiles_(issues);
  validateUploadProfiles_(issues);

  return issues;
}

// ── Al cargar ───────────────────────────────────────────────────────────────

function assertRegistryValid_() {
  var issues = validateRegistry_();
  if (issues.length === 0) return;
  throw new Error('REGISTRY inválido (' + issues.length + '):\n  - ' + issues.join('\n  - '));
}

assertRegistryValid_();
