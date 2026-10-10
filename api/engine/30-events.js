// api/engine/30-events.js — Bus de eventos interno ÚNICO (B9 · R5.6).
//
// El CRUD no "llama hooks": EMITE eventos. Quien reacciona se suscribe —
// hoy `resource.hooks`, mañana analytics/notificaciones vía `onEvent_` —
// sin que nadie toque 24-crud de nuevo. Ese es el contrato entero.
//
//   resource.hooks = {
//     beforeCreate: ['<hook>', { id: '<hook>', onError: 'compensate' }],
//     afterCreate:  [...],      // alias legacy: `create`
//     afterUpdate:  [...],      // alias legacy: `update`
//     onStatusChange: [...],
//     delete: [...],            // legacy: corre tras el borrado (alias afterDelete)
//     reorder: [...],           // legacy: alias afterReorder
//   }
//
// **Fases pre vs post.** `beforeCreate` corre ANTES de escribir y puede
// MODIFICAR `ctx.payload` o VETAR con cualquier error (que se propaga:
// aún no hay nada escrito, vetar es gratis y es lo seguro). El resto son
// post-escritura: el hecho ya es irreversible, el hook es REACCIÓN — su
// error nunca deshace ni enmascara la escritura (mismo criterio histórico
// de emitHook_).
//
// **onError (sólo post):** `ignore` traga en silencio · `log` (default)
// registra en consola · `compensate` ejecuta las compensaciones que el
// propio hook registró con `ctx.onCompensate(fn)` (LIFO) y DESPUÉS registra
// el error original. ⚠️ **O4: no hay rollback del hecho** — Sheets no lo
// soporta; la compensación deshace los efectos PARCIALES DEL HOOK, nunca la
// escritura principal.
//
// **Idempotencia:** los hooks deben ser re-ejecutables (un reintento vuelve
// a pasar por acá). El motor no inventa unicidad: entrega `ctx.eventId`
// (`recurso|fase|clave`) como manija ESTABLE con la que un hook puede
// deduplicar por su cuenta (¿ya procesé esta entidad en esta fase?).
//
// **onStatusChange** no adivina: sólo dispara para campos con máquina
// declarada en `resource.transitions` (R5.5) que realmente CAMBIARON — la
// misma noción de "cambio" que juzga `assertTransitions_`.
var HOOK_PHASES_ = {
  beforeCreate: 'pre',
  afterCreate: 'post',
  afterUpdate: 'post',
  onStatusChange: 'post',
  // Alias legacy (contrato previo a R5.6): mismos eventos, otros nombres.
  create: 'post',
  update: 'post',
  delete: 'post',
  reorder: 'post',
};

// Alias: fase nueva ← nombre legacy que ya existía en resources.
var HOOK_ALIASES_ = {
  afterCreate: 'create',
  afterUpdate: 'update',
  afterDelete: 'delete',
  afterReorder: 'reorder',
};

var ERROR_POLICIES_ = ['ignore', 'log', 'compensate'];

// Suscriptores externos (futuros) por fase. `onEvent_` es la única puerta.
var EVENT_SUBSCRIBERS_ = {};

/**
 * Suscribe un handler a un evento interno. Errores del handler se
 * registran y nunca rompen la escritura que los originó (es un
 * observador, no un veto — el veto es patrimonio de los hooks
 * declarados en `resource.hooks`).
 */
function onEvent_(name, handler) {
  if (!EVENT_SUBSCRIBERS_[name]) EVENT_SUBSCRIBERS_[name] = [];
  EVENT_SUBSCRIBERS_[name].push(handler);
}

/** Entrada de lista: '<id>' o { id, onError? }. Devuelve { id, onError }. */
function hookEntry_(entry) {
  if (typeof entry === 'string') return { id: entry, onError: 'log' };
  var id = entry && typeof entry === 'object' ? entry.id : undefined;
  var policy = entry && entry.onError !== undefined ? entry.onError : 'log';
  return { id: id, onError: policy };
}

// Mensaje único de registro de fallo de hook (antes vivo inline en
// emitHook_/emitActionHooks_ con el mismo formato).
function hookFailureLog_(phase, resource, key, err) {
  console.error(
    '[hooks] ' + phase + ' ' + resource.id + '/' + key + ': ' + ((err && err.message) || err),
  );
}

/**
 * Corre UNA lista de entradas en orden declarado (determinista), con la
 * política onError de cada entrada. `names` puede venir del recurso
 * (resource.hooks[fase]) o explícito (hooks de una acción, 28-actions).
 */
function runHookList_(ss, resource, names, baseCtx, phase) {
  if (!Array.isArray(names) || names.length === 0) return;
  names.forEach(function (raw) {
    var entry = hookEntry_(raw);
    var hook = REGISTRY.hooks ? REGISTRY.hooks[entry.id] : undefined;
    if (typeof hook !== 'function') return; // la validación eager/startup ya falló antes
    var compensations = [];
    var ctx = {};
    Object.keys(baseCtx).forEach(function (k) {
      ctx[k] = baseCtx[k];
    });
    ctx.ss = ss;
    ctx.resource = resource;
    ctx.action = phase;
    ctx.eventId = resource.id + '|' + phase + '|' + String(baseCtx.key);
    ctx.onCompensate = function (fn) {
      if (typeof fn === 'function') compensations.push(fn);
    };
    try {
      hook(ctx);
    } catch (err) {
      if (entry.onError === 'ignore') return; // opt-in explícito al silencio
      if (entry.onError === 'compensate') {
        // LIFO: lo último registrado se deshace primero. Cada una aislada
        // en try/catch: una compensación rota no puede tapar a la otra
        // ni al error original.
        while (compensations.length > 0) {
          try {
            compensations.pop()();
          } catch (compensationError) {
            hookFailureLog_('compensate:' + phase, resource, baseCtx.key, compensationError);
          }
        }
      }
      hookFailureLog_(phase, resource, baseCtx.key, err);
    }
  });
}

/**
 * Emite un evento interno: corre los hooks declarados del recurso para esa
 * fase (más su alias legacy) y luego a los suscriptores externos.
 *
 * @param {object} ss SpreadsheetApp activo
 * @param {object} resource schema del recurso
 * @param {string} phase una clave de HOOK_PHASES_
 * @param {object} baseCtx { key, payload, summary?, field?, from?, to? }
 * @param {Array=} names lista explícita (hooks de acción); sin ella se
 *   resuelve desde resource.hooks
 */
function emitEvent_(ss, resource, phase, baseCtx, names) {
  var pre = HOOK_PHASES_[phase] === 'pre';

  // Lista de trabajo: { id, onError, action } en ORDEN DETERMINISTA — la
  // fase nominada primero, su alias legacy después. El alias conserva su
  // nombre histórico en ctx.action: los hooks legacy siempre vieron action
  // 'create'/'update'/… y el contrato público no cambia por ponerle un
  // nombre nuevo a la fase.
  var work = [];
  if (names !== undefined) {
    (Array.isArray(names) ? names : []).forEach(function (raw) {
      var entry = hookEntry_(raw);
      work.push({ id: entry.id, onError: entry.onError, action: phase });
    });
  } else if (resource.hooks) {
    (resource.hooks[phase] || []).forEach(function (raw) {
      var entry = hookEntry_(raw);
      work.push({ id: entry.id, onError: entry.onError, action: phase });
    });
    var alias = HOOK_ALIASES_[phase];
    if (alias && Array.isArray(resource.hooks[alias])) {
      resource.hooks[alias].forEach(function (raw) {
        var entry = hookEntry_(raw);
        work.push({ id: entry.id, onError: entry.onError, action: alias });
      });
    }
  }

  var subscribers = EVENT_SUBSCRIBERS_[phase] || [];
  if (work.length === 0 && subscribers.length === 0) return;

  var ctx = {};
  Object.keys(baseCtx || {}).forEach(function (k) {
    ctx[k] = baseCtx[k];
  });
  ctx.ss = ss;
  ctx.resource = resource;
  ctx.action = phase;
  ctx.eventId = resource.id + '|' + phase + '|' + String(baseCtx && baseCtx.key);

  if (pre) {
    // FASE PRE: errores se PROPAGAN (veto). Nada escrito aún, así que
    // vetar es gratis — y un veto tragado en silencio sería un motor que
    // escribe lo que el schema no autorizó.
    work.forEach(function (item) {
      var hook = REGISTRY.hooks ? REGISTRY.hooks[item.id] : undefined;
      if (typeof hook !== 'function') return;
      var preCtx = {};
      Object.keys(ctx).forEach(function (k) {
        preCtx[k] = ctx[k];
      });
      preCtx.action = item.action;
      hook(preCtx); // sin try/catch: el error es el veto
    });
  } else {
    // FASE POST: una entrada por vez, con su propia política onError.
    work.forEach(function (item) {
      runHookList_(ss, resource, [{ id: item.id, onError: item.onError }], baseCtx, item.action);
    });
  }

  // Suscriptores externos: SIEMPRE después de los declarados, y sus
  // errores jamás afectan la escritura (son observadores).
  subscribers.forEach(function (handler) {
    try {
      handler(ctx);
    } catch (err) {
      hookFailureLog_(phase, resource, baseCtx && baseCtx.key, err);
    }
  });
}

/**
 * Emite `onStatusChange` si el update tocó un campo con máquina declarada
 * (R5.5). Una vez por campo cambiado, en orden de declaración.
 */
function emitStatusChange_(ss, resource, key, current, payload, summary) {
  var machines = resource.transitions;
  if (!machines || typeof machines !== 'object' || Array.isArray(machines)) return;
  if (!current || typeof current !== 'object') return;
  if (!payload || typeof payload !== 'object') return;
  Object.keys(machines).forEach(function (field) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
    var from = current[field];
    var to = payload[field];
    if (String(from) === String(to)) return; // no es un cambio (criterio R5.5)
    emitEvent_(ss, resource, 'onStatusChange', {
      key: key,
      payload: payload,
      summary: summary,
      field: field,
      from: from,
      to: to,
    });
  });
}
