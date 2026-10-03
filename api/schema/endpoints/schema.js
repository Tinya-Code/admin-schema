// schema/endpoints/schema — Rutas de introspección del schema (§4, §9).
//
// Declarado, no cableado: el router deriva sus rutas de
// `REGISTRY.endpoints` (Fase 2, adiós a las tablas del router).
// El handler vive en `primitives/handlers/schema` y ya es 100% genérico:
// sólo recorre `REGISTRY.resources` (decisión F2-5).
// `method`/`access`/`limits` son DATOS declarativos: el router resuelve la
// política de la ruta y aplica auth + rate-limit desde ellos (F6, §8).

REGISTRY.endpoints.schema = {
  route: '/admin/schema',
  method: 'GET',
  access: 'admin',
  limits: null,
  handler: 'handleSchema',
};
