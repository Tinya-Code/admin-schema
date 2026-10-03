// engine/25-ordering — El backend es dueño de `position` (baseapi §9).
//
// El front sólo envía la INTENCIÓN ("mover X después de Y" / "al inicio"
// / "al final"): acá se calcula el punto medio con el paso (1000) y, si el
// hueco no alcanza, se rebalancea internamente a paso · 1..N. Las hojas
// HIJAS no usan este módulo: para ellas la verdad es el orden del arreglo
// que manda el front y las posiciones densas 1..N las asigna 21-repo.
// Top-level: sólo declaraciones.

// Aplica la intención sobre los ítems YA ordenados por posición.
//   intent = { key, after } | { key, toStart: true } | { key, toEnd: true }
// Devuelve [{ key, position, at }] con las posiciones recalculadas, o
// null si la clave no existe (el caller responde 404).
function applyReorderIntent_(items, intent, step) {
  var intentKey = String(intent.key);
  var from = -1;
  var i;
  for (i = 0; i < items.length; i++) {
    if (String(items[i].key) === intentKey) {
      from = i;
      break;
    }
  }
  if (from === -1) return null;

  // Moverse después de uno mismo (o al lugar que ya ocupa): sin cambios.
  if (intent.after !== undefined && String(intent.after) === intentKey) {
    return assignPositions_(items.slice(), step);
  }

  var order = items.slice();
  var moving = order.splice(from, 1)[0];
  var to;
  if (intent.toStart === true) {
    to = 0;
  } else if (intent.toEnd === true) {
    to = order.length;
  } else {
    var afterKey = String(intent.after);
    var target = -1;
    for (i = 0; i < order.length; i++) {
      if (String(order[i].key) === afterKey) {
        target = i;
        break;
      }
    }
    if (target === -1) return null; // caller ya validó; defensivo
    to = target + 1;
  }
  order.splice(to, 0, moving);
  return assignPositions_(order, step);
}

// Posiciones estrictamente crecientes conservando lo posible: los ítems
// en su sitio mantienen su valor; los que quedaron fuera de orden toman el
// punto medio entre su nuevo vecino y el ancla siguiente. Si el hueco no
// da (mid <= vecino o >= ancla), REBALANCEO total con el paso.
function assignPositions_(order, step) {
  var pos = [];
  var i;
  var j;
  for (i = 0; i < order.length; i++) {
    var p = Number(order[i].position);
    pos.push(isFinite(p) ? p : 0);
  }
  for (i = 1; i < order.length; i++) {
    if (pos[i] > pos[i - 1]) continue;
    var lo = pos[i - 1];
    var hi = null;
    for (j = i + 1; j < order.length; j++) {
      if (pos[j] > lo) {
        hi = pos[j];
        break;
      }
    }
    if (hi === null) hi = lo + step; // al final: última + paso
    var mid = Math.floor((lo + hi) / 2);
    if (mid <= lo || mid >= hi) return rebalancePositions_(order, step);
    pos[i] = mid;
  }
  return order.map(function (item, index) {
    return { key: item.key, position: pos[index], at: item.at };
  });
}

// Reorden completo a paso · 1..N (cuando no hay espacio para midpoints).
function rebalancePositions_(order, step) {
  return order.map(function (item, index) {
    return { key: item.key, position: (index + 1) * step, at: item.at };
  });
}

// Siguiente posición para un ítem nuevo: última + paso (§9).
function nextPosition_(positions, step) {
  var max = null;
  positions.forEach(function (raw) {
    var p = Number(raw);
    if (isFinite(p) && (max === null || p > max)) max = p;
  });
  return max === null ? step : max + step;
}
