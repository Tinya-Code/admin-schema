// engine/36-notifications — Notificaciones salientes declarativas
// (R9.5.8, B14 · O5).
//
// El recurso declara `notify` (nivel recurso, NO dentro de operations) y el
// motor envía un correo por cada entrada cuya fase coincide con la que el
// bus EMITIÓ. La puerta de entrada es la MISMA que la de cualquier
// observador externo: `onEvent_` (engine/30-events) — ni 24-crud ni el bus
// se tocan para sumar una notificación.
//
//   notify: [
//     { on: 'afterCreate', channel: 'email', to: '{email}',
//       subject: 'Pedido {key} confirmado',
//       template: 'Hola {customer_name}, tu pedido {key} quedó confirmado.' },
//     { on: 'delete', channel: 'email', to: 'ops@example.com',
//       template: 'Se dio de baja {key}' },   // alias legacy aceptado
//   ]
//
// ⚠️ **DESVIACIÓN DOCUMENTADA** respecto de la spec (refactormotor.md:499
// y plan §R9.5.8): la spec escribe `notify: { on, channel, template }` —
// UN objeto. Acá es un **ARREGLO** de objetos, igual que
// `webhooks: [{ on, url, sign }]`: un recurso puede querer avisar en
// VARIOS eventos (y en el mismo evento a varios destinatarios), y así el
// vocabulario, la validación y el patrón quedan IDÉNTICOS a los de
// webhooks (array + par { on, to } único dentro del recurso). Cada
// entrada se juzga igual que validateWebhooks_ juzga cada webhook.
//
// Contrato de entrega (decisiones de diseño):
//   · Sólo fases POST: una notificación pre-escritura (beforeCreate) se
//     dispararía antes de saber si la escritura ocurre, y su semántica de
//     fallo no coincide con O4. Las fases se juzgan al ARRANQUE
//     (validate-registry → validateNotifications_): una notificación
//     inválida ROMPE el arranque, no se ignora en silencio (§0.5 ·
//     fail-loud).
//   · `channel: 'email'` es HOY el ÚNICO canal válido: `MailApp` es el
//     único canal con cuota CONOCIDA en este proyecto (100 correos/día en
//     el plano gratuito de GAS). `whatsapp` (refactormotor.md:499) queda
//     como TRABAJO FUTURO: no hay integración Twilio declarada ni cuota
//     conocida acá, y aceptar un canal que nadie podría entregar sería
//     mentira de schema (fail-closed → rojo de arranque).
//   · Destinatario `to` y `subject`: la spec NO los especifica, así que la
//     entrada sumó estas dos claves: `to` obligatorio, `subject` opcional.
//       - `to` — string no vacío: email LITERAL (`ops@example.com`) o
//         placeholder `{campo}` que se resuelve contra el PAYLOAD de la
//         escritura (fallback: `ctx.summary`, por si el bus algún día
//         manda objetos — hoy manda el string de auditoría). Si el
//         placeholder queda SIN resolver, NO se envía y se registra: no
//         se gasta cuota con un destinatario inventado.
//       - `subject` — opcional; si falta se deriva
//         `resource.id + ' · ' + acción` (p. ej. `orders · afterCreate`).
//   · `template` — texto con placeholders `{campo}` reemplazados con
//     `String.replace(/\{(\w+)\}/g, …)` sobre el payload. §0.5 · SIN
//     secretos: el renderer SÓLO lee `ctx.payload` / `ctx.summary` — no
//     existe ningún mecanismo que lea campos secretos, y la plantilla es
//     texto plano declarado en schema/resources (dato puro, sin lógica).
//   · **El fallo de la notificación NUNCA deshace la escritura** (O4 —
//     compensación, no rollback): el envío va envuelto en try/catch y el
//     error se REGISTRA y se sigue. Además 30-events aísla los errores de
//     los suscriptores: doble red de seguridad, pero el registro de acá
//     es el que nombra a la notificación.
//   · UN `MailApp.sendEmail` por entrada por evento, SIN reintentos.
//     **Cuota: MailApp = 100 correos/día en el plano gratuito** — una
//     tormenta de reintentos la agotaría en minutos. Reintentar
//     (deduplicando vía `ctx.eventId`) es problema del consumidor, no del
//     motor.
//   · Entrega best-effort SÍNCRONA dentro del request que escribió: GAS no
//     ofrece colas. Un mail lento encarece el request.

// Vocabulario EXACTO de una notificación declarada (lo valida
// validate-registry → NOTIFY_DECL_KEYS_ vive acá, como WEBHOOK_DECL_KEYS_).
var NOTIFY_DECL_KEYS_ = ['on', 'channel', 'template', 'to', 'subject'];

// Canales con cuota CONOCIDA hoy: sólo email (MailApp, 100/día plano
// gratuito). `whatsapp` es trabajo futuro (sin integración ni cuota
// conocida) y cualquier otro canal es rojo de arranque.
var NOTIFY_CHANNELS_ = ['email'];

// Fases que el CRUD EMITE para lo post — MISMAS que `WEBHOOK_EMIT_PHASES_`
// (engine/35-webhooks). NO se recalcula de `HOOK_PHASES_`: éste nombra los
// alias LEGACY (`delete`, `reorder`) mientras que el CRUD EMITE los
// canónicos (`afterDelete`, `afterReorder`), y `emitEvent_` busca a los
// suscriptores por el nombre EMITIDO — por eso la suscripción usa estas
// claves y el match contra `on` mira el nombre exacto Y su alias legacy
// (HOOK_ALIASES_).
var NOTIFY_EMIT_PHASES_ = [
  'afterCreate',
  'afterUpdate',
  'onStatusChange',
  'afterDelete',
  'afterReorder',
];

// ¿La notificación declarada corresponde a la fase EMITIDA? Nombre exacto
// (afterCreate…) o alias legacy (create→afterCreate, delete→afterDelete…).
function notificationMatchesPhase_(decl, phase) {
  return decl.on === phase || HOOK_ALIASES_[phase] === decl.on;
}

// Renderiza `{campo}` contra el payload de la escritura y, si el dato no
// está, contra `ctx.summary` (hoy el bus manda el string de auditoría, así
// que ese fallback sólo aplica si algún día llega un objeto). Un
// placeholder SIN dato se deja TAL CUAL: ruidoso y visible, nunca una
// sustitución silenciosa. Nunca toca campos secretos (§0.5) — sólo esto.
function renderNotifyText_(text, ctx) {
  var payload = ctx && ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : null;
  var summary = ctx && ctx.summary && typeof ctx.summary === 'object' ? ctx.summary : null;
  return String(text).replace(/\{(\w+)\}/g, function (match, name) {
    var value = null;
    if (payload && Object.prototype.hasOwnProperty.call(payload, name)) value = payload[name];
    if (
      (value === null || value === undefined) &&
      summary &&
      Object.prototype.hasOwnProperty.call(summary, name)
    ) {
      value = summary[name];
    }
    return value === null || value === undefined ? match : String(value);
  });
}

// Envía UNA notificación. Nunca propaga: el fallo se REGISTRA y ya (O4 —
// la escritura que originó el evento ya ocurrió y es irreversible).
function sendNotification_(decl, ctx) {
  try {
    var to = renderNotifyText_(decl.to, ctx);
    if (to.indexOf('{') !== -1) {
      // Destinatario sin resolver: NO se gasta cuota diaria con un
      // destinatario inventado. Ruidoso (O5), no silencioso.
      console.error(
        '[notifications] ' +
          ctx.action +
          ' ' +
          ctx.resource.id +
          '/' +
          String(ctx.key) +
          ': destinatario sin resolver "' +
          decl.to +
          '" — no se envía',
      );
      return;
    }
    var subject =
      typeof decl.subject === 'string' && decl.subject.trim() !== ''
        ? renderNotifyText_(decl.subject, ctx)
        : ctx.resource.id + ' · ' + ctx.action;
    var body = renderNotifyText_(decl.template, ctx);
    // Cuota: MailApp = 100/día (plano gratuito). UN envío por entrada por
    // evento, SIN reintentos.
    MailApp.sendEmail(to, subject, body);
  } catch (err) {
    console.error(
      '[notifications] ' +
        ctx.action +
        ' ' +
        ctx.resource.id +
        '/' +
        String(ctx.key) +
        ': ' +
        ((err && err.message) || err) +
        ' (' +
        decl.channel +
        ' → ' +
        (typeof to === 'string' ? to : String(decl.to)) +
        ')',
    );
  }
}

// Suscriptor del bus: envía las notificaciones del recurso para la fase
// emitida. Un recurso SIN `notify` sale en silencio (una comparación): el
// costo por evento ajeno es nulo.
function runNotificationsForEvent_(ctx) {
  var resource = ctx && ctx.resource;
  var notify = resource && resource.notify;
  if (!Array.isArray(notify) || notify.length === 0) return;
  notify.forEach(function (decl) {
    if (!decl || typeof decl !== 'object') return; // validate-registry ya falló antes
    if (!notificationMatchesPhase_(decl, ctx.action)) return;
    sendNotification_(decl, ctx);
  });
}

// Auto-suscripción al cargar — el "registro" de R9.5.8 (una línea por
// fase, sin tocar 24-crud ni 30-events). Como el suscriptor queda
// registrado, `emitEvent_` nunca early-returnea para estas fases: un
// recurso SOLO con notify (sin hooks) TAMBIÉN envía.
NOTIFY_EMIT_PHASES_.forEach(function (phase) {
  onEvent_(phase, runNotificationsForEvent_);
});
