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
    name: 'ADMIN_TOKEN_HASH',
    required: true,
    secret: true,
    source: 'generated',
    generator: 'token',
    note: 'Hash SHA-256 del token admin (lo genera este setup)',
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
];
