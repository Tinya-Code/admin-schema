// engine/21-repo — Lectura y escritura de hojas POR RANGOS (api.md §7).
//
// Nunca celda por celda: un getRange/setValues por operación y todo el
// trabajo en memoria. El mapeo fila ↔ objeto es por NOMBRE de cabecera,
// así que el orden de las columnas en la hoja es irrelevante para el
// motor (se reordenan/insertan y el CRUD sigue funcionando).
// Top-level: sólo declaraciones.

// ── Lectura ────────────────────────────────────────────────────────────────

// Hoja completa → { sheet, headers, rows: [{ at, values }] }.
//   - `at`    = fila física 1-based (para escribir de vuelta exacto).
//   - rows    = sin la cabecera y sin filas totalmente vacías.
// Si falta la hoja, el esquema está mal aplicado → 500 con su nombre.
function readSheetData_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (sheet === null) throw apiError_(500, 'Falta la hoja: ' + sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return { sheet: sheet, headers: lastCol < 1 ? [] : headerRow_(sheet, lastCol), rows: [] };
  }
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (v) {
    return String(v);
  });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    if (rowIsEmpty_(values[r])) continue;
    rows.push({ at: r + 1, values: values[r] });
  }
  return { sheet: sheet, headers: headers, rows: rows };
}

// Sólo cabecera (hoja sin datos).
function headerRow_(sheet, lastCol) {
  return sheet
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .map(function (v) {
      return String(v);
    });
}

// ¿La fila no aporta datos? '' / null / undefined / false no cuentan:
// una casilla checkbox vacía en una fila huérfana no la convierte en dato.
function rowIsEmpty_(row) {
  for (var i = 0; i < row.length; i++) {
    var v = row[i];
    if (v !== '' && v !== null && v !== undefined && v !== false) return false;
  }
  return true;
}

// Valor de una celda por NOMBRE de cabecera.
function headerValue_(headers, row, name) {
  var idx = headers.indexOf(name);
  return idx === -1 ? undefined : row[idx];
}

// ¿Una celda representa TRUE? (casilla de Sheets y texto legado).
function truthyCell_(value) {
  return value === true || String(value).toUpperCase() === 'TRUE';
}

// Filas → entradas planas: { flat: {claveColumna: crudo}, at, values }.
function flatEntries_(map, data) {
  return data.rows.map(function (row) {
    var flat = {};
    for (var i = 0; i < data.headers.length; i++) {
      flat[data.headers[i]] = row.values[i];
    }
    return { flat: flat, at: row.at, values: row.values };
  });
}

// Índice de la entrada cuyo `column` coincide con `value` (-1 si no).
function entryIndexOf_(entries, column, value) {
  var wanted = String(value);
  for (var i = 0; i < entries.length; i++) {
    if (String(entries[i].flat[column]) === wanted) return i;
  }
  return -1;
}

// ── Escritura ──────────────────────────────────────────────────────────────

// Objeto plano {columna: valor} → arreglo alineado a headers (faltantes '' ).
function rowValues_(headers, flat) {
  return headers.map(function (h) {
    var v = flat[h];
    return v === undefined || v === null ? '' : v;
  });
}

// Escribe el bloque COMPLETO de datos de la hoja en un solo setValues y
// limpia el remanente: un reemplazo nunca deja filas fantasma debajo.
function writeRowsBlock_(sheet, headers, rows) {
  var colCount = headers.length;
  var oldCount = Math.max(sheet.getLastRow() - 1, 0); // antes de crecer
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, colCount).setValues(rows);
  }
  var leftover = oldCount - rows.length;
  if (leftover > 0) {
    sheet.getRange(2 + rows.length, 1, leftover, colCount).clearContent();
  }
}

// Reemplazo EN LOTE de las filas de UN padre dentro de su hoja hija
// (baseapi §2.2 #10): se conservan las de otros padres en su orden
// relativo y las de ESTE padre se sustituyen en su primera posición
// (o al final, si es nuevo). Sin fk (singleton): el sheet es todo suyo.
// Devuelve las filas finales; quien llama hace UN writeRowsBlock_ dentro
// del lock.
function spliceChildRows_(data, child, parentKey, newRows) {
  var keep = [];
  var insertAt = -1;
  var i;
  for (i = 0; i < data.rows.length; i++) {
    var mine = true;
    if (child.fk) {
      mine =
        String(headerValue_(data.headers, data.rows[i].values, child.fk)) === String(parentKey);
    }
    if (mine) {
      if (insertAt === -1) insertAt = keep.length;
    } else {
      keep.push(data.rows[i].values);
    }
  }
  if (insertAt === -1) insertAt = keep.length;
  return keep.slice(0, insertAt).concat(newRows, keep.slice(insertAt));
}

// Ítems de contrato → filas alineadas a headers de la hoja hija.
// El ORDEN del arreglo es la verdad: position denso 1..N (baseapi §9).
function itemsToRows_(child, headers, items, parentKey) {
  return items.map(function (item, i) {
    var flat = {};
    if (child.fk) flat[child.fk] = parentKey;
    if (child.positionField) flat[child.positionField] = i + 1;
    if (child.type === 'key-value') {
      flat[child.keyColumn] = item && item.key !== undefined && item.key !== null ? item.key : '';
      flat[child.valueColumn] =
        item && item.value !== undefined && item.value !== null ? item.value : '';
    } else if (child.type === 'string-list') {
      flat[child.valueColumn] = toCell_(child.itemType, item);
    } else {
      child.itemFields.forEach(function (f) {
        if (item && Object.prototype.hasOwnProperty.call(item, f.key)) {
          flat[f.key] = toCell_(f.type, item[f.key]);
        }
      });
    }
    return rowValues_(headers, flat);
  });
}

// ── Coerción al guardar (contrato JSON → celda) ────────────────────────────

function toCell_(type, value) {
  if (value === undefined || value === null) return '';
  if (type === 'multiselect') {
    if (Array.isArray(value)) {
      return value
        .map(function (v) {
          return String(v);
        })
        .join(',');
    }
    return String(value);
  }
  if (type === 'boolean') return value === true;
  if (type === 'number' || type === 'currency') {
    var n = Number(value);
    return isFinite(n) ? n : '';
  }
  return value;
}

// ── Coerción al leer (celda → contrato JSON) ───────────────────────────────

function fromCell_(type, value) {
  if (value === undefined || value === null) {
    if (type === 'number' || type === 'currency') return null;
    if (type === 'boolean') return false;
    if (type === 'multiselect') return [];
    return '';
  }
  if (type === 'number' || type === 'currency') {
    if (value === '') return null;
    var n = Number(value);
    return isFinite(n) ? n : value;
  }
  if (type === 'boolean') return truthyCell_(value);
  if (type === 'multiselect') {
    if (Array.isArray(value)) return value;
    return String(value)
      .split(',')
      .map(function (v) {
        return v.trim();
      })
      .filter(function (v) {
        return v !== '';
      });
  }
  return value;
}
