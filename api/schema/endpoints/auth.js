// schema/endpoints/auth — Endpoints de sesión (R2.5 — auth.md §4.3).
//
// La convención del CÓDIGO gana sobre la del snippet de §4.3, y aquí hay
// tres diferencias que importan:
//
//   • Id camelCase + `route`/`method` explícitos, no la clave de path del
//     snippet: así se declara todo el resto del repo y el router resuelve
//     por `route`.
//   • `limits: '10/min'`, no `{ perMinute: 10 }`: es el formato que leen
//     normalizeLimits_ (10-router) y parseLimitSpec_ (26-lock-cache). Con la
//     forma del §4.3 se normalizaría a null y NO EXISTIRÍA el límite.
//   • Sin `idToken`: §9.1 eligió la opción B (contraseña) y descartó Google,
//     así que ese campo no lo acepta nadie. Declararlo sería una mentira.
//   • `handler: 'handleAuthLogin'` y no `authLogin` como dice §4.3: en este
//     repo el handler de un endpoint es `handle` + el id del endpoint
//     (handleDashboard, handleEvents, handlePinVerify, handlePublicOrder,
//     handleSchema, handleSheetDrift, handleUploadSignature — 7 de 7).
//     El nombre es arbitrario; romperlo con tres ficheros es ruido puro.
//
// `input` lo declara B2 y LO VALIDA el router antes de llamar al handler
// (R5.1): un email mal formado corta con 422 y la contraseña ni se toca.

// Login: público y con límite — es el endpoint que más conviene frenar
// (fuerza bruta). `read`/`write` es el umbral GLOBAL de §4.3 (10/min, el más
// alto de los dos, como pide §4.6); `account` es la ventana de FALLOS por
// email de §4.6 (5 en 15 minutos ⇒ el 6.º intento cae en RATE_LIMITED, que
// es exactamente lo que fija §8). Ambos se ejecutan en `26-lock-cache`.
//
// La forma objeto en vez del string '10/min' es lo que hace caber las dos
// ventanas en la MISMA declaración — §4.3 dibuja `limits` como objeto, y el
// string sólo era suficiente cuando había una sola ventana. read/write
// quedan explícitos igual que antes: sin ellos, un POST que se declare
// `method: 'GET'` en el cuerpo saldría del paso de límite.
REGISTRY.endpoints.authLogin = {
  route: '/auth/login',
  method: 'POST',
  access: 'public',
  limits: { read: '10/min', write: '10/min', account: '5/15min' },
  handler: 'handleAuthLogin',
  input: {
    email: { type: 'email' },
    password: { type: 'secret' },
  },
  // Sólo la forma: `token` y `user` tienen que venir SÍ o SÍ (el detalle de
  // `user` es whitelist de publicUser_, no de este contrato).
  output: {
    token: { type: 'text', required: true },
    user: { type: 'group', required: true },
  },
  since: '1.0',
};

// Los endpoints de sesión exigen sesión (§4.3). Sin `limits`: §4.3 no les
// declara ninguno, y añadir uno sería inventar una regla que nadie pidió.
REGISTRY.endpoints.authMe = {
  route: '/auth/me',
  method: 'POST',
  access: 'session',
  handler: 'handleAuthMe',
  output: { user: { type: 'group', required: true } },
  since: '1.0',
};

REGISTRY.endpoints.authLogout = {
  route: '/auth/logout',
  method: 'POST',
  access: 'session',
  handler: 'handleAuthLogout',
  output: { loggedOut: { type: 'boolean', required: true } },
  since: '1.0',
};

// Persistente y aplicable a todas las pestañas/dispositivos del usuario.
// `token_version` es autoritativo; snapshots existentes pueden tardar hasta
// 60 s en expirar (auth.md §6).
REGISTRY.endpoints.authLogoutAll = {
  route: '/auth/logout-all',
  method: 'POST',
  access: 'session',
  handler: 'handleAuthLogoutAll',
  output: {
    sessionsRevoked: { type: 'boolean', required: true },
    effectiveWithinSeconds: { type: 'number', required: true },
  },
  since: '1.0',
};

// /auth/refresh no hace falta: la renovación es deslizante (§3.2).
