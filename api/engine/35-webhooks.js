// engine/35-webhooks — Webhooks salientes declarativos (R9.5.7, B14 · O5).
//
// El recurso declara `webhooks: [{ on, url, sign }]` (nivel recurso, NO
// dentro de operations) y el motor los entrega por HTTP cuando el bus
// emite la fase correspondiente. La puerta de entrada es la MISMA que la de
// cualquier observador externo: `onEvent_` (engine/30-events) — ni 24-crud
// ni el bus se tocan para sumar un webhook.
//
//   webhooks: [
//     { on: 'afterCreate', url: 'https://…', sign: true },
//     { on: 'delete', url: 'https://…' },   // alias legacy aceptado
//   ]
//
// Contrato de entrega (decisiones de diseño):
//   · Sólo fases POST: un webhook pre-escritura (beforeCreate) se
//     dispararía antes de saber si la escritura ocurre, y su semántica de
//     fallo no coincide con O4. Las fases permitidas se juzgan al ARRANQUE
//     (validate-registry → validateWebhooks_): un webhook inválido ROMPE
//     el arranque, no se ignora en silencio (§0.5 · fail-loud).
//   · El cuerpo es JSON `{ resource, phase, key, eventId, payload,
//     firedAt }`. `phase` es la fase EMITIDA por el CRUD (canónica): un
//     webhook declarado con el alias legacy `create` recibe
//     `phase: 'afterCreate'`, igual que la que codifica su `eventId`.
//   · `sign: true` firma el cuerpo EXACTO con HMAC-SHA256 sobre
//     AUTH_SECRET — el MISMO secreto de las sesiones (§0.5: no se inventa
//     un segundo secreto) — y lo manda en la cabecera
//     `X-Webhook-Signature` (base64url). `sign` ausente o false ⇒ sin
//     firma. El receptor verifica recomputando el HMAC sobre el cuerpo tal
//     cual lo recibe (11-auth: hmac_ + constantTimeEqual_).
//   · **El fallo del webhook NUNCA deshace la escritura** (O4 —
//     compensación, no rollback): el fetch va envuelto en try/catch y
//     cualquier error (red, HTTP ≥ 300) se REGISTRA y se sigue. Además
//    30-events aísla los errores de los suscriptores: doble red de
//     seguridad, pero el registro de acá es el que nombra al webhook.
//   · UN fetch por webhook por evento, SIN reintentos: `UrlFetchApp` tiene
//     cuota diaria por proyecto (20 000 llamadas) — una tormenta de
//     reintentos la agotaría en minutos. Reintentar (deduplicando vía
//     `ctx.eventId`) es problema del consumidor, no del motor.
//   · Entrega best-effort SÍNCRONA dentro del request que escribió: GAS no
//     ofrece colas. Un webhook lento encarece el request — conviene
//     apuntar a receptores rápidos.

// Cabecera de la firma. El receptor recomputa HMAC-SHA256 del cuerpo con
// AUTH_SECRET y compara en tiempo constante.
var WEBHOOK_SIGNATURE_HEADER_ = 'X-Webhook-Signature';

// Vocabulario EXACTO de un webhook declarado (lo valida validate-registry).
var WEBHOOK_DECL_KEYS_ = ['on', 'url', 'sign'];

// Fases que el CRUD EMITE para lo post (24-crud + emitStatusChange_). Ojo:
// los alias legacy se EMITEN con el nombre nuevo (`afterDelete`,
// `afterReorder`), y `emitEvent_` busca los suscriptores por el nombre
// EMITIDO — por eso la suscripción usa estas claves y el match contra `on`
// mira el nombre exacto Y su alias legacy (HOOK_ALIASES_).
var WEBHOOK_EMIT_PHASES_ = [
  'afterCreate',
  'afterUpdate',
  'onStatusChange',
  'afterDelete',
  'afterReorder',
];

// ¿El webhook declarado corresponde a la fase EMITIDA? Nombre exacto
// (afterCreate…) o alias legacy (create→afterCreate, delete→afterDelete…).
function webhookMatchesPhase_(decl, phase) {
  return decl.on === phase || HOOK_ALIASES_[phase] === decl.on;
}

// Entrega UN webhook. Nunca propaga: el fallo se REGISTRA y ya (O4 — la
// escritura que originó el evento ya ocurrió y es irreversible).
function deliverWebhook_(decl, ctx) {
  var body = JSON.stringify({
    resource: ctx.resource.id,
    phase: ctx.action, // fase EMITIDA (canónica), la misma que codifica eventId
    key: ctx.key === undefined || ctx.key === null ? null : ctx.key,
    eventId: ctx.eventId,
    payload: ctx.payload === undefined ? null : ctx.payload,
    firedAt: new Date().toISOString(),
  });
  try {
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: body,
      muteHttpExceptions: true, // un HTTP de error del receptor se audita, no revienta
      followRedirects: true,
    };
    if (decl.sign === true) {
      // Misma primitiva que las sesiones (11-auth): HMAC-SHA256 sobre
      // AUTH_SECRET del cuerpo EXACTO, en base64url.
      options.headers = {};
      options.headers[WEBHOOK_SIGNATURE_HEADER_] = bytesToB64Url_(hmac_(body));
    }
    var response = UrlFetchApp.fetch(decl.url, options);
    var code =
      response && typeof response.getResponseCode === 'function' ? response.getResponseCode() : 0;
    if (!(code >= 200 && code < 300)) {
      console.error(
        '[webhooks] ' +
          ctx.action +
          ' ' +
          ctx.resource.id +
          '/' +
          String(ctx.key) +
          ' → HTTP ' +
          code +
          ' (' +
          decl.url +
          ')',
      );
    }
  } catch (err) {
    console.error(
      '[webhooks] ' +
        ctx.action +
        ' ' +
        ctx.resource.id +
        '/' +
        String(ctx.key) +
        ': ' +
        ((err && err.message) || err) +
        ' (' +
        decl.url +
        ')',
    );
  }
}

// Suscriptor del bus: entrega los webhooks del recurso para la fase
// emitida. Un recurso SIN `webhooks` sale en silencio (una comparación):
// el costo por evento ajeno es nulo.
function runWebhooksForEvent_(ctx) {
  var resource = ctx && ctx.resource;
  var webhooks = resource && resource.webhooks;
  if (!Array.isArray(webhooks) || webhooks.length === 0) return;
  webhooks.forEach(function (decl) {
    if (!decl || typeof decl !== 'object') return; // validate-registry ya falló antes
    if (!webhookMatchesPhase_(decl, ctx.action)) return;
    deliverWebhook_(decl, ctx);
  });
}

// Auto-suscripción al cargar — el "registro" de R9.5.7 (una línea por
// fase, sin tocar 24-crud ni 30-events). Como el suscriptor queda
// registrado, `emitEvent_` nunca early-returnea para estas fases: un
// recurso SOLO con webhooks (sin hooks) TAMBIÉN entrega.
WEBHOOK_EMIT_PHASES_.forEach(function (phase) {
  onEvent_(phase, runWebhooksForEvent_);
});
