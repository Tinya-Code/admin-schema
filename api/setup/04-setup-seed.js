// setup/04-setup-seed — Puebla catálogos y filas iniciales (baseapi §13):
//
//   • _enums         → una columna por lista de valores permitidos
//   • _placeholders  → valores/patrones prohibidos (R8)
//   • singletons     → una fila KV por campo de site_config / legal_config
//     (claves aplanadas con '_'; las hojas hijas NO son filas KV)
//
// Idempotente y NO destructivo: sólo agrega lo que falta; nunca pisa datos
// existentes ni borra filas (api.md §3.6, §3.9–§3.11).

// Punto de entrada: ejecuta los tres seeds y devuelve el resumen.
function setupSeed() {
  var ss = openSpreadsheet_();
  var report = {
    ok: true,
    enumsUpdated: seedEnums_(ss),
    placeholdersUpdated: seedPlaceholders_(ss),
    kvRowsAdded: seedSingletons_(ss),
  };
  Logger.log('✓ setupSeed: ' + JSON.stringify(report));
  return report;
}

// ── Listas verticales (_enums / _placeholders) ────────────────────────────

function seedEnums_(ss) {
  var sheet = ensureAuxSheet_(ss, '_enums');
  var headers = getHeaders_(sheet);
  var updated = [];
  Object.keys(SHEET_ENUMS).forEach(function (key) {
    var status = seedColumnList_(sheet, headers, key, SHEET_ENUMS[key]);
    if (status === 'missing') {
      throw new Error('Falta la columna "' + key + '" en _enums; corre setupSheets primero.');
    }
    if (status === 'written') updated.push(key);
  });
  return updated;
}

function seedPlaceholders_(ss) {
  var sheet = ensureAuxSheet_(ss, '_placeholders');
  var status = seedColumnList_(sheet, getHeaders_(sheet), 'pattern', PLACEHOLDER_PATTERNS);
  if (status === 'missing') {
    throw new Error('Falta la columna "pattern" en _placeholders; corre setupSheets primero.');
  }
  return status === 'written' ? ['pattern'] : [];
}

// Crea la hoja auxiliar si no existe todavía (orden de corrida flexible).
function ensureAuxSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (sheet !== null) return sheet;
  ensureSheet_(ss, sheetSpec_(name));
  return ss.getSheetByName(name);
}

// Escribe la lista vertical bajo el header dado. Devuelve:
//   'ok' (ya coincidía) · 'written' (se escribió) · 'missing' (sin columna)
function seedColumnList_(sheet, headers, columnName, values) {
  var index = headers.indexOf(columnName);
  if (index === -1) return 'missing';
  var colIndex = index + 1;
  var lastRow = sheet.getLastRow();
  var existing =
    lastRow > 1
      ? sheet
          .getRange(2, colIndex, lastRow - 1, 1)
          .getValues()
          .map(function (row) {
            return row[0];
          })
      : [];
  while (
    existing.length > 0 &&
    (existing[existing.length - 1] === '' || existing[existing.length - 1] === null)
  ) {
    existing.pop();
  }

  var same =
    existing.length === values.length &&
    existing.every(function (v, i) {
      return String(v) === String(values[i]);
    });
  if (same) return 'ok';

  if (existing.length > 0) sheet.getRange(2, colIndex, existing.length, 1).clearContent();
  sheet.getRange(2, colIndex, values.length, 1).setValues(
    values.map(function (v) {
      return [v];
    }),
  );
  return 'written';
}

// ── Filas KV de los singletons ────────────────────────────────────────────

// Filas esperadas: escalares + grupos aplanados con '_'.
// Los campos 'child-sheet' (hours, social) viven en sus propias hojas.
function singletonKvRows_(resource) {
  var rows = [];
  resource.fields.forEach(function (field) {
    var storage = (FIELD_TYPES[field.type] || {}).storage;
    if (storage === 'column') {
      rows.push({ key: field.key, type: field.type, def: field.default });
    } else if (storage === 'group') {
      field.fields.forEach(function (sub) {
        rows.push({
          key: field.key + '_' + sub.key,
          type: sub.type,
          def: sub.default,
        });
      });
    }
  });
  return rows;
}

// Agrega las filas KV que falten en cada singleton. [key, value, type, note].
function seedSingletons_(ss) {
  var added = [];
  Object.keys(REGISTRY.resources).forEach(function (id) {
    var resource = getResourceSchema(id);
    if (resource.kind !== 'singleton') return;

    var sheet = ss.getSheetByName(resource.sheet);
    if (sheet === null) {
      ensureSheet_(ss, sheetSpec_(resource.sheet));
      sheet = ss.getSheetByName(resource.sheet);
    }

    var keyIndex = getHeaders_(sheet).indexOf('key');
    if (keyIndex === -1) {
      throw new Error(
        'Falta la columna "key" en ' + resource.sheet + '; corre setupSheets primero.',
      );
    }

    var existing = {};
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet
        .getRange(2, keyIndex + 1, lastRow - 1, 1)
        .getValues()
        .forEach(function (row) {
          var key = String(row[0] === null || row[0] === undefined ? '' : row[0]).trim();
          if (key !== '') existing[key] = true;
        });
    }

    var count = 0;
    singletonKvRows_(resource).forEach(function (row) {
      if (existing[row.key]) return; // ya existe: NO se pisa
      sheet.appendRow([row.key, row.def === undefined ? '' : row.def, row.type, '']);
      count++;
    });
    if (count > 0) added.push({ sheet: resource.sheet, count: count });
  });
  return added;
}
