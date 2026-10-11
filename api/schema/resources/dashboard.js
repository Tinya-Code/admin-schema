// schema/resources/dashboard — Descriptor del panel de control (Dashboard).
// Front: src/app/schemas/dashboard.schema.ts

REGISTRY.resources.dashboard = {
  id: 'dashboard',
  kind: 'dashboard',
  // R8.6: guard confirmado — getSheetSpecs_ (02-setup-sheets.js:119) sale
  // con `if (!resource.sheet) return;`: sin hoja no hay spec, no hay drift
  // y no hay seed. El descriptor no tiene storage propio; lee las vistas
  // declaradas de otros recursos.
  sheet: null, // M1: guard de hoja — descriptor sin storage (02-setup-sheets.js:119)
  keyField: 'id',
  titleField: 'label',
  // R8.6: se mantiene `exposeToFront: true` aunque `fields: []` — la
  // proyección /admin/schema describe recursos ADMINISTRABLES con su
  // endpoint, y el dashboard es un recurso real con endpoint propio
  // (GET /admin/dashboard). Ocultarlo dejaría la proyección incompleta sin
  // ahorrar nada: el front consume su dashboard.schema.ts estático, no esta
  // proyección (registry.ts). Coherente con la equivalencia admin de R7.2.
  exposeToFront: true,
  fields: [],
  policies: {
    // R8.6: coherente con el endpoint (/admin/dashboard, audiencia admin) y
    // con el resto de recursos administrables: read/write admin.
    access: { read: 'admin', write: 'admin' },
  },
};
