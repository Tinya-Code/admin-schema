// 00-registry — Registro único declarativo: recursos, tipos, enums, endpoints
// y primitivas (mejoras §3). Va PRIMERO en filePushOrder.
//
// Patrón: intérprete + DSL declarativo + registros de primitivas. Este
// archivo declara el objeto REGISTRY al que cada archivo de schema/ se
// registra a sí mismo en su top-level (asignación a literal, SIN lógica).
// Garantía de orden (F0-3, doc V8 "todos los archivos en scope global"):
// 00-registry se evalúa primero ⇒ REGISTRY existe antes de cualquier
// asignación; el resto de referencias cruzadas se resuelven en runtime
// (resolución perezosa), nunca al cargar.
//
// REGLA DE ORO (baseapi §3 / mejoras §11): recurso nuevo = 1 archivo en
// `schema/resources/<id>.js` que asigna `REGISTRY.resources.<id>`.
// Cero líneas fuera de schema/. El índice manual (04-registry) ya no existe.
//
// Top-level: sólo la declaración del registro + el lector perezoso.

const REGISTRY = {
  resources: {},
  types: {},
  enums: {},
  endpoints: {},
  ops: {},
  transforms: {},
  checks: {},
  handlers: {},
  hooks: {}, // emisión de eventos post-escritura (motor-plan T2c / M3)
};

// Devuelve el schema declarativo del recurso, o null si no existe.
// Misma firma pública histórica: la consumen core/10-router,
// engine/23-validate, engine/24-crud, primitives/handlers y setup/*
// sin cambios.
function getResourceSchema(id) {
  return REGISTRY.resources[id] || null;
}
