// engine/23-validate — Reglas declarativas del schema (baseapi §7).
//
// El motor entiende por schema: requerido, único, inmutable, enum, patrón,
// rangos numéricos, palabras, FK (+ onlyActive), mín/máx de lista y origen
// Cloudinary de las imágenes. Acumula TODOS los errores con su ruta —
// incluidos los de ítems de lista como `images[0].image_url` (criterio 8,
// misma notación que parsea el front: shared/utils/field-path). Devuelve la
// lista; quien llama concatena las reglas nombradas y lanza un SOLO 422.
// Top-level: sólo declaraciones.

// Issues con ruta (usa validationError_ de core/12-http).
//   · `validationIssue_(path, message, code)`: mensaje propio — lo usan los
//     checks declarados (capabilities/checks), que traen el suyo.
//   · `validatorIssue_(path, name, params)`: el VOCABULARIO de abajo — el
//     mensaje y el código salen de UNA sola entrada.
//
// El sobre es siempre {path, message, code} (auth.md §6); el código es
// estable aunque cambie el texto (B11), MAYUS_SNAKE con prefijo de dominio.
function validationIssue_(path, message, code) {
  var issue = { path: path, message: message };
  if (code) issue.code = code;
  return issue;
}

// Vocabulario compartido con el front (F7 «los validadores y reglas del
// formulario viven en un registro; mismos nombres que el back»).
//
// Cada entrada ES un validador: nombre (idéntico al del registro del front,
// src/app/core/registry/field-validators.ts) + mensaje. El código se deriva
// — VALIDATION_ + NOMBRE_EN_MAYÚSCULAS — así que AÑADIR UN VALIDADOR ES UNA
// ENTRADA ACÁ y una en el registro del front; nada más. Los mensajes son
// textualmente los de siempre: cambia el sobre, no el texto.
var VALIDATORS_ = {
  required: 'Este campo es obligatorio',
  unique: 'Ya existe un registro con este valor',
  immutable: 'Este valor es inmutable',
  pattern: 'No coincide con el formato que pide este campo',
  'min-length': function (p) {
    return 'Debe tener al menos ' + p.min + ' caracteres (' + p.actual + ')';
  },
  'max-length': function (p) {
    return 'Debe tener como máximo ' + p.max + ' caracteres (' + p.actual + ')';
  },
  'min-words': function (p) {
    return 'Debe tener al menos ' + p.min + ' palabras (' + p.actual + ')';
  },
  'max-words': function (p) {
    return 'Debe tener como máximo ' + p.max + ' palabras (' + p.actual + ')';
  },
  min: function (p) {
    return 'Debe ser ≥ ' + p.min;
  },
  max: function (p) {
    return 'Debe ser ≤ ' + p.max;
  },
  'min-items': function (p) {
    return 'Agrega al menos ' + p.min + (p.min === 1 ? ' elemento' : ' elementos');
  },
  'max-items': function (p) {
    return 'Máximo ' + p.max + ' elementos';
  },
  number: 'Debe ser un número',
  boolean: 'Debe ser verdadero o falso',
  enum: function (p) {
    return p && p.value !== undefined ? 'Valor no permitido: ' + p.value : 'Valor no permitido';
  },
  multiselect: 'Debe ser una lista de valores',
  list: 'Debe ser una lista',
  email: 'Correo inválido',
  url: 'Debe ser una URL http(s)://',
  image: 'Debe ser una imagen subida a Cloudinary (https)',
  slug: 'Slug inválido: minúsculas, números y guiones',
  date: 'Fecha inválida (YYYY-MM-DD)',
  'date-min': function (p) {
    return 'La fecha no puede ser anterior a ' + p.min + '.';
  },
  'date-max': function (p) {
    return 'La fecha no puede ser posterior a ' + p.max + '.';
  },
  time: 'Hora inválida (HH:mm)',
  phone: function (p) {
    return p.digits ? 'Sólo dígitos, sin signos' : 'Teléfono inválido: formato +51…';
  },
  relation: 'La referencia no existe',
  'relation-active': 'La referencia debe estar activa',
};

// Código MAYUS_SNAKE del validador (auth.md §6 «VALIDATION_*»). Lo comparten
// los checks declarados: el mensaje puede ser libre, el código no.
function validationCode_(name) {
  return 'VALIDATION_' + String(name).toUpperCase().replace(/-/g, '_');
}

// Issue del vocabulario: mensaje resuelto en VALIDATORS_ + código derivado.
// Un nombre fuera de la tabla es error de configuración → 500 (§16).
function validatorIssue_(path, name, params) {
  if (!Object.prototype.hasOwnProperty.call(VALIDATORS_, name)) {
    throw apiError_(500, 'Validador no registrado: ' + name);
  }
  var message = VALIDATORS_[name];
  if (typeof message === 'function') message = message(params || {});
  return { path: path, message: message, code: validationCode_(name) };
}

// ¿El valor está vacío para efectos de `required`?
//   0 y false son VALORES; '' / null / undefined / [] no.
function isEmptyValue_(value) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function wordCount_(text) {
  var trimmed = String(text).trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

// Valida el payload fusionado contra el schema.
// opts = {
//   isNew,          // true en creación
//   key,            // clave del registro en edición (excluye el único)
//   scalars,        // contrato fusionado (guardado + entrante)
//   incoming,       // payload entrante (detecta inmutables tocados)
//   current,        // contrato guardado (null al crear)
//   children,       // listas efectivas (entrantes o ya guardadas)
//   principalRows,  // entradas frescas de la hoja principal (para únicos)
// }
// Devuelve [{ path, message }]; NO lanza por validación. Los errores de
// CONFIGURACIÓN de resource.checks (check mal formado/no registrado) sí
// lanzan 500: el schema manda (§16).
function validatePayload_(ss, resource, map, opts) {
  var errors = [];
  var incoming = opts.incoming || {};
  var current = opts.current || null;
  var scalars = opts.scalars || {};

  map.columns.forEach(function (col) {
    var field = col.field;
    if (col.system || col.computed) return; // el backend es dueño
    var path = col.path;
    var value = pickPath_(scalars, col);

    if (field.required && isEmptyValue_(value)) {
      errors.push(validatorIssue_(path, 'required'));
      return;
    }
    if (isEmptyValue_(value)) return; // opcional vacío ⇒ nada más

    validateScalar_(ss, field, value, path, errors);

    // Único: otro registro con el mismo valor (la clave propia se excluye).
    if (field.unique && opts.principalRows) {
      var wanted = String(value);
      var duplicated = opts.principalRows.some(function (entry) {
        if (String(entry.flat[col.flatKey]) !== wanted) return false;
        if (opts.isNew) return true;
        return String(entry.flat[map.keyField]) !== String(opts.key);
      });
      if (duplicated) {
        errors.push(validatorIssue_(path, 'unique'));
      }
    }

    // Inmutable: sólo se reclama si el entrante lo intenta cambiar.
    if (!opts.isNew && field.immutable && current) {
      var raw = pickPath_(incoming, col);
      if (raw !== undefined && String(raw) !== String(pickPath_(current, col))) {
        errors.push(validatorIssue_(path, 'immutable'));
      }
    }
  });

  map.children.forEach(function (child) {
    // Hijas AUSENTES en opts.children = "no se tocaron": no se validan
    // (crear llama con strictChildren para que ausente signifique []).
    if (!opts.children || !Object.prototype.hasOwnProperty.call(opts.children, child.key)) {
      return;
    }
    validateChild_(ss, child, opts.children[child.key], errors);
  });

  // Checks declarados (F4, mejoras §6): resource.checks = [{ check, …params }]
  // — se corren DESPUÉS de los declarativos y acumulan en el MISMO 422,
  // en el orden del array (el recurso fija su orden de error).
  if (Array.isArray(resource.checks) && resource.checks.length > 0) {
    // `children` son SOLO las hijas del payload (childrenForValidation_) y
    // `current` SOLO columnas (flatToContract_): ninguno da lo YA GUARDADO.
    // `currentChildren` es ese snapshot, leído por 24-crud con
    // readChildren_ — `{}` en create, porque el registro aún no existe.
    // Sin normalizar a {}: un call site que se olvide de pasarlo se ve como
    // undefined en el test y no como «no hay historial» (fail-open).
    var checkCtx = {
      ss: ss,
      isNew: opts.isNew,
      key: opts.key,
      current: opts.current,
      children: opts.children,
      currentChildren: opts.currentChildren,
    };
    resource.checks.forEach(function (decl) {
      if (!decl || typeof decl.check !== 'string') {
        throw apiError_(500, 'check mal declarado en ' + resource.id);
      }
      var fn = REGISTRY.checks && REGISTRY.checks[decl.check];
      if (typeof fn !== 'function') {
        throw apiError_(500, 'Check no registrado: ' + decl.check);
      }
      var found = fn({ resource: resource, scalars: scalars, ctx: checkCtx, params: decl });
      if (Array.isArray(found)) errors = errors.concat(found);
    });
  }

  return errors;
}

// Validación de UN valor escalar (también se reutiliza en ítems de lista).
function validateScalar_(ss, field, value, path, errors) {
  var n;
  switch (field.type) {
    case 'number':
    case 'currency':
      n = Number(value);
      if (typeof value === 'boolean' || !isFinite(n)) {
        errors.push(validatorIssue_(path, 'number'));
        return;
      }
      if (field.min !== undefined && n < field.min) {
        errors.push(validatorIssue_(path, 'min', { min: field.min }));
      }
      if (field.max !== undefined && n > field.max) {
        errors.push(validatorIssue_(path, 'max', { max: field.max }));
      }
      return;

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(validatorIssue_(path, 'boolean'));
      }
      return;

    case 'select':
      if (
        !enumList_(field).some(function (opt) {
          return opt === String(value);
        })
      ) {
        errors.push(validatorIssue_(path, 'enum'));
      }
      return;

    case 'multiselect':
      if (!Array.isArray(value)) {
        errors.push(validatorIssue_(path, 'multiselect'));
        return;
      }
      var allowed = enumList_(field);
      value.forEach(function (v, i) {
        if (
          !allowed.some(function (opt) {
            return opt === String(v);
          })
        ) {
          errors.push(validatorIssue_(path + '[' + i + ']', 'enum', { value: v }));
        }
      });
      return;

    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value))) {
        errors.push(validatorIssue_(path, 'email'));
      }
      return;

    case 'url':
      if (!/^https?:\/\/\S+$/.test(String(value))) {
        errors.push(validatorIssue_(path, 'url'));
      }
      return;

    case 'image':
      // Sólo https y del cloud configurado (baseapi §11.4).
      var prefix = 'https://res.cloudinary.com/' + Props.require('CLOUDINARY_CLOUD_NAME') + '/';
      if (typeof value !== 'string' || value.indexOf(prefix) !== 0) {
        errors.push(validatorIssue_(path, 'image'));
      }
      return;

    case 'slug':
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value))) {
        errors.push(validatorIssue_(path, 'slug'));
      }
      return;

    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || isNaN(Date.parse(String(value)))) {
        errors.push(validatorIssue_(path, 'date'));
        return;
      }
      // Rango declarado: YYYY-MM-DD se compara lexicográficamente. El form ya
      // lo rechazaba (form-schema dateError); ahora el back también, para que
      // la autoridad no acepte lo que el formulario no pintó.
      if (field.min !== undefined && String(value) < String(field.min)) {
        errors.push(validatorIssue_(path, 'date-min', { min: field.min }));
      }
      if (field.max !== undefined && String(value) > String(field.max)) {
        errors.push(validatorIssue_(path, 'date-max', { max: field.max }));
      }
      return;

    case 'time':
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) {
        errors.push(validatorIssue_(path, 'time'));
      }
      return;

    case 'phone':
      if (field.format === 'e164' && !/^\+[1-9]\d{6,14}$/.test(String(value))) {
        errors.push(validatorIssue_(path, 'phone', { digits: false }));
      } else if (field.format === 'digits' && !/^\d{3,20}$/.test(String(value))) {
        errors.push(validatorIssue_(path, 'phone', { digits: true }));
      }
      return;

    case 'relation':
      validateRelation_(ss, field, value, path, errors);
      return;

    case 'text':
    case 'textarea':
    case 'readonly-text':
      break; // patrón/palabras se aplican abajo, comunes a todo string

    default:
      return;
  }

  // Comunes a todo texto: patrón, longitud y conteo de palabras.
  var text = String(value);
  if (field.pattern && !new RegExp(field.pattern).test(text)) {
    errors.push(validatorIssue_(path, 'pattern'));
  }
  if (field.minLength !== undefined && text.length < field.minLength) {
    errors.push(validatorIssue_(path, 'min-length', { min: field.minLength, actual: text.length }));
  }
  if (field.maxLength !== undefined && text.length > field.maxLength) {
    errors.push(validatorIssue_(path, 'max-length', { max: field.maxLength, actual: text.length }));
  }
  var words = wordCount_(text);
  if (field.minWords !== undefined && words < field.minWords) {
    errors.push(validatorIssue_(path, 'min-words', { min: field.minWords, actual: words }));
  }
  if (field.maxWords !== undefined && words > field.maxWords) {
    errors.push(validatorIssue_(path, 'max-words', { max: field.maxWords, actual: words }));
  }
}

// Lista de valores permitidos: nombre en SHEET_ENUMS o arreglo inline.
function enumList_(field) {
  if (Array.isArray(field.enum)) return field.enum;
  var named = SHEET_ENUMS[field.enum];
  return Array.isArray(named) ? named : [];
}

// FK: debe existir en el recurso destino (y estar activa si onlyActive).
// La fuente declarada es `field.source` (F8 · R6.5, D62): `{ resource,
// valueField? }` — sin `valueField` la clave es el `keyField` del recurso
// destino, la misma regla que aplican `27-views` y el front.
function validateRelation_(ss, field, value, path, errors) {
  var src = field.source;
  if (src === undefined || src === null || typeof src !== 'object') {
    throw apiError_(500, 'Relación sin source: ' + field.key);
  }
  var target = getResourceSchema(src.resource);
  if (target === null) {
    // Schema roto (no es error del usuario) → 500 explícito.
    throw apiError_(500, 'Relación no configurada: ' + src.resource);
  }
  var data = readSheetData_(ss, target.sheet);
  var valueField = src.valueField || target.keyField;
  var idx = data.headers.indexOf(valueField);
  if (idx === -1) throw apiError_(500, 'Columna inexistente: ' + valueField);

  var found = null;
  var wanted = String(value);
  data.rows.forEach(function (row) {
    if (found === null && String(row.values[idx]) === wanted) found = row.values;
  });
  if (found === null) {
    errors.push(validatorIssue_(path, 'relation'));
    return;
  }
  if (field.onlyActive && target.activeField) {
    var activeIdx = data.headers.indexOf(target.activeField);
    if (activeIdx === -1 || !truthyCell_(found[activeIdx])) {
      errors.push(validatorIssue_(path, 'relation-active'));
    }
  }
}

// Listas hijas: mín/máx por lista + validación por ítem con su ruta
// (`images[0].image_url`, `social[0]`, `specs[0].key`).
function validateChild_(ss, child, items, errors) {
  if (items === undefined || items === null) items = [];
  if (!Array.isArray(items)) {
    errors.push(validatorIssue_(child.key, 'list'));
    return;
  }
  var need = child.min !== undefined ? child.min : child.required ? 1 : 0;
  if (items.length < need) {
    errors.push(validatorIssue_(child.key, 'min-items', { min: need }));
    return;
  }
  if (child.max !== undefined && items.length > child.max) {
    errors.push(validatorIssue_(child.key, 'max-items', { max: child.max }));
    return;
  }

  items.forEach(function (item, i) {
    if (child.type === 'string-list') {
      if (child.itemType === 'url' && !/^https?:\/\/\S+$/.test(String(item))) {
        errors.push(validatorIssue_(child.key + '[' + i + ']', 'url'));
      } else if (
        child.itemType === 'email' &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(item))
      ) {
        errors.push(validatorIssue_(child.key + '[' + i + ']', 'email'));
      }
      return;
    }
    if (child.type === 'key-value') {
      if (isEmptyValue_(item ? item.key : undefined)) {
        errors.push(validatorIssue_(child.key + '[' + i + '].key', 'required'));
      }
      return;
    }
    // list: cada itemFields con required y sus reglas de tipo.
    child.itemFields.forEach(function (f) {
      var value = item && typeof item === 'object' ? item[f.key] : undefined;
      var path = child.key + '[' + i + '].' + f.key;
      if (f.required && isEmptyValue_(value)) {
        errors.push(validatorIssue_(path, 'required'));
        return;
      }
      if (isEmptyValue_(value)) return;
      validateScalar_(ss, f, value, path, errors);
    });
  });
}

// ── Entrada y salida de endpoints (B2 · R5.1) ─────────────────────────────
//
// Mismo vocabulario `FIELD_TYPES` que los campos de un recurso, con una
// salvedad de ENTRADA: `secret` — no es un tipo de storage sino la marca de
// «sólo se comprueba la presencia» (la contraseña del login: su contenido lo
// juzga el handler, que es quien tiene el hash).
//
// Forma de la declaración (B2):
//   input:  { email: { type: 'email' } }              plano ⇒ payload raíz
//   input:  { params: { ref: { type: 'text' } } }     `params` = la ruta
//   input:  { query:  { ref: { type: 'text' } } }     el resto = ese bloque
//                                                     del payload
//   output: { ok: { type: 'boolean', required: true } }
//
// Sólo lo DECLARADO se valida (whitelist, como todo el motor): un endpoint
// sin `input` no cambia de comportamiento, que es la precondición de R5.1.
// La validación de la DECLARACIÓN (tipo inexistente, forma rara) vive en
// schema/validate-registry y rompe el arranque, no la petición.

// ¿Es un campo declarado ({ type: 'text', … }) y no un grupo de campos?
function isDeclaredField_(decl) {
  return (
    !!decl && typeof decl === 'object' && !Array.isArray(decl) && typeof decl.type === 'string'
  );
}

// Un campo de la declaración: `required` vacío ⇒ issue; vacío opcional ⇒
// nada; con valor ⇒ las mismas reglas que un campo de recurso.
function endpointFieldIssues_(field, value, path, errors) {
  if (field.required && isEmptyValue_(value)) {
    errors.push(validatorIssue_(path, 'required'));
    return;
  }
  if (isEmptyValue_(value)) return;
  validateScalar_(null, field, value, path, errors);
}

// Valida `input` contra la petición (payload + params de la ruta).
// Devuelve [{ path, message, code }]; NO lanza por validación — el 422 lo
// arma el router. Lanza 500 sólo si la DECLARACIÓN está mal formada: el
// schema manda (§16).
function validateEndpointInput_(input, payload, params) {
  var errors = [];
  if (input === null || input === undefined) return errors;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw apiError_(500, 'input de endpoint mal declarado (debe ser un objeto)');
  }
  Object.keys(input).forEach(function (key) {
    var decl = input[key];
    if (isDeclaredField_(decl)) {
      // Plano: el campo vive en la raíz del payload.
      endpointFieldIssues_(decl, payload ? payload[key] : undefined, key, errors);
      return;
    }
    if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
      throw apiError_(500, "input de endpoint mal declarado: '" + key + "'");
    }
    // Grupo: `params` sale de la ruta, el resto de ese bloque del payload.
    var source = key === 'params' ? params : payload ? payload[key] : undefined;
    var sourceIsObject = !!source && typeof source === 'object';
    Object.keys(decl).forEach(function (sub) {
      var field = decl[sub];
      if (!isDeclaredField_(field)) {
        throw apiError_(500, 'input.' + key + '.' + sub + ': no es un campo declarado');
      }
      endpointFieldIssues_(
        field,
        sourceIsObject ? source[sub] : undefined,
        key + '.' + sub,
        errors,
      );
    });
  });
  return errors;
}

// Valida `output` contra lo que devolvió el handler. El router sólo la
// invoca en dev (B2): en prod el contrato documenta, no frena.
function validateEndpointOutput_(output, result) {
  var errors = [];
  if (output === null || output === undefined) return errors;
  if (typeof output !== 'object' || Array.isArray(output)) {
    throw apiError_(500, 'output de endpoint mal declarado (debe ser un objeto)');
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw apiError_(500, 'output declarado, pero el handler no devuelve un objeto');
  }
  Object.keys(output).forEach(function (key) {
    var field = output[key];
    if (!isDeclaredField_(field)) {
      throw apiError_(500, 'output.' + key + ': no es un campo declarado');
    }
    endpointFieldIssues_(field, result[key], key, errors);
  });
  return errors;
}
