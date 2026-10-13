// engine/34-schedules — Jobs programados declarativos (R9.5.6, B14 · O5).
//
// El recurso declara `schedules: [{ id, cron, handler, args }]` (nivel
// recurso, NO dentro de operations) y el motor lo convierte en UN trigger
// de Apps Script por schedule, instalado SOLO desde el editor
// (setup/07-setup-triggers, encadenado por setupAll). O3: nada de esto corre
// en un request — ni este dispatch instala triggers.
//
// Resolución trigger → schedule (la decisión de diseño):
//   · TODOS los triggers apuntan a la MISMA función global
//     `RUN_SCHEDULE_JOB_` — GAS no permite crear funciones con nombre
//     dinámico, así que no puede haber un handler por schedule.
//   · Cada trigger instalable de GAS trae `e.triggerUid` (docs oficiales:
//     «Events produced by installable triggers include a triggerUid»), y
//     `setupTriggers_` guarda en la Script Property SCHEDULE_TRIGGERS el
//     mapa `triggerUid → { resource, id }`.
//   · `RUN_SCHEDULE_JOB_` lee ese mapa: el uid del evento identifica el
//     schedule; la declaración sale de REGISTRY.resources (fuente única) y
//     el handler se resuelve igual que en actions/commands:
//     `REGISTRY.handlers[name] || globalThis[name]` (escape hatch §6).
// Cualquier eslabón roto (sin uid, uid sin registro, recurso o schedule ya
// no declarado, handler ausente) es un 500 RUIDOSO: un job que no corre
// tiene que verse en el historial de ejecuciones de GAS, jamás en silencio.
//
// Cron: patrones GAS de ClockTriggerBuilder, escritos a-plan:
//   'everyMinutes(5)'             → everyMinutes(1..59)
//   'everyHours(6)'               → everyHours(1..24)
//   'atHour(3)'                   → atHour(0..23) + everyDays(1)
//   'atHour(9) onWeekDay(Monday)' → atHour + everyWeeks(1) + onWeekDay
// Un patrón fuera de esa lista es error de ARRANQUE (validate-registry) y
// de setup: el motor no adivina cron.

// Propiedad Script con el mapa trigger ↔ schedule (JSON).
var SCHEDULE_TRIGGERS_PROP_ = 'SCHEDULE_TRIGGERS';

// La única función global a la que apuntan los triggers de schedules.
var SCHEDULE_HANDLER_FN_ = 'RUN_SCHEDULE_JOB_';

// Vocabulario EXACTO de un schedule declarado (lo valida validate-registry).
var SCHEDULE_DECL_KEYS_ = ['id', 'cron', 'handler', 'args'];

// Días que acepta onWeekDay: los nombres de ScriptApp.WeekDay en CamelCase
// (el enum es MAYÚSCULAS; el parseo normaliza al instalar).
var SCHEDULE_WEEK_DAYS_ = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// Parsea el cron declarado → descriptor del builder, o null si el patrón
// no está soportado. Fuente única de la verdad: validate-registry la usa
// al arranque y setupTriggers_ al instalar — lo que no está acá no existe.
function parseScheduleCron_(cron) {
  if (typeof cron !== 'string') return null;
  var text = cron.trim();
  var match;

  match = /^everyMinutes\((\d{1,2})\)$/.exec(text);
  if (match) {
    var minutes = parseInt(match[1], 10);
    if (minutes >= 1 && minutes <= 59) return { kind: 'minutes', minutes: minutes };
    return null;
  }

  match = /^everyHours\((\d{1,2})\)$/.exec(text);
  if (match) {
    var hours = parseInt(match[1], 10);
    if (hours >= 1 && hours <= 24) return { kind: 'hours', hours: hours };
    return null;
  }

  match = /^atHour\((\d{1,2})\)$/.exec(text);
  if (match) {
    var hour = parseInt(match[1], 10);
    if (hour >= 0 && hour <= 23) return { kind: 'daily', hour: hour };
    return null;
  }

  match =
    /^atHour\((\d{1,2})\)\s+onWeekDay\((Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\)$/.exec(
      text,
    );
  if (match) {
    var weeklyHour = parseInt(match[1], 10);
    if (weeklyHour >= 0 && weeklyHour <= 23) {
      return { kind: 'weekly', hour: weeklyHour, weekDay: match[2] };
    }
    return null;
  }

  return null;
}

// Schedule declarado con ese id dentro del recurso, o null.
function scheduleDeclOf_(resource, id) {
  var schedules = resource && resource.schedules;
  if (!Array.isArray(schedules)) return null;
  for (var i = 0; i < schedules.length; i++) {
    var decl = schedules[i];
    if (decl && typeof decl === 'object' && String(decl.id) === String(id)) return decl;
  }
  return null;
}

// Escape hatch §6, idéntico a actions: REGISTRY.handlers o globalThis.
// Devuelve lo que encuentre (o null); el caller juzga `typeof === 'function'`.
function resolveScheduleHandler_(declared) {
  var name = declared && declared.handler;
  if (typeof name !== 'string' || name === '') return null;
  return (REGISTRY.handlers && REGISTRY.handlers[name]) || globalThis[name] || null;
}

// Mapa triggerUid → { resource, id } desde la propiedad. Prop ausente ⇒ {}
// (instalación nueva). Prop CORRUPTA ⇒ error ruidoso: un reset mudo acá
// duplicaría triggers sin que nadie se entere.
function scheduleTriggerMap_() {
  var raw = Props.get(SCHEDULE_TRIGGERS_PROP_);
  if (raw === null) return {};
  var map;
  try {
    map = JSON.parse(String(raw));
  } catch (parseError) {
    throw new Error(
      SCHEDULE_TRIGGERS_PROP_ +
        ' está corrupta (' +
        String(parseError.message) +
        ') — bórrala y vuelve a correr setupTriggers_()',
    );
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(
      SCHEDULE_TRIGGERS_PROP_ +
        ' debe ser un objeto JSON — bórrala y vuelve a correr setupTriggers_()',
    );
  }
  return map;
}

// ── RUN_SCHEDULE_JOB_ ─────────────────────────────────────────────────────
//
// Punto de entrada de los triggers de GAS. NO instala ni borra nada (O3):
// sólo resuelve el schedule del evento y ejecuta `handler(args, ctx)`.
//
// @param {{triggerUid?: string}} e Evento del trigger instalable (GAS pasa
//   `triggerUid` en los triggers instalables — es LO que identifica al job).
function RUN_SCHEDULE_JOB_(e) {
  var uid = e && e.triggerUid !== undefined && e.triggerUid !== null ? String(e.triggerUid) : '';
  if (uid === '') {
    throw apiError_(
      500,
      SCHEDULE_HANDLER_FN_ +
        ' sólo corre desde un trigger instalado (falta e.triggerUid) — instálalos con setupTriggers_()',
    );
  }

  var target = scheduleTriggerMap_()[uid];
  if (
    !target ||
    typeof target !== 'object' ||
    typeof target.resource !== 'string' ||
    typeof target.id !== 'string'
  ) {
    throw apiError_(
      500,
      "El trigger '" +
        uid +
        "' no tiene schedule registrado en " +
        SCHEDULE_TRIGGERS_PROP_ +
        ' — vuelve a correr setupTriggers_()',
    );
  }

  var resource = REGISTRY.resources[target.resource];
  if (!resource) {
    throw apiError_(
      500,
      "El schedule '" +
        target.resource +
        ':' +
        target.id +
        "' apunta al recurso inexistente '" +
        target.resource +
        "'",
    );
  }

  var declared = scheduleDeclOf_(resource, target.id);
  if (declared === null) {
    throw apiError_(
      500,
      "El schedule '" +
        target.resource +
        ':' +
        target.id +
        "' ya no está declarado — vuelve a correr setupTriggers_()",
    );
  }

  var fn = resolveScheduleHandler_(declared);
  if (typeof fn !== 'function') {
    throw apiError_(
      500,
      "El schedule '" +
        target.resource +
        ':' +
        target.id +
        "': handler no registrado '" +
        String(declared.handler) +
        "'",
    );
  }

  var ctx = {
    resource: target.resource,
    id: target.id,
    cron: declared.cron,
    triggerUid: uid,
    firedAt: new Date(),
  };
  var result = fn(declared.args === undefined || declared.args === null ? {} : declared.args, ctx);
  Logger.log('✓ schedule ' + target.resource + ':' + target.id + ' (' + declared.handler + ')');
  return result === undefined ? null : result;
}
