// setup/07-setup-triggers — Instalación de los jobs programados (R9.5.6, O5).
//
// Los triggers de Apps Script NO se pueden crear desde un request: sólo
// desde el editor (O3). Entonces la declaración `resource.schedules` no
// puede materializarlos sola — ÉSTE paso es el que los instala, a mano:
//   setupTriggers_()   (o vía setupAll, que lo encadena tras setupAuth_)
//
// Idempotente por RECONCILIACIÓN, no por marca: lee los triggers ACTUALES
// del proyecto (los nuestros son los CLOCK que apuntan a RUN_SCHEDULE_JOB_)
// y el mapa SCHEDULE_TRIGGERS de las Script Properties, y los ajusta a la
// declaración vigente:
//   · declarado + instalado       → se queda como está (no gasta cuota)
//   · declarado + faltante        → se crea el trigger y se registra su uid
//   · instalado + sin declaración → se BORRA: un schedule borrado del
//     schema que siga disparando sería un error fantasma a las 3 AM, y si
//     su handler ya no existe el fallo sería de cualquier cosa menos
//     diagnóstico.
//
// Fail-loud acá igual que en runtime (§0.5): cron no soportado o handler
// sin registrar LANZA y setupAll nombra el paso detenido — nunca se deja
// un job a medias «para después».
//
// Editor-only por estructura: sin ruta que lo declare + en EDITOR_ONLY_FNS
// (core/10-router).

/**
 * Reconcilia triggers de schedules ↔ declaración en REGISTRY.resources.
 * @return {{ok: boolean, creados: string[], existentes: string[], borrados: string[]}}
 */
function setupTriggers_() {
  // 1) Declaración vigente (el arranque ya la validó; acá sólo se mira).
  var entradas = [];
  Object.keys(REGISTRY.resources).forEach(function (resourceId) {
    var resource = REGISTRY.resources[resourceId];
    var schedules = resource && resource.schedules;
    if (!Array.isArray(schedules)) return;
    schedules.forEach(function (decl) {
      if (!decl || typeof decl !== 'object') return;
      entradas.push({ resource: resourceId, id: String(decl.id), decl: decl });
    });
  });

  // 2) Chequeo de arranque del editor: lo que no se puede instalar, NO se
  //    instala a medias — se nombra y se corta.
  var declarados = {};
  entradas.forEach(function (entry) {
    var key = entry.resource + ':' + entry.id;
    if (declarados[key]) {
      throw new Error("Schedule duplicado '" + key + "': el id debe ser único");
    }
    declarados[key] = true;
    if (parseScheduleCron_(entry.decl.cron) === null) {
      throw new Error(
        "Schedule '" + key + "': cron no soportado '" + String(entry.decl.cron) + "'",
      );
    }
    if (typeof resolveScheduleHandler_(entry.decl) !== 'function') {
      throw new Error(
        "Schedule '" + key + "': handler no registrado '" + String(entry.decl.handler) + "'",
      );
    }
  });

  // 3) Triggers actuales del proyecto que son LOS NUESTROS (CLOCK +
  //    RUN_SCHEDULE_JOB_): otra gente puede tener sus propios triggers.
  var porUid = {};
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (String(trigger.getHandlerFunction()) !== SCHEDULE_HANDLER_FN_) return;
    if (String(trigger.getEventType()) !== String(ScriptApp.EventType.CLOCK)) return;
    porUid[String(trigger.getUniqueId())] = trigger;
  });

  // 4) Reconciliar. `nuevoMap` se arma DESDE CERO: cualquier uid físico sin
  //    declaración vigente queda fuera del mapa y se borra más abajo.
  var viejoMap = scheduleTriggerMap_();
  var nuevoMap = {};
  var creados = [];
  var existentes = [];
  var borrados = [];

  entradas.forEach(function (entry) {
    var key = entry.resource + ':' + entry.id;
    var uid = null;
    Object.keys(viejoMap).forEach(function (candidate) {
      if (uid !== null || !porUid[candidate]) return;
      var target = viejoMap[candidate];
      if (target && target.resource === entry.resource && String(target.id) === entry.id) {
        uid = candidate;
      }
    });
    if (uid !== null) {
      nuevoMap[uid] = { resource: entry.resource, id: entry.id };
      existentes.push(key);
      return;
    }
    var trigger = buildScheduleTrigger_(entry.decl.cron);
    nuevoMap[String(trigger.getUniqueId())] = { resource: entry.resource, id: entry.id };
    creados.push(key);
  });

  // Borrado de huérfanos: triggers nuestros que ningún schedule vigente
  // reclamó (incluye el caso «el uid estaba en la prop pero el trigger lo
  // borraron a mano» — ahí no hay trigger que borrar, sólo basura en el mapa).
  Object.keys(porUid).forEach(function (uid) {
    if (nuevoMap[uid] !== undefined) return;
    ScriptApp.deleteTrigger(porUid[uid]);
    var previo = viejoMap[uid];
    borrados.push(
      previo && previo.resource ? previo.resource + ':' + String(previo.id) : 'sin registro ' + uid,
    );
  });

  // 5) Persistir el mapa — sólo si cambió (re-ejecutar no escribe nada).
  var serializado = JSON.stringify(nuevoMap);
  if (String(Props.get(SCHEDULE_TRIGGERS_PROP_) || '') !== serializado) {
    var update = {};
    update[SCHEDULE_TRIGGERS_PROP_] = serializado;
    Props.setAll(update);
  }

  Logger.log(
    '✓ setupTriggers_: ' +
      creados.length +
      ' creados · ' +
      existentes.length +
      ' ya estaban · ' +
      borrados.length +
      ' borrados' +
      (creados.length ? ' (' + creados.join(', ') + ')' : ''),
  );
  return { ok: true, creados: creados, existentes: existentes, borrados: borrados };
}

// Crea UN trigger de GAS para el cron parseado. Es la ÚNICA línea del
// proyecto que llama a ScriptApp.newTrigger (O3: editor solamente).
function buildScheduleTrigger_(cron) {
  var parsed = parseScheduleCron_(cron);
  if (parsed === null) {
    throw new Error("cron no soportado '" + String(cron) + "'");
  }
  var builder = ScriptApp.newTrigger(SCHEDULE_HANDLER_FN_).timeBased();
  if (parsed.kind === 'minutes') {
    builder.everyMinutes(parsed.minutes);
  } else if (parsed.kind === 'hours') {
    builder.everyHours(parsed.hours);
  } else if (parsed.kind === 'daily') {
    builder.atHour(parsed.hour).everyDays(1);
  } else {
    // Semanal: GAS sólo acepta onWeekDay DESPUÉS de everyWeeks, y el enum
    // WeekDay vive en MAYÚSCULAS (MONDAY…).
    builder
      .atHour(parsed.hour)
      .everyWeeks(1)
      .onWeekDay(ScriptApp.WeekDay[parsed.weekDay.toUpperCase()]);
  }
  return builder.create();
}
