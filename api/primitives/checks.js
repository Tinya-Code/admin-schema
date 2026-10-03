// primitives/checks — Checks declarados parametrizados (mejoras §6).
//
// REGISTRY.checks: fn(scope) → [{ path, message }] (NO lanza; vacío = ok).
// scope = {
//   resource,        // resource declarativo completo
//   scalars,         // contrato fusionado (payload de escritura)
//   ctx: { ss, isNew, key, current, children },  // mismo ctx que la validación
//   params,          // la declaración: { check, field?, ... }
// }
// El motor (engine/23-validate) los ejecuta DESPUÉS de la validación
// declarativa y acumula en el MISMO 422, en el orden de resource.checks:
//   resource.checks = [{ check: 'pattern', ... }, { check: 'not-in-sheet' }]
// Check no registrado o declaración mal formada = 500 (§16: el schema manda).
REGISTRY.checks = {
  // pattern — test regular sobre params.field con mensaje propio.
  //   negate: true → INVIERTE el match (emite cuando NO calza).
  //   Campo vacío ⇒ [] (el required es de 23-validate).
  // Caso base (legal.ruc): { check: 'pattern', field: 'ruc',
  //   pattern: '^(\\d)\\1{10}$', negate: true, message: '…' } — dígitos uniformes.
  pattern: function (scope) {
    var params = (scope && scope.params) || {};
    if (typeof params.field !== 'string' || typeof params.pattern !== 'string') {
      throw apiError_(500, 'check pattern requiere field y pattern');
    }
    var scalars = (scope && scope.scalars) || {};
    var value = scalars[params.field];
    if (isEmptyValue_(value)) return [];
    var matched = new RegExp(params.pattern).test(String(value));
    if (params.negate === true) matched = !matched;
    if (matched) return [];
    return [validationIssue_(params.field, params.message || 'Formato inválido')];
  },

  // mod11 — dígito verificador módulo 11 (fórmula de pesos).
  //   params: { field, weights: [n…], expected, message? }
  //   sum = Σ dígito[i] × weights[i]; ok si (sum % 11) === expected.
  //   No numérico o vacío ⇒ [] (lo cubre el pattern declarativo del campo).
  // PRIMITIVA DISPONIBLE, sin consumidor declarado: el validador previo
  // rechazaba mod-11 por riesgo de falsos negativos (algoritmo oficial no
  // verificado: rechazar un registro válido = bloquear datos reales) —
  // declararla queda como decisión del recurso.
  mod11: function (scope) {
    var params = (scope && scope.params) || {};
    if (typeof params.field !== 'string' || !Array.isArray(params.weights)) {
      throw apiError_(500, 'check mod11 requiere field y weights');
    }
    if (params.expected === undefined) {
      throw apiError_(500, 'check mod11 requiere expected');
    }
    var scalars = (scope && scope.scalars) || {};
    var value = scalars[params.field];
    if (isEmptyValue_(value)) return [];
    var text = String(value);
    if (!/^\d+$/.test(text)) return []; // no numérico ⇒ pattern declarativo
    var sum = 0;
    for (var i = 0; i < params.weights.length && i < text.length; i++) {
      sum += Number(text.charAt(i)) * Number(params.weights[i]);
    }
    if (sum % 11 === Number(params.expected)) return [];
    return [validationIssue_(params.field, params.message || 'Dígito verificador inválido')];
  },

  // not-in-sheet — TODOS los strings del guardado contra una hoja de
  // patrones (mejoras §6: { check: 'not-in-sheet', sheet: '_placeholders' }).
  // params: { sheet, column? (default 'pattern'), patterns? (fallback inline) }
  // Barrido por TIPOS de campo (FIELD_TYPES), sin dominio: escalares de
  // columna → sub-campos de grupo → hijas presentes en ctx.children
  // (hijas ausentes en update = "no se tocaron" ⇒ no se escanean).
  // Matching SUBSTRING CASE-SENSITIVE: case-insensitivo dispararía 'TODO'
  // contra "todo" del español prosa; si hace falta otra variante, se agrega
  // a la hoja, no al código. Primer match por campo.
  'not-in-sheet': function (scope) {
    var params = (scope && scope.params) || {};
    if (typeof params.sheet !== 'string') {
      throw apiError_(500, 'check not-in-sheet requiere sheet');
    }
    var errors = [];
    var patterns = checkPatterns_(scope && scope.ctx, params);
    var resource = (scope && scope.resource) || {};
    var fields = Array.isArray(resource.fields) ? resource.fields : [];
    var source = (scope && scope.scalars) || {};

    fields.forEach(function (field) {
      var meta = FIELD_TYPES[field.type] || {};
      if (meta.storage === 'column') {
        checkScanValue_(source[field.key], field.key, patterns, errors);
      } else if (meta.storage === 'group') {
        var group = source[field.key];
        var inner = group && typeof group === 'object' ? group : {};
        (field.fields || []).forEach(function (sub) {
          checkScanValue_(inner[sub.key], field.key + '.' + sub.key, patterns, errors);
        });
      }
    });

    var ctx = (scope && scope.ctx) || {};
    var children = ctx.children && typeof ctx.children === 'object' ? ctx.children : {};
    fields.forEach(function (field) {
      var meta = FIELD_TYPES[field.type] || {};
      if (meta.storage !== 'child-sheet') return;
      var items = children[field.key];
      if (!Array.isArray(items)) return;
      items.forEach(function (item, i) {
        var base = field.key + '[' + i + ']';
        if (field.type === 'string-list') {
          checkScanValue_(item, base, patterns, errors);
        } else if (field.type === 'key-value') {
          if (!item || typeof item !== 'object') return;
          checkScanValue_(item.key, base + '.key', patterns, errors);
          checkScanValue_(item.value, base + '.value', patterns, errors);
        } else {
          // list: sólo los itemFields (days/opens no son prosa).
          if (!item || typeof item !== 'object') return;
          (field.itemFields || []).forEach(function (f) {
            checkScanValue_(item[f.key], base + '.' + f.key, patterns, errors);
          });
        }
      });
    });

    return errors;
  },
};

// Primer match por valor; sólo strings (números/booleanos no son prosa).
function checkScanValue_(value, path, patterns, errors) {
  if (typeof value !== 'string' || value === '') return;
  for (var i = 0; i < patterns.length; i++) {
    if (value.indexOf(patterns[i]) !== -1) {
      errors.push(
        validationIssue_(path, 'Contenido de relleno no permitido: "' + patterns[i] + '"'),
      );
      return;
    }
  }
}

// Patrones de la hoja declarada en params.sheet (col params.column,
// default 'pattern'); hoja ausente/vacía/sin columna ⇒ params.patterns
// y, si éste tampoco está, PLACEHOLDER_PATTERNS (schema/02-enums).
function checkPatterns_(ctx, params) {
  var fallback = Array.isArray(params.patterns) ? params.patterns : PLACEHOLDER_PATTERNS.slice();
  var ss = ctx && ctx.ss;
  if (!ss || typeof ss.getSheetByName !== 'function') return fallback;
  try {
    var data = readSheetData_(ss, params.sheet);
    var idx = data.headers.indexOf(params.column || 'pattern');
    if (idx === -1) return fallback;
    var out = [];
    data.rows.forEach(function (row) {
      var raw = row.values[idx];
      var text = raw === undefined || raw === null ? '' : String(raw).trim();
      if (text !== '') out.push(text);
    });
    return out.length > 0 ? out : fallback;
  } catch (e) {
    return fallback; // sin hoja (setup incompleto) → defaults
  }
}
