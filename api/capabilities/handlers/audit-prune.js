// capabilities/handlers/audit-prune — Poda de `_audit_log` por `retention`
// (R9.5.1, B14). Resuelto desde `REGISTRY.endpoints.auditPrune`
// (schema/endpoints/audit-prune), no por código en el router.
//
// Contrato:
//   DRY-RUN (default) → { ok, dryRun: true,  checked, stale, removed: 0, resources }
//   apply: true       → { ok, dryRun: false, checked, stale, removed, resources }
//
//   · `checked`  → filas de datos leídas (sin la cabecera).
//   · `stale`    → filas que YA vencieron según la retention de su recurso.
//   · `removed`  → filas borradas en esta corrida (0 en dry-run).
//   · `resources`→ ids con `policies.audit.retention` declarado (podados).
//
// Cuatro reglas conservadoras, todas orientadas a que la poda NUNCA sea
// destructiva por accidente (esto borra historia):
//   1. Sólo borra filas de un `entity` que DECLARA retention. El resto de
//      la traza (`auth`, `setup`, la propia poda) no tiene plazo: no toca.
//   2. Una fecha ilegible (no Date, no `YYYY-MM-DD HH:mm:ss`) NO se poda:
//      jamás borrar lo que no se pudo datar.
//   3. Sin `_audit_log` no hay nada que podar y se reporta `ok: false`
//      (fail-loud: la hoja existe en el schema, su ausencia es un drift).
//   4. Toda poda aplicada deja su fila en la misma traza (action `prune`).
//
// Handler: devuelve datos; el envelope lo envuelve core/12-http.

function handleAuditPrune(payload, request) {
  var apply = !!(payload && payload.apply === true);
  var only =
    payload && typeof payload.resource === 'string' && payload.resource.trim() !== ''
      ? payload.resource.trim()
      : null;

  // Retención declarada ⇒ el ÚNICO conjunto de filas podables.
  var retention = auditRetentionDays_();
  var resources = Object.keys(retention);
  if (only !== null && resources.indexOf(only) === -1) {
    var declared = Object.prototype.hasOwnProperty.call(REGISTRY.resources, only);
    throw apiError_(
      400,
      declared
        ? 'El recurso "' + truncate_(only) + '" no declara policies.audit.retention'
        : 'Recurso desconocido: ' + truncate_(only),
    );
  }

  var ss = openSpreadsheet_();
  var sheet = ss.getSheetByName('_audit_log');
  if (sheet === null) {
    // El schema la declara (schema/05) y setupDrift la crea: si no está,
    // esto es un drift y NO un «nada que podar».
    return {
      ok: false,
      dryRun: !apply,
      checked: 0,
      stale: 0,
      removed: 0,
      resources: [],
      reason: 'no existe la hoja _audit_log',
    };
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: true, dryRun: !apply, checked: 0, stale: 0, removed: 0, resources: resources };
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var now = Date.now();
  var staleRows = [];

  values.forEach(function (row, index) {
    var entity = String(row[3] === undefined || row[3] === null ? '' : row[3]);
    if (only !== null && entity !== only) return;
    var days = retention[entity];
    if (!days) return; // regla 1: sin retention declarada ⇒ se conserva
    var stamp = auditStampMs_(row[0]);
    if (isNaN(stamp)) return; // regla 2: sin fecha legible ⇒ se conserva
    if (now - stamp < days * 86400000) return; // aún dentro del plazo
    staleRows.push(index + 2); // fila absoluta en la hoja (cabecera = 1)
  });

  var removed = 0;
  if (apply && staleRows.length > 0) {
    pruneAuditRows_(sheet, staleRows);
    removed = staleRows.length;
    appendAuditRow_(
      ss,
      'prune',
      '_audit_log',
      only || '*',
      'Poda: ' + removed + ' fila(s) vencida(s)',
    );
  }

  return {
    ok: true,
    dryRun: !apply,
    checked: values.length,
    stale: staleRows.length,
    removed: removed,
    resources: only === null ? resources : [only],
  };
}

// Retención declarada ⇒ { '<recurso>': <días> }. La validación de arranque
// (validate-registry) ya garantiza que `retention` es un entero ≥ 1 cuando
// existe; acá se filtra de nuevo porque un registro cargado a mano en un
// test podría no haber pasado por ella.
function auditRetentionDays_() {
  var out = {};
  Object.keys(REGISTRY.resources).forEach(function (id) {
    var resource = REGISTRY.resources[id];
    var audit = resource.policies ? resource.policies.audit : null;
    if (!audit || typeof audit !== 'object') return;
    var days = audit.retention;
    if (typeof days !== 'number' || !isFinite(days) || Math.floor(days) !== days || days < 1) {
      return;
    }
    out[id] = days;
  });
  return out;
}

// Marca de tiempo de una celda del `_audit_log` ⇒ epoch ms.
//
// Dos formas posibles de estar guardada y ambas son legítimas: el
// `nowStamp_()` de 50-audit es texto `YYYY-MM-DD HH:mm:ss`, pero la hoja
// puede haberlo convertido a Date al interpretar la cadena — por eso NO se
// compara texto con texto. Cualquier otra forma (un ISO, un número) pasa por
// Date.parse; lo ilegible ⇒ NaN y la fila queda intacta (regla 2).
function auditStampMs_(value) {
  if (value instanceof Date) {
    var time = value.getTime();
    return isNaN(time) ? NaN : time;
  }
  var text = String(value === undefined || value === null ? '' : value).trim();
  var parsed = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (parsed) {
    // Date explícito: la zona la fija appsscript.json (America/Lima), la
    // misma que usó nowStamp_ para escribirla.
    return new Date(
      +parsed[1],
      +parsed[2] - 1,
      +parsed[3],
      +parsed[4],
      +parsed[5],
      +(parsed[6] || 0),
    ).getTime();
  }
  var fallback = Date.parse(text);
  return isNaN(fallback) ? NaN : fallback;
}

// Borra filas ABSOLUTAS de abajo hacia arriba, en bloques contiguos: borrar
// desde arriba desplazaría el resto y dejaría cada fila en una posición que
// ya no es la que se calculó. Un solo `deleteRows` por bloque (menos llamadas
// a la hoja = menos cuota).
function pruneAuditRows_(sheet, absoluteRows) {
  var index = absoluteRows.length - 1;
  while (index >= 0) {
    var end = absoluteRows[index];
    var start = end;
    index--;
    while (index >= 0 && absoluteRows[index] === start - 1) {
      start = absoluteRows[index];
      index--;
    }
    sheet.deleteRows(start, end - start + 1);
  }
}

registerCapability('handlers', {
  id: 'handleAuditPrune',
  since: '1.0',
  argsSchema: null,
  run: handleAuditPrune,
});
