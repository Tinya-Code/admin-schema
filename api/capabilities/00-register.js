// capabilities/00-register — La ÚNICA puerta de entrada a las capacidades
// (refactormotor.md §B1). Toda capacidad se declara con
// `registerCapability(categoría, descriptor)`; registrarla en otro lado
// (asignación directa a REGISTRY.ops/checks/…) deja de existir en R3.14.
//
// Contrato uniforme de toda entrada: { id, since, argsSchema, run }
//   id          clave pública: la que declara el recurso
//   since       versión de entrada (string opaco; '1.0' = heredado, el
//               proyecto todavía no tiene release propio)
//   argsSchema  argumentos declarables: { <nombre>: { type, required? } }
//               con type ∈ ARGS_TYPES_. null = la capacidad no declara
//               argumentos; {} = no admite ninguno
//   run         función en las categorías ejecutables; null en las de datos
//
// Las cuatro claves son OBLIGATORIAS y tipadas: un descriptor incompleto
// rompe el arranque, igual que una referencia rota en validate-registry.
//
// Al registrar se proyecta además al mapa legacy que todavía lee engine/
// (ops/transforms/checks/handlers/hooks/FIELD_TYPES): §B1 pide «nada nuevo
// se añade tocando engine/», así que migrar una capacidad no mueve un solo
// consumidor. Cuando un consumidor lea REGISTRY.capabilities en directo, su
// proyección se retira junto con él.
//
// Va antes que el resto de capabilities/ por el orden de carga (00- < letras)
// y sólo declara: toda referencia cruzada se resuelve en runtime.

// Vocabulario de argumentos de argsSchema.
var ARGS_TYPES_ = ['text', 'number', 'boolean', 'array', 'object'];

// Categoría → clase: 'run' si ejecuta comportamiento (run obligatorio y de
// tipo función) o 'meta' si sólo declara datos (run obligatorio y null).
// Tripwire: una categoría nueva en REGISTRY.capabilities sin su clase acá
// no puede registrarse.
var CAPABILITY_KIND_ = {
  fieldTypes: 'meta',
  validators: 'meta',
  adapters: 'meta',
  checks: 'run',
  computed: 'run',
  hooks: 'run',
  operators: 'run',
  handlers: 'run',
};

// Mapa legacy de fieldTypes: mismo objeto que REGISTRY.types.fieldTypes.
// La proyección lo llena; los consumidores (storage-map, validate, setup,
// rules) siguen leyendo FIELD_TYPES sin cambios.
var FIELD_TYPES = {};
REGISTRY.types.fieldTypes = FIELD_TYPES;

function capabilityError_(message) {
  return new Error('registerCapability: ' + message);
}

// Valor que recibe el mapa legacy de una capacidad.
//   meta → copia SÓLO de los metadatos (sin el sobre {id, since, …})
//   run  → la función misma, con su firma histórica
function legacyValue_(category, descriptor) {
  if (CAPABILITY_KIND_[category] !== 'meta') return descriptor.run;
  var meta = {};
  Object.keys(descriptor).forEach(function (key) {
    if (key !== 'id' && key !== 'since' && key !== 'argsSchema' && key !== 'run') {
      meta[key] = descriptor[key];
    }
  });
  return meta;
}

// Espejo al mapa legacy que consume engine/. Sin consumidor todavía:
// validators (nobody) y adapters (B5).
function projectLegacy_(category, id, value) {
  if (category === 'fieldTypes') FIELD_TYPES[id] = value;
  else if (category === 'operators') REGISTRY.ops[id] = value;
  else if (category === 'checks') REGISTRY.checks[id] = value;
  else if (category === 'computed') REGISTRY.transforms[id] = value;
  else if (category === 'handlers') REGISTRY.handlers[id] = value;
  else if (category === 'hooks') REGISTRY.hooks[id] = value;
}

function validateArgsSchema_(where, schema) {
  Object.keys(schema).forEach(function (name) {
    var rule = schema[name];
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw capabilityError_(where + ": el argumento '" + name + "' debe ser { type, required? }");
    }
    if (ARGS_TYPES_.indexOf(rule.type) === -1) {
      throw capabilityError_(
        where +
          ": el argumento '" +
          name +
          "' declara type '" +
          rule.type +
          "', fuera de ARGS_TYPES_ (" +
          ARGS_TYPES_.join(', ') +
          ')',
      );
    }
    if (rule.required !== undefined && typeof rule.required !== 'boolean') {
      throw capabilityError_(
        where + ": el argumento '" + name + "' declara required que no es boolean",
      );
    }
  });
}

/**
 * Única puerta de entrada a REGISTRY.capabilities.
 *
 * @param {string} category una de las 8 categorías declaradas en REGISTRY
 * @param {object} descriptor { id, since, argsSchema, run } — completo
 * @returns {object} el descriptor registrado
 * @throws {Error} cualquier problema de forma, de duplicado o de clase
 */
function registerCapability(category, descriptor) {
  if (!Object.prototype.hasOwnProperty.call(REGISTRY.capabilities, category)) {
    throw capabilityError_("categoría desconocida '" + category + "'");
  }
  if (!Object.prototype.hasOwnProperty.call(CAPABILITY_KIND_, category)) {
    throw capabilityError_("la categoría '" + category + "' no declara clase en CAPABILITY_KIND_");
  }
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw capabilityError_(category + ': el descriptor debe ser un objeto');
  }

  var where = category + '.' + (typeof descriptor.id === 'string' ? descriptor.id : '?');

  if (typeof descriptor.id !== 'string' || descriptor.id === '') {
    throw capabilityError_(category + ': id debe ser un string no vacío');
  }
  if (typeof descriptor.since !== 'string' || descriptor.since === '') {
    throw capabilityError_(where + ': since debe ser un string no vacío');
  }
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'argsSchema')) {
    throw capabilityError_(where + ': falta argsSchema (null si no declara argumentos)');
  }
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'run')) {
    throw capabilityError_(where + ': falta run (null en las categorías de datos)');
  }

  var schema = descriptor.argsSchema;
  if (schema !== null && (typeof schema !== 'object' || Array.isArray(schema))) {
    throw capabilityError_(where + ': argsSchema debe ser un objeto o null');
  }
  if (schema !== null) validateArgsSchema_(where, schema);

  var kind = CAPABILITY_KIND_[category];
  if (kind === 'run' && typeof descriptor.run !== 'function') {
    throw capabilityError_(where + ': run debe ser una función (' + category + ' ejecuta)');
  }
  if (kind === 'meta' && descriptor.run !== null) {
    throw capabilityError_(where + ': run debe ser null (' + category + ' sólo declara datos)');
  }

  var bucket = REGISTRY.capabilities[category];
  if (Object.prototype.hasOwnProperty.call(bucket, descriptor.id)) {
    throw capabilityError_(where + ' ya está registrada');
  }

  bucket[descriptor.id] = descriptor;
  projectLegacy_(category, descriptor.id, legacyValue_(category, descriptor));
  return descriptor;
}

/**
 * Problemas de `args` contra `argsSchema` (no lanza; [] = ok).
 *
 * @param {string} where prefijo del mensaje (la referencia declarada)
 * @param {object|null} schema argsSchema de la capacidad
 * @param {object} args argumentos declarados (undefined/null ⇒ {})
 * @returns {Array<string>}
 */
function capabilityArgsIssues_(where, schema, args) {
  if (!schema) return []; // null = sin argumentos declarados: no se juzga
  var values = args === undefined || args === null ? {} : args;
  if (typeof values !== 'object' || Array.isArray(values)) {
    return [where + ': args no es un objeto'];
  }
  var issues = [];
  Object.keys(schema).forEach(function (name) {
    var rule = schema[name];
    var value = values[name];
    var absent = value === undefined || value === null || value === '';
    if (absent) {
      if (rule.required) issues.push(where + ": falta el argumento obligatorio '" + name + "'");
      return;
    }
    if (!argTypeOk_(rule.type, value)) {
      issues.push(where + ": el argumento '" + name + "' debe ser " + rule.type);
    }
  });
  Object.keys(values).forEach(function (name) {
    if (!Object.prototype.hasOwnProperty.call(schema, name)) {
      issues.push(where + ": argumento desconocido '" + name + "'");
    }
  });
  return issues;
}

function argTypeOk_(type, value) {
  if (type === 'text') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'array') return Array.isArray(value);
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
