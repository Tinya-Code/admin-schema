// schema/05-aux-sheets — Hojas auxiliares: fuente única de SUS columnas
// (api.md §3.10, §3.11, §3.13). Así `setup/` y `50-audit.js` no
// hardcodean cabeceras en ningún lado. `_media` NO existe: con subida
// directa a Cloudinary el backend no se entera de cada archivo (baseapi §11.7).
// Top-level: sólo declaraciones.

var AUX_SHEETS = {
  // columnas = Object.keys(SHEET_ENUMS) → ver auxSheetColumns() (runtime)
  _enums: { columns: null, note: 'una columna por lista de valores permitidos' },
  _placeholders: { columns: ['pattern'], note: 'valores o patrones prohibidos (R8)' },
  _audit_log: {
    columns: ['timestamp', 'actor', 'action', 'entity', 'entity_key', 'summary'],
    note: 'action ∈ create | update | delete | reorder (api.md §3.13)',
  },
  _pin: {
    columns: ['ref', 'pin_hash', 'created_at', 'used_at'],
    note: 'PIN de autorización de pedidos — NUNCA texto plano, sólo SHA-256 (Fase 5)',
  },
  _events: {
    columns: ['timestamp', 'event', 'ref', 'session_id', 'meta'],
    note: 'Eventos de uso del cliente — señal de adopción, NO fuente de verdad de estado (A4.13, Fase 6)',
  },
  _domain_grants: {
    columns: [
      'id',
      'secret_hash',
      'purpose',
      'resource',
      'resource_key',
      'command',
      'status',
      'expires_at',
      'max_uses',
      'uses',
      'used_operation_ids',
      'created_at',
      'updated_at',
      'issuer_id',
      'issuer_hash',
      'operation_id',
    ],
    note: 'Grants temporales de alcance limitado — nunca almacenar bearer token',
  },
  _domain_uploads: {
    columns: [
      'id',
      'grant_id',
      'profile',
      'resource',
      'resource_key',
      'provider',
      'public_id',
      'secure_url',
      'format',
      'bytes',
      'status',
      'expires_at',
      'created_at',
      'updated_at',
      'operation_id',
    ],
    note: 'Cargas verificadas vinculadas a grant, recurso y registro',
  },
  _domain_operations: {
    columns: [
      'id',
      'idempotency_hash',
      'request_hash',
      'grant_id',
      'resource',
      'resource_key',
      'command',
      'status',
      'stage',
      'plan_json',
      'result_json',
      'created_at',
      'updated_at',
    ],
    note: 'Journal recuperable para ejecuciones idempotentes de commands',
  },
  _users: {
    columns: [
      'id',
      'email',
      'name',
      'role',
      'active',
      'token_version',
      'pass_hash',
      'pass_salt',
      'last_login_at',
      'created_at',
    ],
    // Nunca expuesta: no hay recurso `users` todavía (viene en R7.6, Fase 7),
    // así que no aparece en REGISTRY.resources ni en /admin/schema.
    note: 'Usuarios y roles — hoja interna, NUNCA expuesta (auth.md §4.1). password = opción B (SHA-256 iterado con sal)',
  },
};

var AUX_SHEET_ORDER = [
  '_enums',
  '_placeholders',
  '_audit_log',
  '_pin',
  '_events',
  '_users',
  '_domain_grants',
  '_domain_uploads',
  '_domain_operations',
];

// Columnas efectivas de una hoja auxiliar (resolución en runtime: evita
// referencias a otros archivos en tiempo de carga).
function auxSheetColumns(name) {
  if (name === '_enums') return Object.keys(SHEET_ENUMS);
  return AUX_SHEETS[name].columns;
}
