// engine/33-io — Import/Export declarativo (R9.5.4, O2 · rutas lógicas).
//
// El recurso declara `operations.export` / `operations.import` y el router
// publica `/<ruta del recurso>/export|import` sólo entonces (mismo criterio que
// actions/commands: sin declaración no hay ruta ⇒ 404). El handler vuelve a
// mirar la declaración: una ruta sin declaración es un 500 ruidoso, nunca un
// volcado mudo.
//
//   export  → GET  /admin/<recurso>/export   (formato: decl.format o csv)
//   import  → POST /admin/<recurso>/import    (rows: [{ campo: valor }])
//
// El import corre el MISMO pipeline que el create, fila por fila
// (preparePayload_ → validación declarativa → hooks → computed → auditoría):
// una fila importada no es una excepción del motor, es un create.
//
// Atomicidad honesta (Sheets no tiene transacciones):
//   1. TODAS las filas se validan ANTES de escribir (fail-fast colectivo).
//   2. La escritura corre bajo UN solo lock de política: fila entera sí, fila
//      entera no — una fila inválida no deja fragmentos.
//   3. Un fallo tardío (colisión de unique dentro del propio lote) reporta esa
//      fila como inválida y CONTINÚA: la respuesta enumera qué entró y qué no,
//      sin dejar la hoja a medias.

// Tope de filas por importación: GAS corta a los 6 minutos y un lote
// ilimitado moriría con un error opaco. El tope es un 400 claro.
var IMPORT_MAX_ROWS_ = 1000;

var IMPORT_FORMATS_ = ['csv', 'json'];

// ── Export ─────────────────────────────────────────────────────────────────
//
// Volcado plano de los campos declarados en `operations.export.fields` (o de
// todos los escalares, si no declara `fields`). Los hijos van a hojas aparte
// y un secreto jamás sale (R7.6, §0.5): eso lo garantiza la validación al
// arranque (validate-registry); acá se cumple.
function dispatchExport_(resource, request) {
  var decl = declaredOperation_(resource, 'export');
  if (!operationEnabled_(decl)) {
    throw apiError_(405, "La operación 'export' no está declarada en '" + resource.id + "'");
  }
  if (resource.kind !== 'collection') {
    throw apiError_(400, 'Sólo una colección exporta filas');
  }
  var override = operationAccessOverride_(resource, 'export');
  if (override !== null) {
    requireAccess_(request.user === undefined ? null : request.user, override);
  }

  var requested = request && request.payload ? request.payload.format : undefined;
  var format = exportFormat_(decl, requested);

  var ss = openSpreadsheet_();
  var map = storageMap_(resource);
  var data = readSheetData_(ss, map.sheet);
  var entries = sortPositionedEntries_(flatEntries_(map, data), map);
  var fields = exportFieldKeys_(resource, decl);

  var rows = entries.map(function (entry) {
    var obj = flatToContract_(map, entry.flat);
    var picked = {};
    fields.forEach(function (key) {
      picked[key] = obj[key];
    });
    return picked;
  });

  if (format === 'json') {
    return {
      format: 'json',
      resource: resource.id,
      fields: fields,
      count: rows.length,
      rows: rows,
    };
  }
  return {
    format: 'csv',
    resource: resource.id,
    fields: fields,
    count: rows.length,
    csv: csvSerialize_(fields, rows),
  };
}

// Formato: el declarado manda; el override del request sólo puede nombrar un
// formato de la lista (csv | json). Cualquier otra cosa es 400, no un
// silencioso que volviera un CSV fingiendo JSON.
function exportFormat_(decl, requested) {
  var declared = decl.format === undefined ? 'csv' : decl.format;
  if (requested === undefined || requested === null || requested === '') return declared;
  if (IMPORT_FORMATS_.indexOf(requested) === -1) {
    throw apiError_(400, "formato inválido '" + requested + "' (csv | json)");
  }
  return requested;
}

// Claves a exportar: las declaradas; sin `fields`, todos los escalares del
// recurso. La lista ya se validó al arranque; ésta es una defensa por si el
// schema se movió en caliente — un campo que ya no existe no viaja.
function exportFieldKeys_(resource, decl) {
  if (Array.isArray(decl.fields) && decl.fields.length > 0) return decl.fields.slice();
  return resource.fields
    .filter(function (field) {
      return (
        field.type !== 'secret' &&
        field.type !== 'group' &&
        field.type !== 'list' &&
        field.type !== 'string-list' &&
        field.type !== 'key-value'
      );
    })
    .map(function (field) {
      return field.key;
    });
}

// ── CSV ────────────────────────────────────────────────────────────────────

// Celda CSV con guarda anti-fórmula: una celda que empieza con =, +, - o @
// la convierte Google Sheets en fórmula al abrir el archivo — el export es
// dato, no programa. El prefijo comilla lo neutraliza. Después se escapa
// comilla doble y se entrecomilla si hay coma, comilla o salto de línea.
function csvCell_(value) {
  if (value === null || value === undefined) return '';
  var text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  if (/[",\n\r]/.test(text)) text = '"' + text.split('"').join('""') + '"';
  return text;
}

function csvSerialize_(fields, rows) {
  var lines = [fields.map(csvCell_).join(',')];
  rows.forEach(function (row) {
    lines.push(
      fields
        .map(function (key) {
          return csvCell_(row[key]);
        })
        .join(','),
    );
  });
  return lines.join('\n');
}

// ── Import ─────────────────────────────────────────────────────────────────
//
// `rows` es un arreglo de objetos, uno por fila. Cada fila se importa como un
// create: si trae un campo que `operations.import.fields` no declara, la fila
// es inválida con su error (nunca se descarta en silencio). El resultado enumera
// fila por fila qué entró y qué no.
function dispatchImport_(resource, request) {
  var decl = declaredOperation_(resource, 'import');
  if (!operationEnabled_(decl)) {
    throw apiError_(405, "La operación 'import' no está declarada en '" + resource.id + "'");
  }
  if (resource.kind !== 'collection') {
    throw apiError_(400, 'Sólo una colección importa filas');
  }
  // Misma paridad que resourceCreate_: falla rápido si los hooks declarados
  // no son válidos, ANTES de tocar la hoja.
  validateHooks_(resource);
  // Importar ES crear: sin operations.create encendido no hay pipeline.
  if (!operationEnabled_(declaredOperation_(resource, 'create'))) {
    throw apiError_(405, "import exige operations.create encendido en '" + resource.id + "'");
  }
  var override = operationAccessOverride_(resource, 'import');
  if (override !== null) {
    requireAccess_(request.user === undefined ? null : request.user, override);
  }

  var user = request && request.user ? request.user : null;
  var rows = request && request.payload ? request.payload.rows : undefined;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw apiError_(400, 'rows debe ser un arreglo de filas (objeto por fila)');
  }
  if (rows.length > IMPORT_MAX_ROWS_) {
    throw apiError_(400, 'Demasiadas filas en un solo import (máximo ' + IMPORT_MAX_ROWS_ + ')');
  }

  var allowed = Array.isArray(decl.fields) && decl.fields.length > 0 ? decl.fields : null;
  var ss = openSpreadsheet_();
  var map = storageMap_(resource);

  // FASE 1 — validar TODAS las filas antes de escribir NADA. La hoja se lee
  // UNA vez acá; createApply_ la relee por fila bajo el lock.
  var entries0 = flatEntries_(map, readSheetData_(ss, map.sheet));
  var prepared = []; // válidas: { index, payload }
  var results = [];
  rows.forEach(function (row, index) {
    var outcome = importRowOutcome_(resource, map, ss, row, user, allowed, entries0, index);
    if (outcome.ok) {
      prepared.push({ index: index, payload: outcome.payload });
      results[index] = {
        index: index,
        status: 'created',
        key: String(outcome.payload[map.keyField]),
      };
    } else {
      results[index] = { index: index, status: 'invalid', errors: outcome.errors };
    }
  });

  // FASE 2 — escribir bajo UN lock: cada fila entera o ninguna.
  if (prepared.length > 0) {
    withPolicyLock_(resource, function () {
      prepared.forEach(function (item) {
        try {
          createApply_(ss, resource, map, item.payload);
        } catch (err) {
          // Colisión dentro del propio lote (unique) u otra invalidéz tardía:
          // se reporta y se CONTINÚA — la fila no dejó fragmentos.
          results[item.index] = {
            index: item.index,
            status: 'invalid',
            errors: importErrorsOf_(err),
          };
        }
      });
    });
  }

  var created = results.filter(function (result) {
    return result.status === 'created';
  }).length;
  return {
    resource: resource.id,
    total: rows.length,
    created: created,
    invalid: rows.length - created,
    results: results,
  };
}

// Una fila del lote contra el MISMO pipeline que el create. Devuelve
// { ok: true, payload } o { ok: false, errors }. `entries0` son las filas
// ya en la hoja, leídas una sola vez antes del lote (O3).
function importRowOutcome_(resource, map, ss, row, user, allowed, entries0, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return {
      ok: false,
      errors: [
        commandIssue_('rows[' + index + ']', 'IMPORT_ROW_NOT_OBJECT', 'La fila debe ser un objeto'),
      ],
    };
  }
  var source = {};
  var errors = [];
  Object.keys(row).forEach(function (key) {
    if (allowed !== null && allowed.indexOf(key) === -1) {
      errors.push(
        commandIssue_(
          'rows[' + index + '].' + key,
          'IMPORT_FIELD_NOT_ALLOWED',
          "El campo '" + key + "' no está en operations.import.fields",
        ),
      );
      return;
    }
    source[key] = row[key];
  });
  if (errors.length > 0) return { ok: false, errors: errors };

  try {
    assertWritableFields_(resource, source, user);
  } catch (err) {
    return { ok: false, errors: importErrorsOf_(err) };
  }

  var payload;
  try {
    payload = preparePayload_(resource, source, { isNew: true, ss: ss, user: user });
  } catch (err) {
    return { ok: false, errors: importErrorsOf_(err) };
  }

  try {
    validateAndThrow_(ss, resource, map, {
      isNew: true,
      key: null,
      scalars: payload,
      incoming: payload,
      current: null,
      children: childrenForValidation_(map, payload, true),
      currentChildren: {}, // no existe el registro ⇒ no hay hijos guardados
      principalRows: entries0,
    });
  } catch (err) {
    return { ok: false, errors: importErrorsOf_(err) };
  }

  var rawKey = payload[map.keyField];
  var key = rawKey === undefined || rawKey === null ? '' : String(rawKey);
  if (key === '') {
    return {
      ok: false,
      errors: [validatorIssue_(map.keyField, 'required')],
    };
  }
  return { ok: true, payload: payload };
}

// Errores de un error TIPADO de la forma del backend ({ path, code, message });
// cualquier otra excepción no es invalidéz de fila — se propaga (fail-loud).
function importErrorsOf_(err) {
  if (err && err.apiStatus && Array.isArray(err.apiErrors) && err.apiErrors.length > 0) {
    return err.apiErrors;
  }
  if (err && err.apiStatus) {
    return [
      commandIssue_('', err.apiCode || 'IMPORT_ERROR', String(err.message || 'Fila inválida')),
    ];
  }
  throw err;
}
