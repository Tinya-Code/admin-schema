// schema/resources/dashboard — Descriptor del panel de control (Dashboard).
// Front: src/app/schemas/dashboard.schema.ts

REGISTRY.resources.dashboard = {
  id: 'dashboard',
  kind: 'dashboard',
  sheet: null, // M1: guard de hoja — descriptor sin storage (02-setup-sheets.js:119)
  keyField: 'id',
  titleField: 'label',
  exposeToFront: true,
  fields: [],
  policies: {
    access: { read: 'admin', write: 'admin' },
  },
};
