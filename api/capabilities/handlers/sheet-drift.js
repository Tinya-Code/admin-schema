// primitives/handlers/sheet-drift — Reporte de drift en modo sólo-lectura.
//
// Un solo propósito: exponer `setupDrift({ dryRun: true })` por la ruta
// declarada en schema/endpoints/sheet-drift. Toda la lógica de comparación
// vive en setup/03-setup-drift — acá NO se duplica, así el check de CI y la
// migración manual ven exactamente lo mismo (R1.2).
//
// Salida: el reporte completo de setupDrift: { ok, createdSheets, added,
// orphans, blocked, schemaVersion, schemaVersionChanged }.
//
//   createdSheets / added → faltantes (el check los trata como rojo)
//   orphans                → sobrantes: sólo informativo (§14 jamás borra)
//   blocked                → conflictos de tipo con datos existentes

function handleSheetDrift() {
  return setupDrift({ dryRun: true });
}

REGISTRY.handlers.handleSheetDrift = handleSheetDrift;
