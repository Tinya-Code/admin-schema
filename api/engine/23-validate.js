// engine/23-validate — Reglas declarativas del schema (baseapi §7).
//
// El motor entiende por schema: requerido, único, inmutable, enum, patrón,
// rangos numéricos, palabras, FK (+ onlyActive), mín/máx de lista y origen
// Cloudinary de las imágenes. Acumula TODOS los errores con su ruta —
// incluidos los de ítems de lista como `images[0].image_url` (criterio 8,
// misma notación que parsea el front: shared/utils/field-path). Devuelve la
// lista; quien llama concatena las reglas nombradas y lanza un SOLO 422.
// Top-level: sólo declaraciones.

// Issues de validación con ruta (usa validationError_ de core/12-http).
function validationIssue_(path, message) {
  return { path: path, message: message };
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
      errors.push(validationIssue_(path, 'Este campo es obligatorio'));
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
        errors.push(validationIssue_(path, 'Ya existe un registro con este valor'));
      }
    }

    // Inmutable: sólo se reclama si el entrante lo intenta cambiar.
    if (!opts.isNew && field.immutable && current) {
      var raw = pickPath_(incoming, col);
      if (raw !== undefined && String(raw) !== String(pickPath_(current, col))) {
        errors.push(validationIssue_(path, 'Este valor es inmutable'));
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
    var checkCtx = {
      ss: ss,
      isNew: opts.isNew,
      key: opts.key,
      current: opts.current,
      children: opts.children,
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
        errors.push(validationIssue_(path, 'Debe ser un número'));
        return;
      }
      if (field.min !== undefined && n < field.min) {
        errors.push(validationIssue_(path, 'Debe ser ≥ ' + field.min));
      }
      if (field.max !== undefined && n > field.max) {
        errors.push(validationIssue_(path, 'Debe ser ≤ ' + field.max));
      }
      return;

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(validationIssue_(path, 'Debe ser verdadero o falso'));
      }
      return;

    case 'select':
      if (
        !enumList_(field).some(function (opt) {
          return opt === String(value);
        })
      ) {
        errors.push(validationIssue_(path, 'Valor no permitido'));
      }
      return;

    case 'multiselect':
      if (!Array.isArray(value)) {
        errors.push(validationIssue_(path, 'Debe ser una lista de valores'));
        return;
      }
      var allowed = enumList_(field);
      value.forEach(function (v, i) {
        if (
          !allowed.some(function (opt) {
            return opt === String(v);
          })
        ) {
          errors.push(validationIssue_(path + '[' + i + ']', 'Valor no permitido: ' + v));
        }
      });
      return;

    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value))) {
        errors.push(validationIssue_(path, 'Correo inválido'));
      }
      return;

    case 'url':
      if (!/^https?:\/\/\S+$/.test(String(value))) {
        errors.push(validationIssue_(path, 'Debe ser una URL http(s)://'));
      }
      return;

    case 'image':
      // Sólo https y del cloud configurado (baseapi §11.4).
      var prefix = 'https://res.cloudinary.com/' + Props.require('CLOUDINARY_CLOUD_NAME') + '/';
      if (typeof value !== 'string' || value.indexOf(prefix) !== 0) {
        errors.push(validationIssue_(path, 'Debe ser una imagen subida a Cloudinary (https)'));
      }
      return;

    case 'slug':
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value))) {
        errors.push(validationIssue_(path, 'Slug inválido: minúsculas, números y guiones'));
      }
      return;

    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || isNaN(Date.parse(String(value)))) {
        errors.push(validationIssue_(path, 'Fecha inválida (YYYY-MM-DD)'));
      }
      return;

    case 'time':
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) {
        errors.push(validationIssue_(path, 'Hora inválida (HH:mm)'));
      }
      return;

    case 'phone':
      if (field.format === 'e164' && !/^\+[1-9]\d{6,14}$/.test(String(value))) {
        errors.push(validationIssue_(path, 'Teléfono inválido: formato +51…'));
      } else if (field.format === 'digits' && !/^\d{3,20}$/.test(String(value))) {
        errors.push(validationIssue_(path, 'Sólo dígitos, sin signos'));
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
    errors.push(validationIssue_(path, 'No coincide con el formato que pide este campo'));
  }
  if (field.minLength !== undefined && text.length < field.minLength) {
    errors.push(
      validationIssue_(
        path,
        'Debe tener al menos ' + field.minLength + ' caracteres (' + text.length + ')',
      ),
    );
  }
  if (field.maxLength !== undefined && text.length > field.maxLength) {
    errors.push(
      validationIssue_(
        path,
        'Debe tener como máximo ' + field.maxLength + ' caracteres (' + text.length + ')',
      ),
    );
  }
  var words = wordCount_(text);
  if (field.minWords !== undefined && words < field.minWords) {
    errors.push(
      validationIssue_(path, 'Debe tener al menos ' + field.minWords + ' palabras (' + words + ')'),
    );
  }
  if (field.maxWords !== undefined && words > field.maxWords) {
    errors.push(
      validationIssue_(
        path,
        'Debe tener como máximo ' + field.maxWords + ' palabras (' + words + ')',
      ),
    );
  }
}

// Lista de valores permitidos: nombre en SHEET_ENUMS o arreglo inline.
function enumList_(field) {
  if (Array.isArray(field.enum)) return field.enum;
  var named = SHEET_ENUMS[field.enum];
  return Array.isArray(named) ? named : [];
}

// FK: debe existir en el recurso destino (y estar activa si onlyActive).
function validateRelation_(ss, field, value, path, errors) {
  var target = getResourceSchema(field.resource);
  if (target === null) {
    // Schema roto (no es error del usuario) → 500 explícito.
    throw apiError_(500, 'Relación no configurada: ' + field.resource);
  }
  var data = readSheetData_(ss, target.sheet);
  var idx = data.headers.indexOf(field.valueField);
  if (idx === -1) throw apiError_(500, 'Columna inexistente: ' + field.valueField);

  var found = null;
  var wanted = String(value);
  data.rows.forEach(function (row) {
    if (found === null && String(row.values[idx]) === wanted) found = row.values;
  });
  if (found === null) {
    errors.push(validationIssue_(path, 'La referencia no existe'));
    return;
  }
  if (field.onlyActive && target.activeField) {
    var activeIdx = data.headers.indexOf(target.activeField);
    if (activeIdx === -1 || !truthyCell_(found[activeIdx])) {
      errors.push(validationIssue_(path, 'La referencia debe estar activa'));
    }
  }
}

// Listas hijas: mín/máx por lista + validación por ítem con su ruta
// (`images[0].image_url`, `social[0]`, `specs[0].key`).
function validateChild_(ss, child, items, errors) {
  if (items === undefined || items === null) items = [];
  if (!Array.isArray(items)) {
    errors.push(validationIssue_(child.key, 'Debe ser una lista'));
    return;
  }
  var need = child.min !== undefined ? child.min : child.required ? 1 : 0;
  if (items.length < need) {
    errors.push(
      validationIssue_(
        child.key,
        'Agrega al menos ' + need + (need === 1 ? ' elemento' : ' elementos'),
      ),
    );
    return;
  }
  if (child.max !== undefined && items.length > child.max) {
    errors.push(validationIssue_(child.key, 'Máximo ' + child.max + ' elementos'));
    return;
  }

  items.forEach(function (item, i) {
    if (child.type === 'string-list') {
      if (child.itemType === 'url' && !/^https?:\/\/\S+$/.test(String(item))) {
        errors.push(validationIssue_(child.key + '[' + i + ']', 'Debe ser una URL http(s)://'));
      } else if (
        child.itemType === 'email' &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(item))
      ) {
        errors.push(validationIssue_(child.key + '[' + i + ']', 'Correo inválido'));
      }
      return;
    }
    if (child.type === 'key-value') {
      if (isEmptyValue_(item ? item.key : undefined)) {
        errors.push(validationIssue_(child.key + '[' + i + '].key', 'Este campo es obligatorio'));
      }
      return;
    }
    // list: cada itemFields con required y sus reglas de tipo.
    child.itemFields.forEach(function (f) {
      var value = item && typeof item === 'object' ? item[f.key] : undefined;
      var path = child.key + '[' + i + '].' + f.key;
      if (f.required && isEmptyValue_(value)) {
        errors.push(validationIssue_(path, 'Este campo es obligatorio'));
        return;
      }
      if (isEmptyValue_(value)) return;
      validateScalar_(ss, f, value, path, errors);
    });
  });
}
