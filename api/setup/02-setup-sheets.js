// setup/02-setup-sheets — Crea/actualiza las hojas del libro a partir de
// schema/ (baseapi §13): las columnas NUNCA se hardcodean, salen del schema.
//
// Contiene además los helpers compartidos que también usan
// 03-setup-drift y 04-setup-seed (sufijo `_`; se resuelven en runtime).
// Idempotente: 2ª corrida ⇒ 0 hojas nuevas, 0 cabeceras reescritas.

// ── Helpers de acceso ─────────────────────────────────────────────────────

// Abre el libro indicado en SPREADSHEET_ID (error claro si falta).
function openSpreadsheet_() {
  return SpreadsheetApp.openById(Props.require('SPREADSHEET_ID'));
}

// Spec completo de una hoja por nombre (null si no existe en el schema).
function sheetSpec_(name) {
  var specs = getSheetSpecs_();
  for (var i = 0; i < specs.length; i++) {
    if (specs[i].name === name) return specs[i];
  }
  return null;
}

// Cabeceras de la fila 1 ([] si la hoja está vacía; ignora celdas vacías).
function getHeaders_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return [];
  var row = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  return row
    .map(function (v) {
      return v === null || v === undefined ? '' : String(v).trim();
    })
    .filter(function (v) {
      return v !== '';
    });
}

// ── Construcción de specs desde schema/ ───────────────────────────────────

// Especificación de columna: nombre + tipo del catálogo + formato de celda
// ('text' → Texto plano, 'checkbox' → casilla) + validación de datos.
function colSpec_(name, type) {
  var meta = FIELD_TYPES[type] || { storage: 'column' };
  return { name: name, type: type, format: meta.sheetFormat || null, validation: null };
}

// colSpec desde un field del schema. El enum sólo aplica a `select`;
// el `multiselect` es CSV ('mon,tue') y no admite validación por celda
// (lo valida engine/23 al guardar).
function fieldColSpec_(field) {
  var spec = colSpec_(field.key, field.type);
  if (field.type === 'select' && field.enum && SHEET_ENUMS[field.enum]) {
    spec.validation = { kind: 'enum', list: SHEET_ENUMS[field.enum] };
  }
  return spec;
}

// Grupos en una COLECCIÓN → columnas con prefijo (address_street).
// En singletons los grupos no son columnas: son filas KV (ver setup/04).
function groupColSpecs_(field) {
  return field.fields.map(function (sub) {
    return fieldColSpec_({ key: field.key + '_' + sub.key, type: sub.type, enum: sub.enum });
  });
}

// Columnas de una hoja hija: FK + position + (itemFields | par clave/valor |
// columna de valor) + extraColumns. Orden derivado del schema (api.md §3.3–§3.8).
function childColSpecs_(field) {
  var specs = [];
  if (field.fk) specs.push(colSpec_(field.fk, 'text')); // FK: slug del padre
  if (field.positionField) specs.push(colSpec_(field.positionField, 'number'));
  if (field.type === 'key-value') {
    specs.push(colSpec_(field.keyColumn, 'text'));
    specs.push(colSpec_(field.valueColumn, 'text'));
  } else if (field.type === 'string-list') {
    specs.push(colSpec_(field.valueColumn, field.itemType || 'text'));
  } else {
    field.itemFields.forEach(function (f) {
      specs.push(fieldColSpec_(f));
    });
  }
  (field.extraColumns || []).forEach(function (f) {
    specs.push(fieldColSpec_(f));
  });
  return specs;
}

// Columnas de la hoja principal: colección → escalares (y grupos con prefijo);
// singleton → columnas clave/valor (kvColumns).
function principalColSpecs_(resource) {
  if (resource.kind === 'singleton') {
    return resource.kvColumns.map(function (name) {
      return colSpec_(name, 'text');
    });
  }
  var specs = [];
  resource.fields.forEach(function (field) {
    var storage = (FIELD_TYPES[field.type] || {}).storage;
    if (storage === 'column') specs.push(fieldColSpec_(field));
    else if (storage === 'group') specs = specs.concat(groupColSpecs_(field));
    // 'child-sheet' → tiene su propia hoja (spec aparte)
  });
  return specs;
}

// Specs de TODAS las hojas: principal + hijas por recurso, y las auxiliares.
// Fuente única: REGISTRY.resources (schema/) + schema/05-aux-sheets.
//
// Guard de storage (refactormotor.md B12): un recurso SIN `sheet` no tiene storage ⇒ no se le
// crea ninguna hoja. Hace falta porque el descriptor del dashboard vive en
// registry.ts (paridad exigida por contract-check.mjs:229) pero no persiste
// filas; sin este guard specs.push({ name: undefined }) llegaba a
// setupSheets/setupDrift y a getSheetByName(undefined). Las hijas tampoco:
// necesitan la clave de una fila que no existe.
function getSheetSpecs_() {
  var specs = [];
  Object.keys(REGISTRY.resources).forEach(function (id) {
    var resource = getResourceSchema(id);
    if (!resource.sheet) return; // descriptor sin storage: sin hoja
    specs.push({
      name: resource.sheet,
      kind: resource.kind,
      colSpecs: principalColSpecs_(resource),
    });
    resource.fields.forEach(function (field) {
      if ((FIELD_TYPES[field.type] || {}).storage === 'child-sheet') {
        specs.push({ name: field.sheet, kind: 'child', colSpecs: childColSpecs_(field) });
      }
    });
  });
  AUX_SHEET_ORDER.forEach(function (name) {
    specs.push({
      name: name,
      kind: 'aux',
      colSpecs: auxSheetColumns(name).map(function (colName) {
        return colSpec_(colName, 'text');
      }),
    });
  });
  return specs;
}

// ── Aplicación a la hoja ──────────────────────────────────────────────────

// Formato de celda + validación de UNA columna (idempotente).
//   'text'     → '@' Texto plano (slugs, teléfonos, RUC, HH:mm…)
//   'checkbox' → formato CHECKBOX (boolean TRUE/FALSE)
//   enum       → lista de Sheets que RECHAZA valores fuera de la lista
function applyColumnStyle_(sheet, colSpec, colIndex) {
  var dataRows = Math.max(sheet.getLastRow() - 1, 1000); // cubre datos + futuro
  var range = sheet.getRange(2, colIndex, dataRows, 1);
  if (colSpec.format === 'text') range.setNumberFormat('@');
  if (colSpec.format === 'checkbox') range.setNumberFormat('CHECKBOX');
  if (colSpec.validation && colSpec.validation.kind === 'enum') {
    range.setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(colSpec.validation.list, true)
        .setAllowInvalid(false)
        .build(),
    );
  }
}

// Estilos de todas las columnas del spec, ubicadas POR NOMBRE de cabecera
// (el orden de columnas es irrelevante, baseapi §14).
function applyStyles_(sheet, colSpecs) {
  var headers = getHeaders_(sheet);
  colSpecs.forEach(function (col) {
    var index = headers.indexOf(col.name);
    if (index === -1) return; // la agrega setup/03-setup-drift
    applyColumnStyle_(sheet, col, index + 1);
  });
}

// Protege la fila 1 (cabecera). Si ya hay protección, no duplica nada.
function protectHeader_(sheet) {
  if (sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).length > 0) return false;
  sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
    .protect()
    .setDescription('Cabecera — protegida por setup');
  return true;
}

// Garantiza hoja + cabeceras + estilos + protección. Devuelve el resultado.
function ensureSheet_(ss, spec) {
  var sheet = ss.getSheetByName(spec.name);
  var created = false;
  if (sheet === null) {
    sheet = ss.insertSheet(spec.name);
    created = true;
  }
  var headersWritten = false;
  if (getHeaders_(sheet).length === 0) {
    sheet.getRange(1, 1, 1, spec.colSpecs.length).setValues([
      spec.colSpecs.map(function (c) {
        return c.name;
      }),
    ]);
    headersWritten = true;
  }
  applyStyles_(sheet, spec.colSpecs);
  protectHeader_(sheet);
  return { name: spec.name, created: created, headersWritten: headersWritten };
}

// Borra la hoja inicial (Sheet1 / Hoja1) sólo si está vacía y hay otras.
function removeDefaultSheetIfEmpty_(ss) {
  var sheets = ss.getSheets();
  if (sheets.length <= 1) return null;
  for (var i = 0; i < sheets.length; i++) {
    if (/^(Sheet1|Hoja1)$/.test(sheets[i].getName()) && sheets[i].getLastRow() === 0) {
      var name = sheets[i].getName();
      ss.deleteSheet(sheets[i]);
      return name;
    }
  }
  return null;
}

// ── Punto de entrada ──────────────────────────────────────────────────────

function setupSheets() {
  var ss = openSpreadsheet_();
  var specs = getSheetSpecs_();
  var results = specs.map(function (spec) {
    return ensureSheet_(ss, spec);
  });
  var removedDefault = removeDefaultSheetIfEmpty_(ss);

  var created = results
    .filter(function (r) {
      return r.created;
    })
    .map(function (r) {
      return r.name;
    });
  Logger.log(
    '✓ setupSheets: ' +
      specs.length +
      ' hojas · nuevas: [' +
      created.join(', ') +
      ']' +
      (removedDefault ? ' · borrada: ' + removedDefault : ''),
  );
  return { ok: true, created: created, removedDefault: removedDefault, sheets: results };
}
