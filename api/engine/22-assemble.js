// engine/22-assemble — Filas ↔ objetos de contrato (baseapi §2.2 #13, §8).
//
// Convierte lo plano de la hoja en el objeto anidado que consume el front
// (grupos como address.street → { address: { street } }, multiselect CSV →
// [], hijos con el padre SIEMPRE) y aplica la FORMA DE RESPUESTA declarativa
// (F5, mejoras §7): operations.<op>.shape / views.<nombre>.shape →
// pick, include, nest, rename, envelope. Sin shape declarado ⇒ el legacy
// listProjection/listPick sigue siendo el equivalente interno (fallback
// F5-2, se quita en F7 con la migración de todos los recursos).
// `12-http` NO se toca (regla 4): shape.envelope sólo transforma el payload
// que llega a respond_; el envoltorio éxito/error (HTTP 200 siempre) sigue
// siendo suyo. Top-level: sólo declaraciones.

// ── Principal ──────────────────────────────────────────────────────────────

// Hoja singleton (filas KV) → objeto plano {claveAplanada: crudo}.
function kvRowsToFlat_(data) {
  var kIdx = data.headers.indexOf('key');
  var vIdx = data.headers.indexOf('value');
  var flat = {};
  if (kIdx === -1 || vIdx === -1) return flat;
  data.rows.forEach(function (row) {
    flat[String(row.values[kIdx])] = row.values[vIdx];
  });
  return flat;
}

// Objeto plano → objeto de contrato: grupos anidados + coerciones de tipo.
function flatToContract_(map, flat) {
  var out = {};
  map.columns.forEach(function (col) {
    var value = fromCell_(col.field.type, flat[col.flatKey]);
    if (col.group) {
      if (!out[col.group] || typeof out[col.group] !== 'object') out[col.group] = {};
      out[col.group][col.key] = value;
    } else {
      out[col.key] = value;
    }
  });
  return out;
}

// Objeto de contrato → objeto plano para escribir (prefijos de grupo).
// Los campos de sistema/computados quedan FUERA: su valor lo pone el
// backend (position, updated_at). Claves ausentes no se tocan (merge).
function contractToFlat_(map, contract) {
  var flat = {};
  map.columns.forEach(function (col) {
    if (col.system || col.computed) return;
    var raw;
    if (col.group) {
      var group = contract[col.group];
      raw = group && typeof group === 'object' ? group[col.key] : undefined;
    } else {
      raw = contract[col.key];
    }
    if (raw === undefined) return;
    flat[col.flatKey] = toCell_(col.field.type, raw);
  });
  return flat;
}

// Lee un valor del contrato respetando la ruta (col.path: a.b o a).
function pickPath_(contract, col) {
  if (!contract) return undefined;
  if (!col.group) return contract[col.key];
  var group = contract[col.group];
  return group && typeof group === 'object' ? group[col.key] : undefined;
}

// Fusión para actualizar: lo entrante gana por clave (null = vaciar);
// ausente (undefined) ⇒ se conserva lo guardado. System/computados quedan
// en el resultado (los ignora 23-validate) pero la escritura usa el valor
// guardado, así que position nunca se corrompe.
function mergeContract_(map, current, incoming) {
  var out = {};
  map.columns.forEach(function (col) {
    var incomingValue = pickPath_(incoming, col);
    var value = incomingValue !== undefined ? incomingValue : pickPath_(current, col);
    if (col.group) {
      if (!out[col.group] || typeof out[col.group] !== 'object') out[col.group] = {};
      out[col.group][col.key] = value;
    } else {
      out[col.key] = value;
    }
  });
  return out;
}

// ── Hijos ──────────────────────────────────────────────────────────────────

// Filas de la hoja hija → ítems de contrato, ordenados por position.
//   list        → [{…itemFields, position}]
//   string-list → ['https://…']        (una URL por fila, posición interna)
//   key-value   → [{ key, value, position }]
function childRowsToItems_(child, headers, rows, parentKey) {
  var selected = rows.filter(function (row) {
    if (!child.fk) return true;
    return String(headerValue_(headers, row.values, child.fk)) === String(parentKey);
  });
  if (child.positionField) {
    var posIdx = headers.indexOf(child.positionField);
    if (posIdx !== -1) {
      selected = selected.slice().sort(function (a, b) {
        var pa = Number(a.values[posIdx]);
        var pb = Number(b.values[posIdx]);
        return (isFinite(pa) ? pa : 0) - (isFinite(pb) ? pb : 0);
      });
    }
  }
  return selected.map(function (row) {
    var values = row.values;
    if (child.type === 'string-list') {
      return fromCell_(child.itemType, headerValue_(headers, values, child.valueColumn));
    }
    var item = {};
    if (child.type === 'key-value') {
      item.key = headerValue_(headers, values, child.keyColumn);
      item.value = headerValue_(headers, values, child.valueColumn);
    } else {
      child.itemFields.forEach(function (f) {
        item[f.key] = fromCell_(f.type, headerValue_(headers, values, f.key));
      });
    }
    if (child.positionField) {
      var raw = headerValue_(headers, values, child.positionField);
      item[child.positionField] = Number(raw) || 0;
    }
    return item;
  });
}

// ── Armado y proyección ────────────────────────────────────────────────────

// Entrada de la hoja principal → objeto de contrato COMPLETO (con todas
// sus hojas hijas). Es el detalle: el listado usa projectItem_ después.
function assembleFull_(ss, resource, map, entry) {
  var obj = flatToContract_(map, entry.flat);
  var parentKey = entry.flat[map.keyField];
  map.children.forEach(function (child) {
    var data = readSheetData_(ss, child.sheet);
    obj[child.key] = childRowsToItems_(child, data.headers, data.rows, parentKey);
  });
  return obj;
}

// Proyección de LISTADO (baseapi §2.2 #13): operations.list.shape si está
// declarado; si no, el equivalente interno legacy (listProjection en su
// orden declarado). listPick recorta ítems de hijo (images → sólo la
// principal) SIEMPRE: es filtro de fila, no de campos, y el vocabulario
// §7 no tiene equivalente — se quita junto al fallback en F7.
function projectItem_(resource, item) {
  var ops = resource.operations;
  var shape = ops && ops.list ? ops.list.shape : undefined;
  if (!shape && !resource.listProjection) return item;
  var out = {};
  if (shape) {
    out = applyShape_(resource, item, shape);
  } else {
    (resource.listProjection || []).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(item, key)) out[key] = item[key];
    });
  }
  var pick = resource.listPick;
  if (pick) {
    Object.keys(pick).forEach(function (key) {
      if (pick[key] === 'primary' && Array.isArray(out[key])) {
        out[key] = out[key].filter(function (childItem) {
          return childItem && Number(childItem.position) === 1;
        });
      }
    });
  }
  return out;
}

// ── Shape declarativo (F5, mejoras §7) ──────────────────────────────────────
//
// Vocabario: pick ('full' | 'list' | [campos]) · include [hijos] ·
// nest {grupo: [fuentes]} · rename {viejo: nuevo} · envelope ('plain'|'list').
// Pipeline por ítem: selección (pick/include) → nest → rename.
// La forma vive en operations.<op>.shape (op: list|get|create|update|delete)
// o views.<nombre>.shape (la vista manda sobre la del listado). El motor no
// nombra campos: todo sale del schema. Shape mal formado = 500 (§16).

function validateShape_(resource, shape) {
  var id = (resource && resource.id) || '?';
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) {
    throw apiError_(500, 'shape mal declarado en ' + id);
  }
  var pick = shape.pick;
  var pickOk =
    pick === undefined ||
    pick === 'full' ||
    pick === 'list' ||
    (Array.isArray(pick) &&
      pick.every(function (k) {
        return typeof k === 'string';
      }));
  if (!pickOk) throw apiError_(500, "shape.pick debe ser 'full', 'list' o [campos] en " + id);
  var include = shape.include;
  if (
    include !== undefined &&
    (!Array.isArray(include) ||
      !include.every(function (k) {
        return typeof k === 'string';
      }))
  ) {
    throw apiError_(500, 'shape.include debe ser [campos] en ' + id);
  }
  var rename = shape.rename;
  if (
    rename !== undefined &&
    (!rename ||
      typeof rename !== 'object' ||
      Array.isArray(rename) ||
      !Object.keys(rename).every(function (k) {
        return typeof rename[k] === 'string';
      }))
  ) {
    throw apiError_(500, 'shape.rename debe ser {viejo: nuevo} en ' + id);
  }
  var nest = shape.nest;
  if (
    nest !== undefined &&
    (!nest ||
      typeof nest !== 'object' ||
      Array.isArray(nest) ||
      !Object.keys(nest).every(function (k) {
        return (
          Array.isArray(nest[k]) &&
          nest[k].every(function (s) {
            return typeof s === 'string';
          })
        );
      }))
  ) {
    throw apiError_(500, 'shape.nest debe ser {grupo: [fuentes]} en ' + id);
  }
  var envelope = shape.envelope;
  if (envelope !== undefined && envelope !== 'plain' && envelope !== 'list') {
    throw apiError_(500, "shape.envelope debe ser 'plain' o 'list' en " + id);
  }
}

// Selección (pick/include) → nest → rename, sobre UN ítem.
// pick ausente o 'full' ⇒ todas las claves; 'list' ⇒ listProjection (la
// traducción del equivalente interno); [campos] ⇒ en ese orden. Las claves
// inexistentes se saltan (permite claves puestas por handlers, p.ej.
// `reasons`); los campos omitidos simplemente no viajan.
function applyShape_(resource, item, shape) {
  validateShape_(resource, shape);
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  var out = {};
  var pick = shape.pick;
  if (pick === undefined || pick === 'full') {
    Object.keys(item).forEach(function (key) {
      out[key] = item[key];
    });
  } else if (pick === 'list') {
    (resource.listProjection || []).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(item, key)) out[key] = item[key];
    });
  } else {
    pick.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(item, key)) out[key] = item[key];
    });
  }
  (shape.include || []).forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(item, key)) out[key] = item[key];
  });
  // nest: { grupo: [fuentes] } — si el grupo ya existe en la selección,
  // queda un SUBCONJUNTO de sus subclaves; si no, las fuentes son claves
  // top-level que se MUEVEN bajo el grupo nuevo.
  if (shape.nest) {
    Object.keys(shape.nest).forEach(function (target) {
      var existing =
        out[target] && typeof out[target] === 'object' && !Array.isArray(out[target])
          ? out[target]
          : null;
      var collected = {};
      var any = false;
      shape.nest[target].forEach(function (src) {
        var dot = src.indexOf('.');
        var leaf = dot === -1 ? src : src.slice(dot + 1);
        if (dot !== -1) {
          var value = readPath_(out, src);
          if (value !== undefined) {
            collected[leaf] = value;
            any = true;
          }
        } else if (existing && Object.prototype.hasOwnProperty.call(existing, src)) {
          collected[src] = existing[src];
          any = true;
        } else if (Object.prototype.hasOwnProperty.call(out, src)) {
          collected[src] = out[src];
          delete out[src];
          any = true;
        }
      });
      if (any) out[target] = collected;
    });
  }
  // rename: { viejo: nuevo } — claves top-level del ítem ya seleccionado.
  if (shape.rename) {
    Object.keys(shape.rename).forEach(function (oldKey) {
      if (!Object.prototype.hasOwnProperty.call(out, oldKey)) return;
      out[shape.rename[oldKey]] = out[oldKey];
      delete out[oldKey];
    });
  }
  return out;
}

// Lee una ruta con puntos ('a.b') dentro de un objeto.
function readPath_(obj, path) {
  var parts = path.split('.');
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

// envelope 'list' ⇒ { items, total } sobre arreglos YA resueltos; 'plain' o
// ausente ⇒ tal cual. Sólo envuelve listas: en objetos no hay nada que
// aplanar (el envoltorio éxito/error de 12-http no se toca, regla 4).
function shapeEnvelope_(data, shape) {
  if (!shape || shape.envelope !== 'list') return data;
  if (!Array.isArray(data)) return data;
  return { items: data, total: data.length };
}

// Respuesta de una operación NO listada (get/create/update/delete):
// aplica operations.<op>.shape si existe; sin shape ⇒ idéntico al previo.
function shapeResponse_(resource, op, data) {
  var ops = resource.operations;
  var shape = ops && ops[op] ? ops[op].shape : undefined;
  if (!shape) return data;
  validateShape_(resource, shape);
  var shaped;
  if (Array.isArray(data)) {
    shaped = data.map(function (item) {
      return applyShape_(resource, item, shape);
    });
  } else if (data && typeof data === 'object') {
    shaped = applyShape_(resource, data, shape);
  } else {
    shaped = data;
  }
  return shapeEnvelope_(shaped, shape);
}

// Shape efectivo del listado (para 27-views): el de la vista declarada
// manda; si no, el de operations.list; si ninguno, undefined (legacy).
function resolveListShape_(resource, viewName) {
  var ops = resource.operations;
  var listShape = ops && ops.list ? ops.list.shape : undefined;
  if (viewName !== undefined && viewName !== null) {
    var views = resource.views || {};
    if (Object.prototype.hasOwnProperty.call(views, viewName)) {
      var view = views[viewName];
      if (view && typeof view === 'object' && view.shape) return view.shape;
    }
  }
  return listShape;
}

// Hijas a LEER en el listado, derivadas del shape de listado (pick+include);
// sin shape ⇒ listProjection — fallback F5-2 con comportamiento idéntico.
// Valida el shape para que una declaración rota tire 500 aunque la lista
// esté vacía (la validación por ítem no correría).
function listLoadKeys_(resource, map) {
  var ops = resource.operations;
  var shape = ops && ops.list ? ops.list.shape : undefined;
  if (!shape) return resource.listProjection || [];
  validateShape_(resource, shape);
  if (shape.pick === 'full') {
    return map.children.map(function (child) {
      return child.key;
    });
  }
  var childKeys = {};
  map.children.forEach(function (child) {
    childKeys[child.key] = true;
  });
  var base = shape.pick === 'list' ? resource.listProjection || [] : shape.pick || [];
  var keys = [];
  base.concat(shape.include || []).forEach(function (key) {
    if (childKeys[key] && keys.indexOf(key) === -1) keys.push(key);
  });
  return keys;
}
