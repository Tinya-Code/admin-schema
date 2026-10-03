// core/11-auth — Autenticación por política de ruta (baseapi §2.1 #1, §10.3).
//
// El token viaja en el CUERPO (los `doGet/doPost` de GAS no exponen
// cabeceras) y NUNCA en la URL ni en logs. Al recibir: se hashea con
// SHA-256 y se compara con la propiedad ADMIN_TOKEN_HASH en tiempo
// constante. Sin hash configurado → 500 claro (sin valores).
//
// F6 (§8): el NIVEL de acceso lo decide la política de la ruta resuelta
// (endpoint.access / resource.policies.access), nunca el prefijo del path.
// El router llama a requireAccess_ con ese nivel; sin política ⇒ 'admin'
// (fail-closed).

// Aplica el nivel declarado para el grupo de operación (F6-2).
//   'public' → no exige token (lectura pública futura).
//   'admin'  → token admin válido.
//   <rol>    → hoy TODOS los roles colapsan al token admin: sólo existe un
//              token en el entorno; cuando haya roles se sustituye acá sin
//              tocar el router (decisión F6-3 anotada en el plan).
// Nivel desconocido o ausente → admin (fail-closed).
function requireAccess_(token, level) {
  if (level === 'public') return true;
  return requireAdmin_(token);
}

// Exige token válido para /admin/*: lanza apiError_(401) si no pasa.
function requireAdmin_(token) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw apiError_(401, 'No autorizado');
  }
  var expected = Props.require('ADMIN_TOKEN_HASH'); // falta → 500 con el nombre
  if (!constantTimeEqual_(Props.hashText(token), expected)) {
    throw apiError_(401, 'No autorizado');
  }
  return true;
}

// Comparación en tiempo constante de dos textos (mismo hash ⇒ mismos bytes).
function constantTimeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
