// capabilities/handlers/pin-regenerate — Regeneración de PIN (Fase 8 · D14).
//
// Resuelto desde `orders.actions['regenerate-pin']` (escape hatch §6:
// POST /admin/orders/:ref/actions/regenerate-pin). Es el cierre de R10:
// antes la única vía era recrear el pedido a mano — el PIN perdido no tenía
// remedio.
//
// Transacción (todo BAJO el lock de política del recurso — `request.resource`
// lo aporta dispatchAction_ en R8.8; sin ese lock dos regeneraciones
// concurrentes podrían intercalarse filas en `_pin`):
//   1. Transform `pin` → PIN nuevo en claro (mismo generador que el create).
//   2. Hash del nuevo en `_pin` (appendRow, par de lo que ya hacía el hook
//      `pinHash` en el create).
//   3. Fila del pedido: columna `pin` ← valor nuevo (writeRowsBlock_).
//   4. Sustitución: las filas activas VIEJAS de este ref quedan usadas
//      (used_at = ahora) — `pin-verify` toma el más reciente NO usado, así
//      que el nuevo gana aunque la vieja quedara sin marcar, pero marcarla
//      evita que dos «activos» convivan y confundan el futuro.
//
// Ventana de fallo residual: si el proceso muere ENTRE el paso 2 y el 3,
// `_pin` tiene el hash nuevo (que es el más reciente y por lo tanto el que
// manda) pero la fila aún muestra el PIN viejo: el viejo recibe 401 y el
// nuevo verifica — fail-closed, nunca acepta algo que no debería. El paso 4
// es limpieza, no corrección: ocurriría después de un fallo así igual.
//
// Auditoría y caché son del handler, NO del dispatch: en la ruta escape
// hatch 28-actions no las regala como sí en la declarativa.
// El PIN en claro viaja en la respuesta — la llamada es admin autenticado y
// el detail-view lo sirve readonly con el mismo criterio; el operador
// necesita el valor para reenviárselo al cliente.

function handlePinRegenerate(payload, request) {
  var resource = request && request.resource ? request.resource : null;
  if (!resource) {
    throw apiError_(500, 'La acción regenerate-pin no recibió el recurso');
  }
  var record = request.record;
  var map = storageMap_(resource);
  var key = record && record[map.keyField] !== undefined ? String(record[map.keyField]) : '';
  if (!key) {
    throw apiError_(400, 'Falta la clave del pedido en la ruta');
  }

  var pin = String(REGISTRY.transforms.pin('', {}));
  if (!pin) {
    throw apiError_(500, 'No se pudo generar el PIN');
  }
  var hash = Props.hashText(pin);
  var now = nowStamp_();

  return withPolicyLock_(resource, function () {
    var ss = openSpreadsheet_();

    // Paso 2 — hash del nuevo PIN en `_pin` (par de pinHash del create).
    var pinSheet = ss.getSheetByName('_pin');
    if (pinSheet === null) {
      throw apiError_(503, 'El sistema de PIN no está configurado');
    }
    pinSheet.appendRow([key, hash, now, '']);

    // Paso 3 — el PIN en claro de la fila del pedido pasa a ser el nuevo.
    var data = readSheetData_(ss, map.sheet);
    var idx = -1;
    for (var i = 0; i < data.rows.length; i++) {
      if (String(headerValue_(data.headers, data.rows[i].values, map.keyField)) === key) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      // No puede pasar: dispatchAction_ ya exigió que la fila existiera.
      throw apiError_(404, 'No existe: ' + key);
    }
    var pinCol = data.headers.indexOf('pin');
    if (pinCol === -1) {
      throw apiError_(500, 'La hoja del pedido no tiene la columna pin');
    }
    data.rows[idx].values[pinCol] = pin;
    writeRowsBlock_(
      data.sheet,
      data.headers,
      data.rows.map(function (row) {
        return row.values;
      }),
    );

    // Paso 4 — sustitución: las filas activas viejas de este ref quedan
    // usadas. `__failed__` no se toca (son intentos, no PINes).
    var pinData = readSheetData_(ss, '_pin');
    var refIdx = pinData.headers.indexOf('ref');
    var hashIdx = pinData.headers.indexOf('pin_hash');
    var usedIdx = pinData.headers.indexOf('used_at');
    if (refIdx === -1 || hashIdx === -1 || usedIdx === -1) {
      throw apiError_(500, 'La hoja _pin no tiene las columnas esperadas');
    }
    pinData.rows.forEach(function (row) {
      if (String(row.values[refIdx]) !== key) return;
      if (String(row.values[hashIdx]) === '__failed__') return;
      if (String(row.values[usedIdx] || '').trim() !== '') return; // ya usada
      if (String(row.values[hashIdx]) === hash) return; // es la del nuevo
      pinData.sheet.getRange(row.at, usedIdx + 1).setValue(now);
    });

    auditWrite_(ss, resource, 'action:regenerate-pin', key, 'PIN regenerado: ' + key);
    cacheInvalidate_(resource.id);

    return { ok: true, ref: key, pin: pin };
  });
}

registerCapability('handlers', {
  id: 'handlePinRegenerate',
  since: '1.0',
  argsSchema: null,
  run: handlePinRegenerate,
});
