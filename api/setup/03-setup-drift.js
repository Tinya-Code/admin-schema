// setup/03-setup-drift — Evolución schema ↔ hojas (baseapi §14).
//
//   • hoja o columna del schema ausente → la crea (nunca toca datos)
//   • columna/hoja huérfana             → sólo la REPORTA (renombrados y
//     campos retirados; JAMÁS borra: §14 «la columna no se borra»)
//   • tipo con datos incompatibles      → BLOQUEA (ok:false + el detalle)
//   • SCHEMA_VERSION cambió             → propiedad + fila en _audit_log
// Idempotente: 2ª corrida sin cambios ⇒ report vacío, sin filas nuevas.

// Punto de entrada: aplica lo que el schema exige y reporta lo dudoso.
function setupDrift() {
  var ss = openSpreadsheet_();
  var specs = getSheetSpecs_();
  var report = {
    ok: true,
    createdSheets: [],
    added: [],
    orphans: [],
    blocked: [],
    schemaVersion: null,
    schemaVersionChanged: false,
  };

  specs.forEach(function (spec) {
    var sheet = ss.getSheetByName(spec.name);

    // Hoja inexistente o vacía → crearla/escriturarla y no seguir (sin datos que comparar)
    if (sheet === null || getHeaders_(sheet).length === 0) {
      ensureSheet_(ss, spec);
      report.createdSheets.push(spec.name);
      return;
    }

    // Columnas del schema que faltan → insertar AL FINAL (orden irrelevante, §14)
    spec.colSpecs.forEach(function (col) {
      if (getHeaders_(sheet).indexOf(col.name) !== -1) return;
      // La nueva columna se calcula ANTES de insertar: tras insertar está
      // vacía y getLastColumn() seguiría devolviendo la anterior.
      var colIndex = sheet.getLastColumn() + 1;
      sheet.insertColumnAfter(sheet.getLastColumn());
      sheet.getRange(1, colIndex).setValue(col.name);
      applyColumnStyle_(sheet, col, colIndex);
      report.added.push(spec.name + '.' + col.name);
    });

    // Huérfanas de columnas (renombrado o campo retirado) → reportar, no borrar
    var expected = spec.colSpecs.map(function (c) {
      return c.name;
    });
    getHeaders_(sheet).forEach(function (header) {
      if (expected.indexOf(header) === -1) report.orphans.push(spec.name + '.' + header);
    });

    // Conflictos de tipo con datos existentes → bloquean la corrida
    findTypeConflicts_(sheet, spec).forEach(function (conflict) {
      report.blocked.push(conflict);
    });
  });

  // Hojas del libro que el schema ya no declara (lista hija retirada/renombrada)
  var specNames = specs.map(function (s) {
    return s.name;
  });
  ss.getSheets().forEach(function (sheet) {
    if (specNames.indexOf(sheet.getName()) === -1) report.orphans.push(sheet.getName() + ' (hoja)');
  });

  if (report.blocked.length > 0) report.ok = false;

  // SCHEMA_VERSION + traza (sólo si el hash del schema cambió)
  if (report.ok) {
    var version = updateSchemaVersion_(ss);
    report.schemaVersion = version.version;
    report.schemaVersionChanged = version.changed;
  }

  Logger.log(
    '✓ setupDrift: ' +
      JSON.stringify({
        ok: report.ok,
        createdSheets: report.createdSheets,
        added: report.added,
        orphans: report.orphans,
        blocked: report.blocked,
        schemaVersion: report.schemaVersion,
        schemaVersionChanged: report.schemaVersionChanged,
      }),
  );
  return report;
}

// Datos incompatibles con el TIPO esperado. Sólo number/currency/boolean:
// el resto se lee como texto sin romper nada (§14 «bloqueado si hay datos
// incompatibles»). Devuelve [{ sheet, column, row, value }] — una muestra
// por columna basta para bloquear.
function findTypeConflicts_(sheet, spec) {
  var conflicts = [];
  var headers = getHeaders_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return conflicts;

  spec.colSpecs.forEach(function (col) {
    var numeric = col.type === 'number' || col.type === 'currency';
    var bool = col.type === 'boolean';
    if (!numeric && !bool) return;
    var index = headers.indexOf(col.name);
    if (index === -1) return;

    var values = sheet.getRange(2, index + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      var value = values[i][0];
      if (value === '' || value === null || value === undefined) continue;
      var bad = numeric ? isNaN(Number(value)) : !isBooleanCell_(value);
      if (bad) {
        conflicts.push({
          sheet: spec.name,
          column: col.name,
          row: i + 2,
          value: String(value),
        });
        break; // una muestra por columna
      }
    }
  });
  return conflicts;
}

// Celda booleana: TRUE/FALSE nativo o su texto (checkboxes en Sheets).
function isBooleanCell_(value) {
  if (value === true || value === false) return true;
  var text = String(value).trim().toUpperCase();
  return text === 'TRUE' || text === 'FALSE';
}

// ── SCHEMA_VERSION ────────────────────────────────────────────────────────

// Snapshot estable del schema completo (hash → 16 hex). Si alguien cambia
// un tipo, un enum o un recurso, el hash cambia.
function schemaSnapshot_() {
  return JSON.stringify({
    types: FIELD_TYPES,
    enums: SHEET_ENUMS,
    placeholders: PLACEHOLDER_PATTERNS,
    aux: AUX_SHEETS,
    // .sort(): orden de inserción estable — el snapshot (y por ende
    // SCHEMA_VERSION) no cambia si cambia el orden de auto-registro.
    resources: Object.keys(REGISTRY.resources)
      .sort()
      .map(function (id) {
        return getResourceSchema(id);
      }),
  });
}

function schemaVersion_() {
  return Props.hashText(schemaSnapshot_()).slice(0, 16);
}

// Registra la versión aplicada; si cambió → propiedad + fila de auditoría.
function updateSchemaVersion_(ss) {
  var version = schemaVersion_();
  var previous = Props.get('SCHEMA_VERSION');
  if (previous === version) return { version: version, changed: false };

  Props.setAll({ SCHEMA_VERSION: version });
  appendAuditRow_(
    ss,
    'update',
    'schema',
    'SCHEMA_VERSION',
    (previous === null ? 'sin versión' : previous) + ' → ' + version,
  );
  return { version: version, changed: true };
}

// ── Auditoría ──────────────────────────────────────────────────────────────
// appendAuditRow_ y nowStamp_ viven en 50-audit.js (raíz): la Fase 9 las
// reubica ahí para que setup/ y engine/ compartan UNA sola implementación.
