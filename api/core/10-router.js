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
  var i;

  // 1) endpoints declarados (schema/endpoints/*)
  var endpointIds = Object.keys(REGISTRY.endpoints);
  for (i = 0; i < endpointIds.length; i++) {
    var endpoint = REGISTRY.endpoints[endpointIds[i]];
    exact[endpoint.route] = {
      kind: 'handler',
      handler: endpoint.handler,
      params: {},
      policy: {
        scope: 'endpoint:' + endpointIds[i],
        access: normalizeAccess_(endpoint.access),
        limits: normalizeLimits_(endpoint.limits),
      },
    };
  }

  // 2) resources: scope y ruta salen del resource (F2-3). 'admin' es el
  //    scope por defecto; `route` sólo existe como override. La política
  //    sale de resource.policies (F6-1) y se calcula UNA vez por ejecución.
  var resourceIds = Object.keys(REGISTRY.resources);
  for (i = 0; i < resourceIds.length; i++) {
    var resource = getResourceSchema(resourceIds[i]);
    if (resource === null) continue;
    var base = resourceRoute_(resource);
    var entry = { resource: resource, policy: policyFor_(resource) };
    if (resource.kind === 'collection') keyed[base] = entry;
    else
      exact[base] = {
        kind: 'resource',
        resource: resource,
        params: {},
        policy: entry.policy,
      };
  }

  ROUTE_TABLE_ = { exact: exact, keyed: keyed };
  return ROUTE_TABLE_;
}

// Ruta base efectiva de un recurso (F2-3): `route` como override o
// /<scope>/<id> con scope por defecto 'admin'. FUENTE ÚNICA de la ruta:
// la tabla de rutas de acá y la proyección pública de `/admin/schema`
// (F7-1, primitives/handlers/schema) derivan de esta misma función.
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
function normalizeLimits_(declared) {
  if (typeof declared === 'string' && declared !== '') {
    return { read: declared, write: declared };
  }
  return {
    read: declared && typeof declared.read === 'string' ? declared.read : null,
    write: declared && typeof declared.write === 'string' ? declared.write : null,
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
    requireAccess_(envelope.token, policyAccess_(policy, group)); // 401
    if (resolveError !== null) throw resolveError; // 400 (clave inválida)
    if (route === null) {
      throw apiError_(404, 'Ruta no encontrada: ' + truncate_(envelope.path));
    }
    enforceRateLimit_(policy, group); // 429 (F6-3, §8)
    return dispatchRoute_(route, envelope);
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
  if (table.keyed[path] !== undefined) {
    var baseHit = table.keyed[path];
    return {
      kind: 'resource',
      resource: baseHit.resource,
      params: {},
      policy: baseHit.policy,
    };
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
  params[owner.resource.keyField] = key; // { slug: 'mi-slug' } según el recurso
  return { kind: 'resource', resource: owner.resource, params: params, policy: owner.policy };
}

// Delega según la ruta y envuelve la respuesta plana en el envelope 200.
// Los handlers DEVUELVEN datos (no TextOutput): el envoltorio es acá.
function dispatchRoute_(route, envelope) {
  var request = {
    method: envelope.method,
    path: envelope.path,
    params: route.params,
    payload: envelope.payload,
  };
  if (route.kind === 'handler') {
    var handler = globalThis[route.handler];
    if (typeof handler !== 'function') {
      throw apiError_(500, 'Función no disponible: ' + route.handler);
    }
    return respond_(handler(envelope.payload, request));
  }
  // Motor genérico (engine/24-crud): dispatchResource_(resource, request)
  var dispatch = globalThis['dispatchResource_'];
  if (typeof dispatch !== 'function') {
    throw apiError_(500, 'El motor de recursos no está disponible');
  }
  return respond_(dispatch(route.resource, request));
}

// ── Utilidades internas ───────────────────────────────────────────────────

function truncate_(text) {
  return text.length > 200 ? text.slice(0, 200) + '…' : text;
}

// Borra TODAS las ocurrencias del token de un texto previo al log.
function scrubToken_(text, token) {
  return String(text).split(token).join('[token]');
}
