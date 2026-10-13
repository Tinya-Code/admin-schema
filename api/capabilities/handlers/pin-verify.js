// capabilities/handlers/pin-verify — Verificación pública de PIN de autorización (Fase 5).
//
// Resuelto desde `REGISTRY.endpoints.pinVerify` (POST /p/pin/:ref).
// Flujo:
//   1. Lee la hoja auxiliar `_pin` buscando filas para el `ref`.
//   2. Config del singleton (`pickpass_config`): si `pin_enabled` = NO → 404.
//   3. Si no hay PIN configurado → 404 (el pedido no requiere PIN).
//   4. Estado del pedido: distinto de PENDIENTE → 403 (ya no admite retiro).
//   5. Si el PIN ya fue usado → 409 (ya consumido).
//   6. TTL (R8.9 · D12): `created_at` + `pin_ttl_hours` vencido → 410.
//   7. Verifica el hash SHA-256 del PIN recibido contra `pin_hash` almacenado.
//   8. Si el PIN no coincide → 401.
//   9. Marca `used_at` en la fila correspondiente → 200 { ok: true }.
//
// Seguridad:
//   - NUNCA comparación en texto plano: sólo SHA-256 (Props.hashText).
//   - El PIN recibido no se registra ni se loguea.
//   - Rate-limit declarado en el endpoint (5/min) — defensa en profundidad.
//
// Precedente de acceso a hoja auxiliar: `appendAuditRow_` (50-audit.js).

// Intentos fallidos que bloquean el pedido DENTRO de la ventana. La ventana
// es la MISMA que declara el endpoint (`limits: '5/min'`): antes el contador
// era para siempre, así que 5 errores — del cliente o de un tercero que
// conociera el ref — mataban el PIN del pedido de forma irreversible y había
// que borrar filas de `_pin` a mano.
var PIN_MAX_ATTEMPTS_ = 5;
var PIN_ATTEMPT_WINDOW_MS_ = 60 * 1000;

// Sello 'YYYY-MM-DD HH:mm:ss' (formato fijo de nowStamp_) → ms.
// Date.UTC sobre AMBOS sellos: se comparan dos marcas del mismo reloj
// local, así el timezone del runtime no entra en la resta. Sello ilegible ⇒
// NaN, que el llamador trata como fail-closed (se cuenta el intento).
function pinStampMs_(stamp) {
  // Sheets puede interpretar el texto de appendRow como fecha; getValues()
  // entonces devuelve Date y String(Date) ya no conserva el formato anterior.
  if (stamp instanceof Date) {
    if (!isFinite(stamp.getTime())) return NaN;
    return Date.UTC(
      stamp.getFullYear(),
      stamp.getMonth(),
      stamp.getDate(),
      stamp.getHours(),
      stamp.getMinutes(),
      stamp.getSeconds(),
    );
  }
  var match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(String(stamp || ''));
  if (!match) return NaN;
  var ms = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]);
  var parsed = new Date(ms);
  if (
    parsed.getUTCFullYear() !== +match[1] ||
    parsed.getUTCMonth() !== +match[2] - 1 ||
    parsed.getUTCDate() !== +match[3] ||
    parsed.getUTCHours() !== +match[4] ||
    parsed.getUTCMinutes() !== +match[5] ||
    parsed.getUTCSeconds() !== +match[6]
  ) {
    return NaN;
  }
  return ms;
}

function handlePinVerify(payload, request) {
  var ref =
    request && request.params && request.params.ref
      ? String(request.params.ref).trim()
      : payload && payload.ref
        ? String(payload.ref).trim()
        : '';
  return withLock_('pin:' + ref, function () {
    return handlePinVerifyLocked_(payload, request);
  });
}

function handlePinVerifyLocked_(payload, request) {
  var ref =
    request && request.params && request.params.ref
      ? String(request.params.ref).trim()
      : payload && payload.ref
        ? String(payload.ref).trim()
        : '';
  if (!ref) {
    throw apiError_(400, 'Falta la referencia del pedido en la ruta', null, 'PIN_INPUT_REQUIRED');
  }

  var pin =
    payload && payload.pin !== undefined && payload.pin !== null ? String(payload.pin).trim() : '';
  if (!pin) {
    throw apiError_(
      400,
      'Falta el campo pin en el cuerpo de la solicitud',
      null,
      'PIN_INPUT_REQUIRED',
    );
  }

  var ss = openSpreadsheet_();
  var sheet = ss.getSheetByName('_pin');
  if (sheet === null) {
    throw apiError_(503, 'El sistema de PIN no está configurado', null, 'PIN_STORE_UNAVAILABLE');
  }

  // R8.9 (D12): config del singleton — `pickpass_config` es la hoja KV del
  // recurso singleton de PickPass (schema/resources/pickpass.js). Se lee
  // directamente como hoja auxiliar (precedente: `_pin` arriba) porque
  // capabilities/ no resuelve recursos por nombre concreto (§11.1) y este
  // endpoint no tiene endpoint-declaración propia para ese singleton. Los
  // defaults ESPEJAN los del schema (24 / 'SI'): si cambian allá, cambian acá.
  var ttlHours = 24;
  var pinEnabled = true;
  var configSheet = ss.getSheetByName('pickpass_config');
  if (configSheet !== null) {
    var configData = readSheetData_(ss, 'pickpass_config');
    var cKeyIdx = configData.headers.indexOf('key');
    var cValIdx = configData.headers.indexOf('value');
    if (cKeyIdx !== -1 && cValIdx !== -1) {
      for (var c = 0; c < configData.rows.length; c++) {
        var k = String(configData.rows[c].values[cKeyIdx]);
        var v = String(configData.rows[c].values[cValIdx]).trim();
        if (k === 'pin_ttl_hours') {
          var parsedTtl = parseInt(v, 10);
          if (parsedTtl > 0) ttlHours = parsedTtl;
        } else if (k === 'pin_enabled') {
          pinEnabled = v.toUpperCase() !== 'NO';
        }
      }
    }
  }
  if (!pinEnabled) {
    // Mismo 404 que «sin PIN»: el contrato externo no distingue (R8.2 · D12).
    throw apiError_(404, 'No hay PIN configurado para este pedido', null, 'PIN_NOT_AVAILABLE');
  }

  // Lee todas las filas de _pin para este ref.
  var data = readSheetData_(ss, '_pin');
  var headers = data.headers;
  var allRows = data.rows;

  var refIdx = headers.indexOf('ref');
  var hashIdx = headers.indexOf('pin_hash');
  var createdIdx = headers.indexOf('created_at');
  var usedIdx = headers.indexOf('used_at');

  if (refIdx === -1 || hashIdx === -1) {
    throw apiError_(
      500,
      'La hoja _pin no tiene las columnas esperadas',
      null,
      'PIN_CONFIGURATION_ERROR',
    );
  }

  // Filtra las filas de este pedido.
  var pinRows = allRows.filter(function (row) {
    return String(row.values[refIdx]) === ref;
  });

  if (pinRows.length === 0) {
    // No hay PIN configurado para este pedido.
    throw apiError_(404, 'No hay PIN configurado para este pedido', null, 'PIN_NOT_AVAILABLE');
  }

  // R8.9: el pedido sólo admite retiro mientras está PENDIENTE. El recurso
  // se resuelve desde la endpoint-declaración (mismo patrón que
  // public-order.js) — capabilities/ no nombra recursos concretos (§11.1).
  var endpointDecl = REGISTRY.endpoints.pinVerify || {};
  var resourceId = typeof endpointDecl.resource === 'string' ? endpointDecl.resource : '';
  if (!resourceId) {
    throw apiError_(500, 'Recurso no configurado en el endpoint', null, 'PIN_CONFIGURATION_ERROR');
  }
  var resource = getResourceSchema(resourceId);
  if (!resource) {
    throw apiError_(500, 'Recurso ausente: ' + resourceId, null, 'PIN_CONFIGURATION_ERROR');
  }
  var map = storageMap_(resource);
  var orderData = readSheetData_(ss, map.sheet);
  var keyIdx = orderData.headers.indexOf(map.keyField);
  var statusIdx = orderData.headers.indexOf('status');
  if (keyIdx === -1 || statusIdx === -1) {
    throw apiError_(
      500,
      'La hoja del pedido no tiene las columnas esperadas',
      null,
      'PIN_CONFIGURATION_ERROR',
    );
  }
  var orderRow = null;
  for (var r = 0; r < orderData.rows.length; r++) {
    if (String(orderData.rows[r].values[keyIdx]) === ref) {
      orderRow = orderData.rows[r];
      break;
    }
  }
  // Inconsistencia defensiva: filas en _pin sin pedido → no verificar nada.
  if (orderRow === null) {
    throw apiError_(404, 'No hay PIN configurado para este pedido', null, 'PIN_NOT_AVAILABLE');
  }
  if (String(orderRow.values[statusIdx]).trim() !== 'PENDIENTE') {
    throw apiError_(403, 'El pedido ya no admite retiro de PIN', null, 'ORDER_NOT_ELIGIBLE');
  }

  // Toma el PIN activo: el más reciente NO usado (mayor created_at).
  var activeRow = null;
  for (var i = pinRows.length - 1; i >= 0; i--) {
    var usedAt = usedIdx !== -1 ? String(pinRows[i].values[usedIdx]) : '';
    if (!usedAt || usedAt.trim() === '') {
      activeRow = pinRows[i];
      break;
    }
  }

  if (activeRow === null) {
    // Todos los PINes de este pedido ya fueron consumidos.
    throw apiError_(409, 'El PIN de este pedido ya fue utilizado', null, 'PIN_ALREADY_USED');
  }

  // R8.9 (D12): TTL de vigencia — el PIN deja de verificar `pin_ttl_hours`
  // después de created_at. Sello ilegible ⇒ expirado (fail-closed): la
  // ventana se cierra igual que la de los intentos.
  var nowMs = pinStampMs_(nowStamp_());
  var createdMs = pinStampMs_(createdIdx !== -1 ? activeRow.values[createdIdx] : '');
  var ttlMs = ttlHours * 3600 * 1000;
  if (isNaN(createdMs) || nowMs - createdMs > ttlMs) {
    throw apiError_(410, 'El PIN de este pedido expiró', null, 'PIN_EXPIRED');
  }

  // Cuenta intentos fallidos RECIENTES: filas `__failed__` de este ref dentro
  // de la ventana declarada (`limits: '5/min'`), no las de toda la vida.
  var failedAttempts = pinRows.filter(function (row) {
    // `__failed__` lleva used_at para no confundirse con el PIN activo.
    var usedAt = usedIdx !== -1 ? String(row.values[usedIdx]) : '';
    if (!usedAt || usedAt.trim() === '') return false;
    if (String(row.values[hashIdx]) !== '__failed__') return false;
    var atMs = pinStampMs_(createdIdx !== -1 ? row.values[createdIdx] : '');
    if (isNaN(atMs)) return true; // sello ilegible ⇒ no regalar intentos
    return nowMs - atMs <= PIN_ATTEMPT_WINDOW_MS_;
  }).length;

  if (failedAttempts >= PIN_MAX_ATTEMPTS_) {
    throw apiError_(429, 'Demasiados intentos fallidos para este pedido', null, 'RATE_LIMITED');
  }

  // Verifica el hash — NUNCA comparación en texto plano.
  var expectedHash = String(activeRow.values[hashIdx]);
  var receivedHash = Props.hashText(pin);

  if (receivedHash !== expectedHash) {
    // Registra intento fallido en _pin como fila separada con hash '__failed__'.
    sheet.appendRow([ref, '__failed__', nowStamp_(), nowStamp_()]);
    throw apiError_(401, 'PIN incorrecto', null, 'PIN_INVALID');
  }

  var result = { ok: true, ref: ref };
  if (typeof endpointDecl.issuesGrant === 'string') {
    var grant = issueDomainGrantLocked_(
      endpointDecl.issuesGrant,
      ref,
      ref + ':' + String(activeRow.at) + ':' + String(activeRow.values[createdIdx]),
      expectedHash,
    );
    result.grant = grant.grant;
    result.expires_at = grant.expires_at;
  }

  // PIN correcto: marca used_at después de emitir el grant. Si hay fallo
  // entre ambas escrituras, el mismo PIN recupera el bearer derivado al retry.
  if (usedIdx !== -1) {
    var physicalRow = activeRow.at; // fila física 1-based en la hoja
    var usedColPhysical = usedIdx + 1; // columna física 1-based
    sheet.getRange(physicalRow, usedColPhysical).setValue(nowStamp_());
  }

  return result;
}

registerCapability('handlers', {
  id: 'handlePinVerify',
  since: '1.0',
  argsSchema: null,
  run: handlePinVerify,
});

// El hook `pinHash` (lado generador, par de este handler) vive en
// capabilities/hooks: se registra por la puerta única (R3.14).
