// schema/endpoints/sheet-drift — Reporte de drift schema ⇄ hojas (R1.2, B4).
//
// Es el half «lectura» de `sheet-check`: `setupDrift()` ya comparaba el
// schema con los headers REALES de la hoja, pero sólo era invocable a mano
// desde el editor de Apps Script (`PLAN-MEJORAS.md:692` — `clasp run` y la
// Execution API devuelven NOT_FOUND). Esa invisibilidad es justo lo que
// dejó perder `pin` en silencio (hallazgo R7 de
// doc/pedidos-rectificacion.md:230).
//
// Una ruta webapp SÍ es invocable desde Node: `scripts/sheet-drift-check.mjs`
// la llama con la misma receta de curl que `api-regression.sh`, y ahí corre
// en despliegue/CI (O3), nunca en cada request.
//
// Lectura SÓLO: el handler pasa `{ dryRun: true }`, así que no crea hojas ni
// columnas y no toca SCHEMA_VERSION. Aplicar la migración sigue siendo
// `setupDrift()` desde el editor (R1.4).

REGISTRY.endpoints.sheetDrift = {
  route: '/admin/sheet-drift',
  method: 'GET',
  access: 'admin',
  limits: null,
  handler: 'handleSheetDrift',
};
