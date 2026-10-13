// core/10-router — Punto de entrada del web app (baseapi §2.1, §8).
//
// Todo llega como POST con cuerpo `text/plain` que es un JSON
// { token, method, path, payload }:
//   - Sin headers custom ni application/json ⇒ sin preflight/CORS (criterio 11).
//   - El método LÓGICO va en el cuerpo (el HTTP es siempre POST) y se extrae
//     ANTES de validar payload.
//   - El token vive sólo en el cuerpo: jamás en la URL (⇒ ni en logs de GAS).
// `path` se resuelve contra una tabla DERIVADA de `REGISTRY` (Fase 2): este
// archivo no conoce ningún recurso ni endpoint por nombre (§4, §11.1).
// F6 (§8): la tabla lleva la POLÍTICA de cada ruta (access/limits del
// endpoint o de resource.policies); auth y rate-limit se aplican desde
// ella — nunca por prefijo del path. Sin política ⇒ admin (fail-closed).
// Los errores responden vía core/12-http (siempre HTTP 200).

// Métodos lógicos admitidos en el cuerpo de la petición.
var ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// Funciones sólo ejecutables desde el editor de Apps Script (R2.2, auth.md
// §4.7). El router resuelve handlers con `globalThis[route.handler]`, así que
// un endpoint que declarara uno de estos nombres lo expondría por HTTP.
// Esta lista es la barrera; schema/validate-registry.js además la comprueba
// al cargar, para que el error salga en el arranque y no en producción.
// Debe declararse ANTES de validate-registry.js (core/ < schema/ en orden
// de carga, igual que en filePushOrder).
// `setupAll` entra en la lista aunque ninguna ruta lo declare hoy: encadena
// `bootstrapAdmin_` y crea un administrador, así que el guard tiene que
// existir ANTES de que a alguien se le ocurra declararlo (D24). Ídem
// `setupTriggers_` (R9.5.6): instala triggers de GAS con privilegios
// plenos — el cron jamás es una puerta a esto.
var EDITOR_ONLY_FNS = [
  'setupAuth_',
  'rotateAuthSecret_',
  'bootstrapAdmin_',
  'setupTriggers_',
  'setupAll',
];

// Paridad método lógico ↔ operación (F2-4): EXACTAMENTE la semántica que
// despacha engine/24-crud, hecha explícita acá para que el contrato sea
// visible y verificable:
//   GET    → list (colección sin clave) | get (con clave) | singleton
//   POST   → create
//   PUT    → update; colección sin clave con payload { reorder } → reorder
//   PATCH  → patch (misma entrada que update)
//   DELETE → delete
// Cada resource podrá declarar `operations` (§5) y esta tabla pasará a
// derivarse de ese bloque; hasta entonces es la del motor por defecto.

// Tabla de rutas derivada de REGISTRY, construida UNA vez por ejecución.
// Los archivos se re-evalúan en cada ejecución de GAS, así que este flag
// vuelve a null solo — no hace falta semáforo.
var ROUTE_TABLE_ = null;

function routeTable_() {
  if (ROUTE_TABLE_ !== null) return ROUTE_TABLE_;
  var exact = {}; // ruta completa → entrada (endpoints + singletons)
  var keyed = {}; // base de colección → resource (acepta /<clave> al final)
  var actions = {}; // base de colección → resource CON acciones declaradas
  var commands = {}; // base de colección → resource CON commands declarados
  var io = {}; // base de colección → resource CON operations.export/import
  var i;

  // 1) endpoints declarados (schema/endpoints/*)
  var endpointIds = Object.keys(REGISTRY.endpoints);
  for (i = 0; i < endpointIds.length; i++) {
    var endpoint = REGISTRY.endpoints[endpointIds[i]];
    var route = endpoint.route;
    var paramMatch = route ? /^(.+)\/:([A-Za-z0-9_]+)$/.exec(route) : null;
    var entry = {
      kind: 'handler',
      handler: endpoint.handler,
      params: {},
      // Contrato declarativo (B2 · R5.1): el router valida la ENTRADA antes
      // de llamar al handler y, en dev, la SALIDA después. `null` = sin
      // declaración ⇒ el endpoint se comporta exactamente como siempre.
      input: endpoint.input === undefined ? null : endpoint.input,
      output: endpoint.output === undefined ? null : endpoint.output,
      policy: {
        scope: 'endpoint:' + endpointIds[i],
        access: normalizeAccess_(endpoint.access),
        limits: normalizeLimits_(endpoint.limits),
      },
    };
    if (paramMatch) {
      entry.paramKey = paramMatch[2];
      keyed[paramMatch[1]] = entry;
    } else {
      exact[route] = entry;
    }
  }

  // 2) resources: scope y ruta salen del resource (F2-3). 'admin' es el
  //    scope por defecto; `route` sólo existe como override. La política
  //    sale de resource.policies (F6-1) y se calcula UNA vez por ejecución.
  var resourceIds = Object.keys(REGISTRY.resources);
  for (i = 0; i < resourceIds.length; i++) {
    var resource = getResourceSchema(resourceIds[i]);
    if (resource === null) continue;
    // Un descriptor sin storage (`sheet: null`, p. ej. el dashboard) no tiene
    // filas que servir: publicar su ruta sólo produce 500 "Falta la hoja", y
    // además PISARÍA la de un endpoint homónimo, porque los endpoints se
    // cargan primero en `exact` y ésta es la misma clave (F2-3: la ruta sale
    // del resource, pero sólo si hay storage que servir).
    if (resource.sheet === null || resource.sheet === undefined) continue;
    var base = resourceRoute_(resource);
    var entry = { resource: resource, policy: policyFor_(resource) };
    if (resource.kind === 'collection') {
      keyed[base] = entry;
      // Acciones de dominio (B3 · R5.4): sólo si el recurso declara `actions`.
      // Un recurso sin acciones no publica la ruta y responde 404, igual que
      // el resto de lo no declarado.
      if (
        resource.actions &&
        typeof resource.actions === 'object' &&
        Object.keys(resource.actions).length > 0
      ) {
        actions[base] = { resource: resource, policy: actionsPolicy_(resource, entry.policy) };
      }
      if (
        resource.commands &&
        typeof resource.commands === 'object' &&
        Object.keys(resource.commands).length > 0
      ) {
        var commandBase = resource.commandsRoute || base;
        commands[commandBase] = { resource: resource, policy: entry.policy };
      }
      // Import/Export declarativo (R9.5.4 · O2): la ruta sale del recurso,
      // como en actions/commands. SÓLO si declara operations.export o
      // operations.import encendido; sin declaración no hay ruta (404).
      // `export`/`import` son sufijos reservados en estas colecciones.
      var ops = resource.operations;
      if (ops && (ops.export || ops.import)) {
        io[base] = { resource: resource, policy: ioPolicy_(entry.policy) };
      }
    } else
      exact[base] = {
        kind: 'resource',
        resource: resource,
        params: {},
        policy: entry.policy,
      };
  }

  ROUTE_TABLE_ = { exact: exact, keyed: keyed, actions: actions, commands: commands, io: io };
  return ROUTE_TABLE_;
}

// Política de las rutas de import/export (R9.5.4). El router sólo puede
// exigir UN nivel por ruta: el read del recurso. Pero un export es un
// VOLCADO masivo, más que un `get` puntual — si el recurso es de lectura
// pública, el volcado sube a sesión (fail-closed: público lee uno, no el
// archivo entero). El import es escritura y obedece la política del
// recurso sin tocar.
function ioPolicy_(policy) {
  var read = policy.access && policy.access.read ? policy.access.read : 'admin';
  if (normalizeAccessLevel_(read) !== 'public') return policy;
  return {
    scope: policy.scope,
    access: { read: 'session', write: policy.access.write },
    limits: policy.limits,
  };
}

// Política de la ruta de acciones (B3 · R5.4). El router sólo puede exigir
// UN nivel por ruta, pero cada acción puede exigir el SUYO: ésta función
// sólo se asegura de que HAYA identidad que mirar. Si el recurso es público
// y alguna acción declara `access`, el `write` de la ruta sube a `session`
// (verifySession_ corre y `request.user` llega); el nivel exacto de cada
// acción lo aplica `dispatchAction_`. Un recurso NO público conserva su
// política: ahí ya hay identidad.
function actionsPolicy_(resource, entryPolicy) {
  var needsIdentity = Object.keys(resource.actions).some(function (name) {
    var declared = resource.actions[name];
    if (!declared || typeof declared !== 'object') return false;
    return (
      typeof declared.access === 'string' &&
      declared.access !== '' &&
      normalizeAccessLevel_(declared.access) !== 'public'
    );
  });
  // La política del recurso es { scope, access: { read, write }, limits }:
  // sólo se toca el `write` de ese bloque.
  var write = entryPolicy.access ? entryPolicy.access.write : undefined;
  if (!needsIdentity || normalizeAccessLevel_(write) !== 'public') return entryPolicy;
  return {
    scope: entryPolicy.scope,
    access: { read: entryPolicy.access.read, write: 'session' },
    limits: entryPolicy.limits,
  };
}

// Ruta base efectiva de un recurso (F2-3): `route` como override o
// /<scope>/<id> con scope por defecto 'admin'. FUENTE ÚNICA de la ruta:
// la tabla de rutas de acá y la proyección pública de `/admin/schema`
// (F7-1, capabilities/handlers/schema) derivan de esta misma función.
function resourceRoute_(resource) {
  return resource.route || '/' + (resource.scope || 'admin') + '/' + resource.id;
}

// ── Políticas de ruta (F6, §8) ─────────────────────────────────────────────
// El router sólo NORMALIZA lo declarado; el significado lo tienen 11-auth
// (nivel de acceso) y 26-lock-cache (rate-limit). Sin declaración ⇒ el
// valor fail-closed: admin / sin límite.

// `access` declarado: string (igual para lectura y escritura) o
// { read, write } por grupo de operación (GET ⇒ read; resto ⇒ write).
function normalizeAccess_(declared) {
  if (typeof declared === 'string' && declared !== '') {
    return { read: declared, write: declared };
  }
  return {
    read:
      declared && typeof declared.read === 'string' && declared.read !== ''
        ? declared.read
        : 'admin',
    write:
      declared && typeof declared.write === 'string' && declared.write !== ''
        ? declared.write
        : 'admin',
  };
}

// `limits` declarado: string ('<n>/min') o { read, write }. Ausencia ⇒ null.
//
// Un objeto puede llevar además `account` (R2.13, auth.md §4.6): la ventana
// de fallos por cuenta del login. No es un grupo de método — el router no
// lo lee; lo recibe el handler en `request.limits` y lo ejecuta
// `26-lock-cache`. Se conserva aquí para que el que declara y el que ejecuta
// lean la MISMA declaración.
function normalizeLimits_(declared) {
  if (typeof declared === 'string' && declared !== '') {
    return { read: declared, write: declared, account: null };
  }
  return {
    read: declared && typeof declared.read === 'string' ? declared.read : null,
    write: declared && typeof declared.write === 'string' ? declared.write : null,
    account: declared && typeof declared.account === 'string' ? declared.account : null,
  };
}

// Política de un recurso: resource.policies (F6-1). Sin bloque ⇒ fail-closed.
function policyFor_(resource) {
  var policies = resource.policies || {};
  return {
    scope: 'resource:' + resource.id,
    access: normalizeAccess_(policies.access),
    limits: normalizeLimits_(policies.limits),
  };
}

// Nivel de acceso efectivo de un grupo; sin política ⇒ 'admin' (F6-2).
function policyAccess_(policy, group) {
  if (!policy || !policy.access) return 'admin';
  return policy.access[group] || 'admin';
}

// GET no tiene sentido con el token en el cuerpo: se explica el contrato.
function doGet() {
  return respondError_(
    400,
    'Este servicio sólo acepta POST con cuerpo JSON { token, method, path, payload }',
  );
}

// Punto de entrada principal: parsea → resuelve → autentica por política →
// aplica límite → delega (F6-2: el orden preserva los códigos actuales:
// 400 de parseo antes que todo; 401 antes que 400/404 de resolución).
function doPost(e) {
  var envelope = null;
  try {
    envelope = parseEnvelope_(e); // 400
    // Resuelve PRIMERO sólo para leer la política de acceso; si la
    // resolución falla (clave inválida) el error se difiere hasta después
    // del auth, como antes de F6.
    var route = null;
    var resolveError = null;
    try {
      route = resolveRoute_(envelope.path);
    } catch (routeError) {
      resolveError = routeError;
    }
    var policy = route !== null ? route.policy : null; // null ⇒ fail-closed
    var group = envelope.method === 'GET' ? 'read' : 'write';
    // §3.4: la cadena corre ANTES que cualquier 400/404 de resolución, como
    // antes — 401 primero, que es lo que el orden actual garantiza. En rutas
    // `public` no se verifica nada (el nivel ya lo normaliza abajo).
    var accessLevel = normalizeAccessLevel_(policyAccess_(policy, group));
    var session = null;
    if (accessLevel !== 'public') session = verifySession_(envelope.token);
    requireAccess_(session === null ? null : session.user, accessLevel); // 401/403
    if (resolveError !== null) throw resolveError; // 400 (clave inválida)
    if (route === null) {
      throw apiError_(404, 'Ruta no encontrada: ' + truncate_(envelope.path));
    }
    enforceRateLimit_(policy, group); // 429 (F6-3, §8)
    return dispatchRoute_(route, envelope, session);
  } catch (err) {
    // El token NUNCA llega a un log ni a una respuesta (baseapi §10.2).
    if (envelope && typeof envelope.token === 'string' && envelope.token !== '') {
      if (err && err.stack) err.stack = scrubToken_(err.stack, envelope.token);
      if (err && err.message) err.message = scrubToken_(String(err.message), envelope.token);
    }
    return errorResponse_(err);
  }
}

// Valida el cuerpo y arma el envelope. Orden del plan: method PRIMERO,
// después path y payload.
function parseEnvelope_(e) {
  var contents = e && e.postData && e.postData.contents;
  if (!contents) {
    throw apiError_(400, 'Falta el cuerpo JSON: { token, method, path, payload }');
  }

  var body;
  try {
    body = JSON.parse(contents);
  } catch (parseError) {
    throw apiError_(400, 'El cuerpo no es JSON válido');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw apiError_(400, 'El cuerpo debe ser un objeto JSON');
  }

  // 1) method (antes de tocar el payload)
  var method =
    body.method === undefined || body.method === null ? '' : String(body.method).toUpperCase();
  if (ALLOWED_METHODS.indexOf(method) === -1) {
    throw apiError_(400, 'Método inválido: se espera GET, POST, PUT, PATCH o DELETE');
  }

  // 2) path
  if (typeof body.path !== 'string' || body.path.trim() === '') {
    throw apiError_(400, 'Falta path (p. ej. /<scope>/<recurso>)');
  }

  // 3) payload
  var payload = body.payload === undefined || body.payload === null ? {} : body.payload;
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw apiError_(400, 'payload debe ser un objeto JSON');
  }

  return {
    token: body.token,
    method: method,
    path: normalizePath_(body.path),
    payload: payload,
  };
}

// Normaliza la ruta: recorta query/hash, garantiza '/' inicial y quita
// la barra final (salvo la raíz).
function normalizePath_(path) {
  var clean = String(path).trim();
  var cut = clean.search(/[?#]/);
  if (cut !== -1) clean = clean.slice(0, cut);
  if (clean.charAt(0) !== '/') clean = '/' + clean;
  while (clean.length > 1 && clean.charAt(clean.length - 1) === '/') {
    clean = clean.slice(0, -1);
  }
  return clean;
}

// Tabla de rutas → nada | { kind: 'handler'|'resource', … }.
// Derivada de REGISTRY (Fase 2): endpoints y resources declaran sus rutas;
// este módulo sólo resuelve el path contra esa tabla.
//   1) ruta exacta (endpoints, singletons, listados)
//   2) ruta con clave: <base de colección>/<clave> (sólo colecciones;
//      los singletons no llevan clave)
function resolveRoute_(path) {
  var table = routeTable_();
  if (table.exact[path] !== undefined) return table.exact[path];
  if (table.keyed[path] !== undefined && table.keyed[path].resource) {
    var baseHit = table.keyed[path];
    return {
      kind: 'resource',
      resource: baseHit.resource,
      params: {},
      policy: baseHit.policy,
    };
  }

  // Comandos: /<scope>/<resource>/<key>/commands/<command>. El formato es
  // deliberadamente independiente de la clave de recurso y no acepta
  // segmentos adicionales.
  var commandMatch = /^(.+)\/([^/]+)\/commands\/([A-Za-z0-9_-]+)$/.exec(path);
  if (commandMatch) {
    var commandOwner = table.commands[commandMatch[1]];
    if (commandOwner !== undefined) {
      var commandKey;
      try {
        commandKey = decodeURIComponent(commandMatch[2]);
      } catch (commandDecodeError) {
        throw apiError_(400, 'Clave inválida en la ruta');
      }
      if (commandKey === '') throw apiError_(400, 'Falta la clave del registro en la ruta');
      var commandName = commandMatch[3];
      var commandDecl = Object.prototype.hasOwnProperty.call(
        commandOwner.resource.commands,
        commandName,
      )
        ? commandOwner.resource.commands[commandName]
        : null;
      var commandPolicy = commandDecl
        ? {
            scope: 'command:' + commandOwner.resource.id + ':' + commandName,
            access: normalizeAccess_(commandDecl.access),
            limits: normalizeLimits_(commandDecl.limits),
          }
        : commandOwner.policy;
      var commandParams = {};
      commandParams[commandOwner.resource.keyField] = commandKey;
      return {
        kind: 'command',
        resource: commandOwner.resource,
        command: commandName,
        commandDecl: commandDecl,
        params: commandParams,
        policy: commandPolicy,
      };
    }
  }

  // 3) acciones de dominio (B3 · R5.4): <base>/<clave>/actions/<nombre>.
  //    Se resuelve ANTES que la ruta con clave genérica: esa la cortaría en
  //    `/…/actions` y devolvería null.
  var actionMatch = /^(.+)\/([^/]+)\/actions\/([^/]+)$/.exec(path);
  if (actionMatch) {
    var actionOwner = table.actions[actionMatch[1]];
    if (actionOwner !== undefined) {
      var actionParams = {};
      actionParams[actionOwner.resource.keyField] = actionMatch[2];
      return {
        kind: 'resource',
        resource: actionOwner.resource,
        params: actionParams,
        action: actionMatch[3],
        policy: actionOwner.policy,
      };
    }
  }

  // 4) Import/Export (R9.5.4 · O2): <base>/export | <base>/import. Se
  //    resuelve ANTES que la ruta con clave genérica: esa cortaría
  //    'export'/'import' como si fuera la clave de un registro. Sólo
  //    publica la ruta un recurso que declara la operación encendida.
  var ioMatch = /^(.+)\/(export|import)$/.exec(path);
  if (ioMatch) {
    var ioOwner = table.io[ioMatch[1]];
    if (ioOwner !== undefined) {
      var ioOp = ioMatch[2] === 'export' ? 'export' : 'import';
      if (operationEnabled_(declaredOperation_(ioOwner.resource, ioOp))) {
        return {
          kind: 'io',
          resource: ioOwner.resource,
          io: ioOp,
          policy: ioOwner.policy,
        };
      }
    }
  }

  var cut = path.lastIndexOf('/');
  if (cut <= 0) return null;
  var owner = table.keyed[path.slice(0, cut)];
  if (owner === undefined) return null;
  var rawKey = path.slice(cut + 1);
  if (rawKey === '') return null;

  var key;
  try {
    key = decodeURIComponent(rawKey);
  } catch (decodeError) {
    throw apiError_(400, 'Clave inválida en la ruta');
  }
  var params = {};
  if (owner.kind === 'handler') {
    params[owner.paramKey] = key;
    return {
      kind: 'handler',
      handler: owner.handler,
      params: params,
      input: owner.input,
      output: owner.output,
      policy: owner.policy,
    };
  }
  params[owner.resource.keyField] = key; // { slug: 'mi-slug' } según el recurso
  return { kind: 'resource', resource: owner.resource, params: params, policy: owner.policy };
}

// Delega según la ruta y envuelve la respuesta plana en el envelope 200.
// Los handlers DEVUELVEN datos (no TextOutput): el envoltorio es acá.
function dispatchRoute_(route, envelope, session) {
  // `session` es opcional: el router siempre lo pasa, pero invocar el
  // dispatch a mano (tests, editor) sin cadena debe seguir significando
  // «sin identidad», no «excepción al leer .user».
  session = session || null;
  var request = {
    method: envelope.method,
    path: envelope.path,
    params: route.params,
    payload: envelope.payload,
    // §3.4 paso 6: la identidad YA está verificada por la cadena. El handler
    // no comprueba nada — sólo lee. `sid` va aparte porque es lo que R2.16
    // necesita para revocar.
    user: session === null ? null : session.user,
    sid: session === null ? null : session.payload.sid,
    // Política de la ruta ya resuelta (R2.13): el handler necesita leer la
    // declaración `limits` del endpoint que le corresponde, y acá ya está
    // normalizada. Los handlers que no la usan no ven diferencia.
    limits: route.policy ? route.policy.limits : null,
  };
  if (route.kind === 'command') {
    request.command = route.command;
    var dispatchCommand = globalThis['dispatchDomainCommand_'];
    if (typeof dispatchCommand !== 'function') {
      throw apiError_(500, 'El motor de comandos no está disponible');
    }
    return respond_(
      withRenewal_(dispatchCommand(route.resource, route.commandDecl, request), session),
    );
  }
  // Acción de dominio declarada (B3 · R5.4): otro motor, otra entrada.
  if (route.action !== undefined && route.action !== null) {
    request.action = route.action;
    var dispatchAction = globalThis['dispatchAction_'];
    if (typeof dispatchAction !== 'function') {
      throw apiError_(500, 'El motor de acciones no está disponible');
    }
    return respond_(withRenewal_(dispatchAction(route.resource, request), session));
  }

  // Import/Export declarativo (R9.5.4 · O2): otro motor, otra entrada.
  if (route.kind === 'io') {
    var dispatchIo = globalThis[route.io === 'export' ? 'dispatchExport_' : 'dispatchImport_'];
    if (typeof dispatchIo !== 'function') {
      throw apiError_(500, 'El motor de import/export no está disponible');
    }
    return respond_(withRenewal_(dispatchIo(route.resource, request), session));
  }

  if (route.kind === 'handler') {
    // Sólo ejecutables desde el editor de Apps Script (R2.2 / auth.md §4.7).
    // El fallback a globalThis de más abajo significa que basta con que un
    // endpoint DECLARE el nombre para que sea invocable por HTTP: sin ésta
    // lista el «nunca por endpoint» sería cierto sólo por suerte.
    if (EDITOR_ONLY_FNS.indexOf(route.handler) !== -1) {
      throw apiError_(403, 'Función sólo ejecutable desde el editor de Apps Script');
    }
    // B2 · R5.1: la ENTRADA declarada se valida ANTES de llamar al handler.
    // Un endpoint sin `input` no cambia; con `input` inválido corta con el
    // 422 de `errors[]` que pinta el form (base.md §5) y el handler ni se
    // entera — esa es la garantía de «antes de llamar al handler».
    var inputErrors = validateEndpointInput_(route.input, envelope.payload, route.params);
    if (inputErrors.length > 0) throw validationError_(inputErrors);

    var handler =
      (REGISTRY.handlers && REGISTRY.handlers[route.handler]) || globalThis[route.handler];
    if (typeof handler !== 'function') {
      throw apiError_(500, 'Función no disponible: ' + route.handler);
    }
    var result = handler(envelope.payload, request);

    // La SALIDA declarada sólo se comprueba en dev (B2): en prod el
    // contrato documenta, no frena — una discrepancia allí ya llegó al
    // usuario y frenarla en frío sólo añadiría un 500. En dev es un
    // fallo RUIDOSO: el handler devolvió algo que su propio contrato niega.
    if (route.output && Props.isDev()) {
      var outputErrors = validateEndpointOutput_(route.output, result);
      if (outputErrors.length > 0) {
        throw apiError_(
          500,
          'Salida fuera de contrato en ' +
            truncate_(envelope.path) +
            ': ' +
            describeIssues_(outputErrors),
        );
      }
    }
    return respond_(withRenewal_(result, session));
  }
  // Motor genérico (engine/24-crud): dispatchResource_(resource, request)
  var dispatch = globalThis['dispatchResource_'];
  if (typeof dispatch !== 'function') {
    throw apiError_(500, 'El motor de recursos no está disponible');
  }
  return respond_(withRenewal_(dispatch(route.resource, request), session));
}

// §3.2 paso 7 — renovación deslizante: si queda menos del TOKEN_RENEW_RATIO
// de vida, la respuesta lleva `meta.renewedToken` y el front lo reemplaza.
//
// Sólo se AÑADE la clave `meta`: el formato plano de la respuesta no cambia
// (§4.5 manda conservarlo). Si el resultado no es un objeto no se toca —
// preferimos perder una renovación a reescribirle la forma a una respuesta
// que alguien ya está parseando.
function withRenewal_(result, session) {
  if (session === null) return result;
  var renew = renewMeta_(session.payload);
  if (renew === null) return result;
  if (result === null || typeof result !== 'object') return result;
  result.meta = renew;
  return result;
}

// ── Utilidades internas ───────────────────────────────────────────────────

// Los issues de un contrato en una sola línea (mensaje de 500 en dev).
function describeIssues_(errors) {
  return errors
    .map(function (issue) {
      return issue.path + ': ' + issue.message;
    })
    .join('; ');
}

function truncate_(text) {
  return text.length > 200 ? text.slice(0, 200) + '…' : text;
}

// Borra TODAS las ocurrencias del token de un texto previo al log.
function scrubToken_(text, token) {
  return String(text).split(token).join('[token]');
}
