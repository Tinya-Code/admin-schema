// engine/24-crud — Pipeline genérico de lectura/escritura (baseapi §8, §9).
//
// UNA implementación parametrizada por schema; cero código por entidad.
// Punto de entrada del router: dispatchResource_(resource, request).
//
// Escritura: validar (falla rápido) → lock → releer y re-validar → fila
// principal + reemplazo EN LOTE de hijos → campos computados → auditar →
// invalidar caché → responder el recurso armado.
// Lectura: caché → rangos completos → armar → ordenar → proyectar →
// vistas declarativas (payload) → JSON.
//
// Derivados y checks declarados (F4, mejoras §6): el motor los interpreta
// directo desde el schema, sin archivos de reglas aparte —
//   resource.operations.create.computed = [{ field, transform, from, params? }]
//     → computeRules_ (este archivo) deriva valores ANTES de validar;
//       sólo al crear y sólo si el destino viene vacío (slug es inmutable)
//   resource.checks = [{ check, …params }]
//     → REGISTRY.checks (primitives/checks) corre DESPUÉS de los declarativos,
//       en el orden del array, acumulando en el MISMO 422
// Ambos toleran payloads rotos y se ejecutan aunque haya errores declarativos
// para entregar todos los errores en un solo 422.
//   filter/view (Fase 8, F3): la lectura de lista acepta intención en el
//     payload — { filter?: nombre, view?: nombre, key?: clave } — y la
//     resuelve engine/27-views contra resource.views declarativo.
//   shape (F5): la forma de la respuesta sale del schema —
//     operations.<op>.shape / views.<n>.shape → engine/22-assemble
//     (pick/include/nest/rename/envelope); reorder es respuesta
//     operacional { key, position, at } y NO lleva shape.
//   policies (F6, §8): cache.ttl / audit / lock salen de
//     resource.policies — ttlOf_ y auditWrite_ los leen y las escrituras
//     pasan por withPolicyLock_ (con lock salvo policies.lock === false).
//   hooks (T2c / M3): resource.hooks.<acción> = ['<REGISTRY.hooks>', …]
//     → el MOTOR emite el evento, no el navegador (antes había que
//       recordar un endpoint declarativo). validateHooks_ corre EAGER
//       antes del lock; emitHook_ corre después de cacheInvalidate_ y
//       aísla los errores: un hook que falla no deshace la escritura.
// Top-level: sólo declaraciones.

// ── Despacho ───────────────────────────────────────────────────────────────

function dispatchResource_(resource, request) {
  var ss = openSpreadsheet_();
  var map = storageMap_(resource);
  switch (request.method) {
    case 'GET':
      return resourceGet_(ss, resource, map, request);
    case 'POST':
      return resourceCreate_(ss, resource, map, request);
    case 'PUT':
    case 'PATCH':
      return resourcePut_(ss, resource, map, request);
    case 'DELETE':
      return resourceDelete_(ss, resource, map, request);
    default:
      throw apiError_(400, 'Método no soportado: ' + request.method);
  }
}

// ── Lectura ────────────────────────────────────────────────────────────────

function resourceGet_(ss, resource, map, request) {
  if (resource.kind === 'singleton') {
    return shapeResponse_(resource, 'get', getSingleton_(ss, resource, map));
  }
  var key = request.params[map.keyField];
  if (key === undefined || key === null || String(key) === '') {
    return listWithRules_(ss, resource, map, request);
  }
  return shapeResponse_(resource, 'get', getOne_(ss, resource, map, String(key)));
}

// TTL de caché desde policies.cache.ttl (F6-1); ausencia ⇒ default global.
function ttlOf_(resource) {
  return resource.policies && resource.policies.cache && resource.policies.cache.ttl > 0
    ? resource.policies.cache.ttl
    : CONFIG.CACHE_TTL_SECONDS;
}

function getSingleton_(ss, resource, map) {
  var cached = cacheGet_(resource.id, 'get');
  if (cached !== null) return cached;
  var detail = readSingletonDetail_(ss, resource, map);
  cachePut_(resource.id, 'get', detail, ttlOf_(resource));
  return detail;
}

// Singleton armado: filas KV → objeto anidado + hijas completas (hours,
// social). Sin proyección: un singleton no tiene listado.
function readSingletonDetail_(ss, resource, map) {
  var data = readSheetData_(ss, map.sheet);
  var obj = flatToContract_(map, kvRowsToFlat_(data));
  map.children.forEach(function (child) {
    var childData = readSheetData_(ss, child.sheet);
    obj[child.key] = childRowsToItems_(child, childData.headers, childData.rows, null);
  });
  return obj;
}

function getOne_(ss, resource, map, key) {
  var cached = cacheGet_(resource.id, 'get:' + key);
  if (cached !== null) return cached;
  var detail = readDetail_(ss, resource, map, key);
  cachePut_(resource.id, 'get:' + key, detail, ttlOf_(resource));
  return detail;
}

// Detalle fresco SIN pasar por la caché; 404 si la clave no existe.
function readDetail_(ss, resource, map, key) {
  var data = readSheetData_(ss, map.sheet);
  var entries = flatEntries_(map, data);
  var idx = entryIndexOf_(entries, map.keyField, key);
  if (idx === -1) throw apiError_(404, 'No existe: ' + key);
  return assembleFull_(ss, resource, map, entries[idx]);
}

function listCollection_(ss, resource, map) {
  var cached = cacheGet_(resource.id, 'list');
  if (cached !== null) return cached;
  var items = readList_(ss, resource, map);
  cachePut_(resource.id, 'list', items, ttlOf_(resource));
  return items;
}

// Listado: rangos completos → armar → ordenar → proyectar (§2.2 #13).
// De las hojas hijas sólo se leen las que la proyección necesita.
function readList_(ss, resource, map) {
  var data = readSheetData_(ss, map.sheet);
  var entries = flatEntries_(map, data);

  if (map.ordering === 'positioned' && map.positionColumn) {
    entries = entries.slice().sort(function (a, b) {
      var pa = Number(a.flat[map.positionColumn]);
      var pb = Number(b.flat[map.positionColumn]);
      var va = isFinite(pa) ? pa : 1e15; // sin posición válida → al final
      var vb = isFinite(pb) ? pb : 1e15;
      return va - vb;
    });
  }

  // Hijas proyectadas, agrupadas por fk de padre (una sola lectura c/u).
  // Cuáles: del shape de listado si existe; si no, listProjection (F5-2).
  var loadKeys = listLoadKeys_(resource, map);
  var buckets = {};
  map.children.forEach(function (child) {
    if (loadKeys.indexOf(child.key) === -1) return;
    var childData = readSheetData_(ss, child.sheet);
    var grouped = {};
    childData.rows.forEach(function (row) {
      var fk = child.fk ? String(headerValue_(childData.headers, row.values, child.fk)) : '';
      if (!grouped[fk]) grouped[fk] = [];
      grouped[fk].push(row);
    });
    buckets[child.key] = { headers: childData.headers, grouped: grouped };
  });

  return entries.map(function (entry) {
    var obj = flatToContract_(map, entry.flat);
    var parentKey = entry.flat[map.keyField];
    Object.keys(buckets).forEach(function (childKey) {
      var bucket = buckets[childKey];
      var child = childSpec_(map, childKey);
      var fk = child.fk ? String(parentKey) : '';
      obj[childKey] = childRowsToItems_(child, bucket.headers, bucket.grouped[fk] || [], parentKey);
    });
    return projectItem_(resource, obj);
  });
}

// ── Crear ──────────────────────────────────────────────────────────────────

function resourceCreate_(ss, resource, map, request) {
  if (resource.kind === 'singleton') {
    throw apiError_(400, 'Un singleton no se crea: usa PUT /admin/' + resource.id);
  }
  validateHooks_(resource); // falla rápido: antes del lock y de leer filas
  var payload = preparePayload_(resource, request.payload, { isNew: true });

  // Validar ANTES del lock: falla rápido sin retener el recurso (§8).
  var data0 = readSheetData_(ss, map.sheet);
  var entries0 = flatEntries_(map, data0);
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

  return withPolicyLock_(resource, function () {
    var data = readSheetData_(ss, map.sheet);
    var entries = flatEntries_(map, data);
    validateAndThrow_(ss, resource, map, {
      isNew: true,
      key: null,
      scalars: payload,
      incoming: payload,
      current: null,
      children: childrenForValidation_(map, payload, true),
      currentChildren: {}, // no existe el registro ⇒ no hay hijos guardados
      principalRows: entries,
    });

    var rawKey = payload[map.keyField];
    var key = rawKey === undefined || rawKey === null ? '' : String(rawKey);
    if (key === '') {
      throw validationError_([validationIssue_(map.keyField, 'Este campo es obligatorio')]);
    }

    // Fila principal: columnas del payload + posición + campos computados.
    var row = rowValues_(data.headers, contractToFlat_(map, payload));
    if (map.ordering === 'positioned' && map.positionColumn) {
      var positions = entries.map(function (entry) {
        return entry.flat[map.positionColumn];
      });
      setHeaderCell_(
        row,
        data.headers,
        map.positionColumn,
        nextPosition_(positions, map.orderStep),
      );
    }
    map.columns.forEach(function (col) {
      if (col.computed === 'now') setHeaderCell_(row, data.headers, col.flatKey, nowStamp_());
    });
    data.sheet.getRange(data.sheet.getLastRow() + 1, 1, 1, data.headers.length).setValues([row]);

    // Hijas en lote: las que trae el payload (ausentes ⇒ sin filas).
    map.children.forEach(function (child) {
      var items = Object.prototype.hasOwnProperty.call(payload, child.key)
        ? payload[child.key]
        : [];
      writeChildren_(ss, child, key, items);
    });

    var summary = auditSummary_(resource, payload, 'Alta', key);
    auditWrite_(ss, resource, 'create', key, summary);
    cacheInvalidate_(resource.id);
    emitHook_(ss, resource, 'create', key, payload, summary);
    return shapeResponse_(resource, 'create', readDetail_(ss, resource, map, key));
  });
}

// ── Actualizar ─────────────────────────────────────────────────────────────

function resourcePut_(ss, resource, map, request) {
  validateHooks_(resource); // cubre update de colección, de singleton y reorder
  if (resource.kind === 'singleton') return updateSingleton_(ss, resource, map, request);

  var key = request.params[map.keyField];
  var hasKey = key !== undefined && key !== null && String(key) !== '';
  if (!hasKey) {
    // Colección sin clave en la ruta: sólo se acepta la intención de reorder.
    if (request.payload && request.payload.reorder !== undefined) {
      return reorderCollection_(ss, resource, map, request);
    }
    throw apiError_(400, 'Falta la clave del registro en la ruta');
  }
  return updateCollection_(ss, resource, map, request, String(key));
}

function updateCollection_(ss, resource, map, request, key) {
  var payload = preparePayload_(resource, request.payload, { isNew: false });

  // ── Pre-lock: snapshot + validación (falla rápido) ──
  var data0 = readSheetData_(ss, map.sheet);
  var entries0 = flatEntries_(map, data0);
  var idx0 = entryIndexOf_(entries0, map.keyField, key);
  if (idx0 === -1) throw apiError_(404, 'No existe: ' + key);
  var current0 = flatToContract_(map, entries0[idx0].flat);
  // Snapshot de hijos guardados ANTES del lock: los checks que comparan
  // contra lo existente deben poder fallar rápido, como los declarativos.
  var currentChildren0 = readChildren_(ss, map, key);
  validateAndThrow_(ss, resource, map, {
    isNew: false,
    key: key,
    scalars: mergeContract_(map, current0, payload),
    incoming: payload,
    current: current0,
    children: childrenForValidation_(map, payload, false),
    currentChildren: currentChildren0,
    principalRows: entries0,
  });

  return withPolicyLock_(resource, function () {
    // ── Lock: releer TODO y re-validar contra el estado fresco ──
    var data = readSheetData_(ss, map.sheet);
    var entries = flatEntries_(map, data);
    var idx = entryIndexOf_(entries, map.keyField, key);
    if (idx === -1) throw apiError_(404, 'No existe: ' + key);
    var current = flatToContract_(map, entries[idx].flat);
    var children = readChildren_(ss, map, key);
    var merged = mergeContract_(map, current, payload);
    var effective = effectiveChildren_(map, children, payload);
    validateAndThrow_(ss, resource, map, {
      isNew: false,
      key: key,
      scalars: merged,
      incoming: payload,
      current: current,
      children: childrenForValidation_(map, payload, false),
      currentChildren: children, // ya leído en la línea de arriba
      principalRows: entries,
    });

    // Fila principal: guardado crudo ∪ entrante. system/computados NUNCA
    // salen del payload: position se conserva tal cual está guardada.
    var row = {};
    entries[idx].values.forEach(function (value, i) {
      row[data.headers[i]] = value;
    });
    var flatIn = contractToFlat_(map, payload);
    Object.keys(flatIn).forEach(function (h) {
      row[h] = flatIn[h];
    });
    map.columns.forEach(function (col) {
      if (col.computed === 'now') row[col.flatKey] = nowStamp_();
    });
    data.sheet
      .getRange(entries[idx].at, 1, 1, data.headers.length)
      .setValues([rowValues_(data.headers, row)]);

    // Hijas: sólo las que el payload trae (PATCH quirúrgico), en lote.
    map.children.forEach(function (child) {
      if (!Object.prototype.hasOwnProperty.call(payload, child.key)) return;
      writeChildren_(ss, child, key, effective[child.key]);
    });

    var summary = auditSummary_(resource, payload, 'Edición', key);
    auditWrite_(ss, resource, 'update', key, summary);
    cacheInvalidate_(resource.id);
    emitHook_(ss, resource, 'update', key, payload, summary);
    return shapeResponse_(resource, 'update', readDetail_(ss, resource, map, key));
  });
}

function updateSingleton_(ss, resource, map, request) {
  var payload = preparePayload_(resource, request.payload, { isNew: false });

  var data0 = readSheetData_(ss, map.sheet);
  var current0 = flatToContract_(map, kvRowsToFlat_(data0));
  var currentChildren0 = readChildren_(ss, map, null);
  validateAndThrow_(ss, resource, map, {
    isNew: false,
    key: null,
    scalars: mergeContract_(map, current0, payload),
    incoming: payload,
    current: current0,
    children: childrenForValidation_(map, payload, false),
    currentChildren: currentChildren0,
    principalRows: null,
  });

  return withPolicyLock_(resource, function () {
    var data = readSheetData_(ss, map.sheet);
    var current = flatToContract_(map, kvRowsToFlat_(data));
    var children = readChildren_(ss, map, null);
    var merged = mergeContract_(map, current, payload);
    var effective = effectiveChildren_(map, children, payload);

    validateAndThrow_(ss, resource, map, {
      isNew: false,
      key: null,
      scalars: merged,
      incoming: payload,
      current: current,
      children: childrenForValidation_(map, payload, false),
      currentChildren: children,
      principalRows: null,
    });

    writeSingletonBlock_(map, data, merged);

    map.children.forEach(function (child) {
      if (!Object.prototype.hasOwnProperty.call(payload, child.key)) return;
      writeChildren_(ss, child, null, effective[child.key]);
    });

    var summary = auditSummary_(resource, payload, 'Edición', resource.id);
    auditWrite_(ss, resource, 'update', resource.id, summary);
    cacheInvalidate_(resource.id);
    emitHook_(ss, resource, 'update', resource.id, payload, summary);
    return shapeResponse_(resource, 'update', readSingletonDetail_(ss, resource, map));
  });
}

// Reescritura EN LOTE de las filas KV: valor del contrato fusionado,
// preservando type/note existentes y las claves fuera del schema.
function writeSingletonBlock_(map, data, merged) {
  var kIdx = data.headers.indexOf('key');
  var tIdx = data.headers.indexOf('type');
  var nIdx = data.headers.indexOf('note');
  var existing = {};
  data.rows.forEach(function (row) {
    existing[String(row.values[kIdx])] = row.values;
  });

  var known = {};
  var rows = [];
  map.columns.forEach(function (col) {
    known[col.flatKey] = true;
    var old = existing[col.flatKey];
    var value =
      col.computed === 'now' ? nowStamp_() : toCell_(col.field.type, pickPath_(merged, col));
    rows.push(
      rowValues_(data.headers, {
        key: col.flatKey,
        value: value,
        type: old && tIdx !== -1 ? old[tIdx] : col.field.type,
        note: old && nIdx !== -1 ? old[nIdx] : '',
      }),
    );
  });
  data.rows.forEach(function (row) {
    if (!known[String(row.values[kIdx])]) rows.push(row.values);
  });
  writeRowsBlock_(data.sheet, data.headers, rows);
}

// ── Reorden (intención, §9) ────────────────────────────────────────────────

function reorderCollection_(ss, resource, map, request) {
  if (map.ordering !== 'positioned' || !map.positionColumn) {
    throw apiError_(400, 'Este recurso no admite reordenamiento');
  }
  var intent = request.payload.reorder;
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    throw apiError_(400, 'Se espera { reorder: { key, after | toStart | toEnd } }');
  }
  if (intent.key === undefined || intent.key === null || String(intent.key) === '') {
    throw apiError_(400, 'Falta reorder.key');
  }
  var hasAfter = intent.after !== undefined && intent.after !== null && String(intent.after) !== '';
  var hasStart = intent.toStart === true;
  var hasEnd = intent.toEnd === true;
  if (!hasAfter && !hasStart && !hasEnd) {
    throw apiError_(400, 'Indica reorder.after, reorder.toStart o reorder.toEnd');
  }

  return withPolicyLock_(resource, function () {
    var data = readSheetData_(ss, map.sheet);
    var entries = flatEntries_(map, data);
    if (entryIndexOf_(entries, map.keyField, intent.key) === -1) {
      throw apiError_(404, 'No existe: ' + intent.key);
    }
    if (hasAfter && entryIndexOf_(entries, map.keyField, intent.after) === -1) {
      throw validationError_([validationIssue_('reorder.after', 'La referencia no existe')]);
    }

    var items = entries.map(function (entry) {
      var p = Number(entry.flat[map.positionColumn]);
      return {
        key: String(entry.flat[map.keyField]),
        position: isFinite(p) ? p : 0,
        at: entry.at,
      };
    });
    items.sort(function (a, b) {
      return a.position - b.position;
    });

    var normalized = hasAfter
      ? { key: intent.key, after: intent.after }
      : hasStart
        ? { key: intent.key, toStart: true }
        : { key: intent.key, toEnd: true };
    var assigned = applyReorderIntent_(items, normalized, map.orderStep);
    if (assigned === null) throw apiError_(404, 'No existe: ' + intent.key);

    // UNA sola escritura vertical sobre la columna position.
    var posByAt = {};
    assigned.forEach(function (a) {
      posByAt[a.at] = a.position;
    });
    var colIdx = data.headers.indexOf(map.positionColumn);
    var column = data.rows.map(function (row) {
      var pos = posByAt[row.at];
      if (pos === undefined) {
        var raw = Number(row.values[colIdx]);
        pos = isFinite(raw) ? raw : 0;
      }
      return [pos];
    });
    data.sheet.getRange(2, colIdx + 1, column.length, 1).setValues(column);

    var summary = 'Reorden: ' + intent.key;
    auditWrite_(ss, resource, 'reorder', String(intent.key), summary);
    cacheInvalidate_(resource.id);
    emitHook_(ss, resource, 'reorder', String(intent.key), intent, summary);
    return listCollection_(ss, resource, map); // fresco, ya con la caché invalidada
  });
}

// ── Borrar ─────────────────────────────────────────────────────────────────

function resourceDelete_(ss, resource, map, request) {
  if (resource.kind === 'singleton') {
    throw apiError_(400, 'Un singleton no se borra');
  }
  validateHooks_(resource); // falla rápido: antes del lock y de leer filas
  var key = request.params[map.keyField];
  if (key === undefined || key === null || String(key) === '') {
    throw apiError_(400, 'Falta la clave del registro en la ruta');
  }
  key = String(key);

  return withPolicyLock_(resource, function () {
    var data = readSheetData_(ss, map.sheet);
    var entries = flatEntries_(map, data);
    if (entryIndexOf_(entries, map.keyField, key) === -1) {
      throw apiError_(404, 'No existe: ' + key);
    }

    // restrict: nadie puede quedar apuntando a un registro inexistente.
    if (resource.onDelete === 'restrict') {
      var counts = dependentCounts_(ss, resource, map, key);
      var parts = Object.keys(counts).map(function (id) {
        return id + ' (' + counts[id] + ')';
      });
      if (parts.length > 0) {
        throw apiError_(409, 'No se puede borrar: lo referencian ' + parts.join(', '));
      }
    }

    // Hijas propias: siempre mueren con el padre (no serían "dependientes",
    // serían partes suyas — cascade-children de §4).
    map.children.forEach(function (child) {
      writeChildren_(ss, child, key, []);
    });

    var remaining = data.rows
      .filter(function (row) {
        return String(headerValue_(data.headers, row.values, map.keyField)) !== key;
      })
      .map(function (row) {
        return row.values;
      });
    writeRowsBlock_(data.sheet, data.headers, remaining);

    var summary = 'Baja: ' + key;
    var gone = {};
    gone[map.keyField] = key;
    auditWrite_(ss, resource, 'delete', key, summary);
    cacheInvalidate_(resource.id);
    emitHook_(ss, resource, 'delete', key, gone, summary);
    return shapeResponse_(resource, 'delete', { deleted: key });
  });
}

// Registros de OTROS recursos que referencian esta clave (relation FK).
function dependentCounts_(ss, resource, map, key) {
  var counts = {};
  (resource.dependents || []).forEach(function (depId) {
    var dep = getResourceSchema(depId);
    if (dep === null) return;
    var depMap = storageMap_(dep);
    var refs = depMap.columns.filter(function (col) {
      return (
        col.field.type === 'relation' &&
        col.field.resource === resource.id &&
        col.field.valueField === map.keyField
      );
    });
    if (refs.length === 0) return;

    var data = readSheetData_(ss, dep.sheet);
    var seen = {};
    data.rows.forEach(function (row) {
      refs.forEach(function (col) {
        if (String(headerValue_(data.headers, row.values, col.flatKey)) !== key) return;
        var rowKey = String(headerValue_(data.headers, row.values, depMap.keyField));
        if (seen[rowKey]) return; // un registro que apunta dos veces cuenta 1
        seen[rowKey] = true;
        counts[depId] = (counts[depId] || 0) + 1;
      });
    });
  });
  return counts;
}

// ── Helpers de escritura ───────────────────────────────────────────────────

// Clon del payload con: defaults de escalares (SÓLO al crear: en update una
// clave ausente = conservar lo guardado), listas saneadas (ítems sin
// contenido se descartan) y los derivados declarados (operations.create.computed).
function preparePayload_(resource, raw, opts) {
  var isNew = !!(opts && opts.isNew);
  var payload = {};
  var source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  Object.keys(source).forEach(function (k) {
    payload[k] = source[k];
  });

  resource.fields.forEach(function (field) {
    var meta = FIELD_TYPES[field.type] || {};
    if (isNew && meta.storage === 'column' && field.default !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(payload, field.key)) {
        payload[field.key] = field.default;
      }
    } else if (meta.storage === 'child-sheet' && Array.isArray(payload[field.key])) {
      payload[field.key] = sanitizeItems_(field, payload[field.key]);
    }
  });

  computeRules_(resource, payload, { isNew: isNew });
  return payload;
}

// Derivados declarados (F4, mejoras §6):
//   resource.operations.create.computed = [{ field, transform, from, params? }]
// Sólo al crear (los campos immutables tipo slug no se rederivan en update) y
// sólo si el destino viene vacío (un valor entrante se respeta; si el origen
// está vacío, no deriva y el required declarativo lo dice 23-validate).
// Transform no registrado o declaración mal formada = 500 (§16).
function computeRules_(resource, payload, opts) {
  if (!opts || !opts.isNew) return;
  var ops = resource.operations;
  var computed = ops && ops.create && ops.create.computed;
  if (!Array.isArray(computed)) return;
  computed.forEach(function (decl) {
    if (
      !decl ||
      typeof decl.field !== 'string' ||
      typeof decl.transform !== 'string' ||
      typeof decl.from !== 'string'
    ) {
      throw apiError_(500, 'computed mal declarado en ' + resource.id);
    }
    var fn = REGISTRY.transforms && REGISTRY.transforms[decl.transform];
    if (typeof fn !== 'function') {
      throw apiError_(500, 'Transform no registrado: ' + decl.transform);
    }
    if (!isEmptyValue_(payload[decl.field])) return; // el caller definió el valor
    var source = payload[decl.from];
    if (isEmptyValue_(source)) return; // sin origen ⇒ que lo diga 23-validate
    var out = fn(String(source), decl.params);
    if (typeof out === 'string' && out !== '') payload[decl.field] = out;
  });
}

// Hijas a validar según la operación:
// - crear (strict): ausente = [] → dispara required/min de la lista.
// - update (no strict): ausente = "no se tocó" → no se valida.
function childrenForValidation_(map, payload, strict) {
  var out = {};
  map.children.forEach(function (child) {
    if (Object.prototype.hasOwnProperty.call(payload, child.key)) {
      out[child.key] = payload[child.key];
    } else if (strict) {
      out[child.key] = [];
    }
  });
  return out;
}

// Descarta ítems sin contenido: strings en blanco, pares clave/valor
// totalmente vacíos y objetos de `list` donde TODOS sus itemFields están
// vacíos (el front los limpia; acá es donde manda el backend).
function sanitizeItems_(field, items) {
  if (field.type === 'string-list') {
    return items.filter(function (item) {
      return String(item === undefined || item === null ? '' : item).trim() !== '';
    });
  }
  if (field.type === 'key-value') {
    return items.filter(function (item) {
      var k = item && item.key !== undefined && item.key !== null ? String(item.key) : '';
      var v = item && item.value !== undefined && item.value !== null ? String(item.value) : '';
      return k.trim() !== '' || v.trim() !== '';
    });
  }
  // list: un objeto es "sin contenido" si ningún itemFields aporta datos.
  return items.filter(function (item) {
    if (!item || typeof item !== 'object') return true; // no basura: que lo valide 23
    return field.itemFields.some(function (f) {
      var v = item[f.key];
      return v !== undefined && v !== null && String(v).trim() !== '';
    });
  });
}

// Hijas efectivas: si el payload trae la clave, manda él; si no viene,
// se conservan las guardadas (PATCH quirúrgico).
function effectiveChildren_(map, currentChildren, incoming) {
  var out = {};
  map.children.forEach(function (child) {
    out[child.key] = Object.prototype.hasOwnProperty.call(incoming, child.key)
      ? incoming[child.key]
      : currentChildren[child.key];
  });
  return out;
}

// Todas las hojas hijas armadas para un padre (null = singleton, todo).
function readChildren_(ss, map, parentKey) {
  var out = {};
  map.children.forEach(function (child) {
    var data = readSheetData_(ss, child.sheet);
    out[child.key] = childRowsToItems_(child, data.headers, data.rows, parentKey);
  });
  return out;
}

// Reemplazo EN LOTE de una hoja hija dentro del lock (§2.2 #10): UNA
// lectura + UN setValues que sólo sustituye las filas de ESTE padre.
function writeChildren_(ss, child, parentKey, items) {
  var data = readSheetData_(ss, child.sheet);
  var newRows = itemsToRows_(child, data.headers, items || [], parentKey);
  var finalRows = spliceChildRows_(data, child, parentKey, newRows);
  writeRowsBlock_(data.sheet, data.headers, finalRows);
}

// Validación declarativa + checks declarados (corren dentro de
// validatePayload_) → UN SOLO 422 (criterio 8).
function validateAndThrow_(ss, resource, map, opts) {
  var errors = validatePayload_(ss, resource, map, opts);
  if (errors.length > 0) throw validationError_(errors);
}

function setHeaderCell_(row, headers, name, value) {
  var idx = headers.indexOf(name);
  if (idx !== -1) row[idx] = value;
}

function auditWrite_(ss, resource, action, entityKey, summary) {
  // Audit desde policies.audit (F6-1); sin la bandera ⇒ sin traza.
  if (!resource.policies || !resource.policies.audit) return;
  appendAuditRow_(ss, action, resource.id, entityKey, summary);
}

function auditSummary_(resource, payload, prefix, fallback) {
  var title = resource.titleField ? payload[resource.titleField] : undefined;
  var label = isEmptyValue_(title) ? fallback : String(title);
  return prefix + ': ' + label;
}

// ── Hooks: el motor EMITE el evento (refactormotor.md B9) ───────────────────
//
// Antes los eventos de uso sólo se reportaban desde un endpoint declarativo
// (upload-signature): dependía de que el navegador se acordara de llamarlo.
// Con `hooks` la emisión la garantiza EL MOTOR, atada a la escritura.
//
//   resource.hooks = { create: ['<REGISTRY.hooks>', …], update: […],
//                      delete: […], reorder: […] }
//
// Validación EAGER (mismo criterio que validateAndThrow_): una declaración
// rota tira 500 ANTES del lock y ANTES de escribir, así nada queda a medias
// y ningún hook corre si el grupo no está completo.
function validateHooks_(resource) {
  var hooks = resource.hooks;
  if (hooks === undefined || hooks === null) return;
  if (typeof hooks !== 'object' || Array.isArray(hooks)) {
    throw apiError_(500, 'hooks debe ser un objeto: ' + resource.id);
  }
  Object.keys(hooks).forEach(function (action) {
    if (!Array.isArray(hooks[action])) {
      throw apiError_(500, 'hooks.' + action + ' debe ser una lista: ' + resource.id);
    }
    hooks[action].forEach(function (name) {
      if (!REGISTRY.hooks || typeof REGISTRY.hooks[name] !== 'function') {
        throw apiError_(500, 'Hook ausente: ' + String(name));
      }
    });
  });
}

// Post-escritura. Se llama DESPUÉS de cacheInvalidate_ para que un hook
// jamás la esquive. Los errores del hook no deshacen ni enmascaran el
// hecho: la escritura ya es irreversible y el hook es REACCIÓN, no la
// causa — se registran en consola para no ser silenciosos.
function emitHook_(ss, resource, action, key, payload, summary) {
  var hooks = resource.hooks;
  if (!hooks) return;
  var names = hooks[action];
  if (!Array.isArray(names) || names.length === 0) return;
  var ctx = {
    ss: ss,
    resource: resource,
    action: action,
    key: key,
    payload: payload,
    summary: summary,
  };
  names.forEach(function (name) {
    try {
      REGISTRY.hooks[name](ctx);
    } catch (err) {
      console.error(
        '[hooks] ' + action + ' ' + resource.id + '/' + key + ': ' + ((err && err.message) || err),
      );
    }
  });
}
