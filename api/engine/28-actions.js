// api/engine/25-actions.js — Acciones de dominio declaradas (B3 · R5.4).
//
// Una acción NO es una operación CRUD: es un cambio de dominio con NOMBRE,
// declarado en `resource.actions` y publicado SOLO como
//   POST /admin/<recurso>/<clave>/actions/<nombre>
// que es exactamente la ruta que el front arma en `descriptors.ts` (R3.12)
// para `action.type: 'trigger'`. El back no la inventa ni la redirige: la
// resuelve desde la misma declaración que alimenta `/admin/schema`.
//
// Dos formas, MUTUAMENTE EXCLUYENTES (lo valida el arranque):
//
//   · Declarativa — `{ from: ['ready'], set: { status: 'delivered' } }`:
//     el motor lee la fila, comprueba que el campo esté en `from` y escribe
//     `set`. Es el «marcar como entregado» de B3 sin una línea de código.
//   · Escape hatch §6 — `{ handler: '<REGISTRY.handlers>' }`: código a
//     medida con el MISMO contrato que un endpoint: recibe
//     `(payload, request)` y `request` lleva `action` y `record`.
//
// `hooks: ['onDelivered']` corre después del cambio (mismo contrato que
// `emitHook_`: el hook que revienta se loguea y no tumba la acción).
// `access: 'role:editor'` es el FRENTE real de la acción: el router ya pasó
// por el `write` del recurso, y éste puede ser más exigente todavía.
//
// Fail-closed en todo: acción sin declarar ⇒ 404 · fila inexistente ⇒ 404 ·
// `from` que no coincide ⇒ **409** (la fila cambió mientras el front la
// miraba) · handler inexistente ⇒ 500.

// Acción declarada, o null si no lo está (mismo contrato que
// `declaredOperation_` de 24-crud).
function declaredAction_(resource, name) {
  var actions = resource.actions;
  if (actions === undefined || actions === null || typeof actions !== 'object') return null;
  var declared = actions[name];
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return null;
  return declared;
}

function dispatchAction_(resource, request) {
  if (resource.kind === 'singleton') {
    throw apiError_(400, 'Un singleton no tiene acciones: ' + resource.id);
  }

  var name = request.action;
  if (name === undefined || name === null || String(name) === '') {
    throw apiError_(400, 'Falta el nombre de la acción en la ruta');
  }
  name = String(name);

  var declared = declaredAction_(resource, name);
  if (declared === null) {
    throw apiError_(404, "No existe la acción '" + name + "' en '" + resource.id + "'");
  }

  // El nivel declarado por la acción manda SOBRE el del recurso: el router
  // ya exigió el `write`, y una acción puede exigir todavía más.
  if (typeof declared.access === 'string' && declared.access !== '') {
    requireAccess_(request.user, declared.access);
  }

  var map = storageMap_(resource);
  var key = request.params ? request.params[map.keyField] : undefined;
  if (key === undefined || key === null || String(key) === '') {
    throw apiError_(400, 'Falta la clave del registro en la ruta');
  }
  key = String(key);

  var ss = openSpreadsheet_();
  var data = readSheetData_(ss, map.sheet);
  var entries = flatEntries_(map, data);
  if (entryIndexOf_(entries, map.keyField, key) === -1) {
    throw apiError_(404, 'No existe: ' + key);
  }
  var idx = data.rows.findIndex(function (row) {
    return String(headerValue_(data.headers, row.values, map.keyField)) === key;
  });
  var record = flatToContract_(map, entries[idx].flat);

  // Escape hatch §6: código a medida, contrato idéntico al de un endpoint.
  if (typeof declared.handler === 'string' && declared.handler !== '') {
    var fn =
      (REGISTRY.handlers && REGISTRY.handlers[declared.handler]) || globalThis[declared.handler];
    if (typeof fn !== 'function') {
      throw apiError_(500, 'Función no disponible: ' + declared.handler);
    }
    request.action = name;
    request.record = record;
    var fromHandler = fn(request.payload, request);
    emitActionHooks_(ss, resource, declared, name, key, record);
    return {
      action: name,
      affected: key,
      handler: declared.handler,
      result: fromHandler === undefined ? null : fromHandler,
    };
  }

  // Declarativa: `from` es la garantía de que la fila sigue donde el front
  // la vio. El 409 (no 400) es a propósito: no es un error del usuario,
  // es el mundo cambiando por debajo de la vista.
  var setKeys = Object.keys(declared.set || {});
  var field = setKeys[0];
  if (declared.from !== undefined && declared.from !== null) {
    if (declared.from.indexOf(record[field]) === -1) {
      throw apiError_(
        409,
        "La acción '" + name + "' no corresponde a " + field + " = '" + String(record[field]) + "'",
      );
    }
  }

  // La fila se escribe COMPLETA (writeRowsBlock_) y sólo cambian las
  // columnas de `set`: el resto viaja tal cual, así que una acción no puede
  // «limpiar» otras columnas por accidente.
  setKeys.forEach(function (setField) {
    var col = data.headers.indexOf(setField);
    if (col === -1) {
      // La columna no existe en la hoja: el schema la declara y el drift
      // check la va a encontrar igual, pero acá sería escribir en el vacío.
      throw apiError_(
        500,
        "La acción '" + name + "' escribe '" + setField + "' y falta la columna",
      );
    }
    data.rows[idx].values[col] = declared.set[setField];
  });
  writeRowsBlock_(
    data.sheet,
    data.headers,
    data.rows.map(function (row) {
      return row.values;
    }),
  );

  // La respuesta nace de lo ESCRITO (B4): `changes` es el `set` declarado,
  // ya aplicado a la fila que el front va a recargar.
  var changes = {};
  setKeys.forEach(function (setField) {
    changes[setField] = declared.set[setField];
  });
  record = Object.assign({}, record, changes);

  var summary = 'Acción ' + name + ': ' + key;
  auditWrite_(ss, resource, 'action:' + name, key, summary);
  cacheInvalidate_(resource.id);
  emitActionHooks_(ss, resource, declared, name, key, record);
  return { action: name, affected: key, changes: changes };
}

// Los hooks de la acción corren por el MISMO runner que los del recurso
// (30-events, R5.6): orden declarado y política onError por entrada. Un
// hook roto se ve en el log sin invalidar el cambio ya escrito (acción
// = post-escritura).
function emitActionHooks_(ss, resource, declared, name, key, record) {
  var names = declared.hooks;
  if (!Array.isArray(names) || names.length === 0) return;
  runHookList_(
    ss,
    resource,
    names,
    { key: key, payload: record, summary: 'Acción ' + name },
    'action:' + name,
  );
}
