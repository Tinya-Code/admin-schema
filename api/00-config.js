// 00-config — Constantes no sensibles + MANIFIESTO de propiedades.
//
// Regla (baseapi §10.4): aquí sólo viven NOMBRES y límites.
// Jamás valores de propiedades ni secretos.
// Top-level: sólo declaraciones (cero referencias a otros archivos al cargar).

// Límites y parámetros del motor (no sensibles, versionados en código).
var CONFIG = {
  ORDER_STEP: 1000, // paso entre posiciones al reordenar (baseapi §9)
  MAX_FEATURED: 6, // máximo de destacados (R4)
  MAX_RELATED: 4, // máximo de relacionados (R5)
  CACHE_TTL_SECONDS: 300, // TTL corto de caché por recurso (baseapi §2.2 #9)
  ENVIRONMENTS: ['dev', 'prod'], // valores permitidos de ENV
  UPLOAD_ALLOWED_FORMATS: 'jpg,jpeg,png,webp', // formatos firmados (baseapi §11.3)
  // Presupuesto del login en ms. Es LA palanca del KDF (R2.1b/D19): manda en
  // cuántas iteraciones cabe. auth.md §4.6 sólo dice «ajustadas a lo que
  // tolere el tiempo de ejecución», así que éste es ese ajuste hecho explícito.
  KDF_BUDGET_MS: 400,
  KDF_ITERATIONS_MIN: 1000, // suelo de seguridad: nunca por debajo, aunque sobre presupuesto
  KDF_ITERATIONS_MAX: 100000, // techo: evita un coste desbocado si la medida sale rara

  // ── Sesión (D10-2 · auth.md §3.2) ───────────────────────────────────────
  // El TTL lo PONE el back en cada token (iat/exp), así que éstas son las
  // constantes que gobiernan tanto emitir como verificar.
  TOKEN_TTL_HOURS: 6, // TTL de cada token, alineado con el máximo de CacheService
  SESSION_MAX_DAYS: 7, // tope ABSOLUTO de la sesión, aunque se renueve en deslizante
  TOKEN_RENEW_RATIO: 0.25, // si queda menos % de vida ⇒ meta.renewedToken
};

// Manifiesto de propiedades (baseapi §10.3–§10.4).
//   source:   'manual'    → las carga una persona (editarlas puede romper)
//             'generated' → las crea el setup (idempotente)
//   generator:'token'     → quién genera el valor si falta (null = otro paso del setup)
//   secret:   true        → nunca se muestra ni se registra en logs
var PROP_MANIFEST = [
  {
    name: 'SPREADSHEET_ID',
    required: true,
    secret: false,
    source: 'generated',
    generator: null,
    note: 'Libro de Sheets (lo genera setup/01-setup-spreadsheet)',
  },
  {
    name: 'AUTH_SECRET',
    required: true,
    secret: true,
    source: 'generated',
    generator: null,
    // Nunca se muestra: sólo firma y verifica HMAC (R2.3). Rotarla cierra
    // TODAS las sesiones — es el «cerrar sesión global» de auth.md §4.7.
    note: 'Secreto HMAC de los tokens de sesión (lo genera setupAuth_ — R2.2)',
  },
  {
    name: 'CLOUDINARY_CLOUD_NAME',
    required: true,
    secret: false,
    source: 'manual',
    generator: null,
    note: 'Identifica el cloud; también valida el origen de image_url',
  },
  {
    name: 'CLOUDINARY_API_KEY',
    required: true,
    secret: false,
    source: 'manual',
    generator: null,
    note: 'Se entrega al navegador en la firma de subida',
  },
  {
    name: 'CLOUDINARY_API_SECRET',
    required: true,
    secret: true,
    source: 'manual',
    generator: null,
    note: 'CRÍTICO: firma subidas; nunca sale del backend',
  },
  {
    name: 'CLOUDINARY_BASE_FOLDER',
    required: true,
    secret: false,
    source: 'manual',
    generator: null,
    note: 'Carpeta raíz en Cloudinary (ej. nombre del negocio)',
  },
  {
    name: 'ENV',
    required: true,
    secret: false,
    source: 'manual',
    generator: null,
    note: 'dev | prod',
  },
  {
    name: 'SCHEMA_VERSION',
    required: true,
    secret: false,
    source: 'generated',
    generator: null,
    note: 'Versión del schema aplicada (lo genera setup/03-setup-drift)',
  },
  {
    name: 'KDF_ITERATIONS',
    required: true,
    // No es un secreto: el recuento viaja dentro de CADA pass_hash
    // (`s256$<iteraciones>$<hex>`), así que ocultarlo sería security by
    // obscurity. Se declara para que setupAuth_() lo mida, no para esconderlo.
    secret: false,
    source: 'generated',
    generator: null,
    note: 'Coste del KDF de contraseñas — lo MIDE y guarda setupAuth_ (R2.1b)',
  },
  // ── Administrador inicial (D24) ────────────────────────────────────────
  // El operador sólo CAMBIA el valor: `checkProperties()` crea la clave vacía
  // si no existe, así que nunca hay que estar poniendo clave y valor a mano.
  // bootstrapAdmin_() las lee en este orden: argumentos > props > dueño.
  {
    name: 'ADMIN_EMAIL',
    required: true,
    secret: false,
    source: 'manual',
    generator: null,
    note: 'Email del administrador inicial (lo consume bootstrapAdmin_)',
  },
  {
    name: 'ADMIN_PASSWORD',
    required: true,
    // Sólo se usa PARA HASHEAR en `bootstrapAdmin_`; el hash vive en `_users`
    // y nunca se compara con esto de nuevo. Mismo criterio que
    // CLOUDINARY_API_SECRET: secreto en Script Properties, jamás en logs ni
    // en respuestas (Props.require sólo devuelve el nombre si falta).
    secret: true,
    source: 'manual',
    generator: null,
    note: 'Contraseña del administrador inicial — la usa bootstrapAdmin_ una sola vez',
  },
];
