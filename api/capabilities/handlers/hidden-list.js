// primitives/handlers/hidden-list — Escape hatch §6 para la vista
// 'hidden-with-reason' de products (R6, spec §7).
//
// JUSTIFICACIÓN §6 (no expresable con ops genéricas):
//   a) la población es OR de dos causas (falla por `active` O por
//      `registro_sanitario`); el `where` declarativo sólo evalúa AND;
//   b) además anota cada ítem con `reasons` — un array de motivos
//      (salida enriquecida, no un filtro) — que where/sort/limit no modela.
// Si §5/§5 crecen ops de OR y una anotación por condición, migrar la vista
// a declaraciones y borrar este archivo.
//
// Población LITERAL (paridad con la implementación previa): sólo caen por
// `active`/`registro_sanitario`; los que fallan por categoría o imágenes
// quedan FUERA (el enum de motivos es cerrado: 'inactive' |
// 'missing_health_registry'). Devuelve copias con `reasons`: mutar los
// ítems de entrada corrompería la caché de listado.
// Top-level: sólo el auto-registro (la función corre en runtime).
REGISTRY.handlers.hiddenList = function (items, ctx) {
  var list = Array.isArray(items) ? items : [];
  var out = [];
  list.forEach(function (product) {
    if (!product || typeof product !== 'object') return;
    var reasons = [];
    if (!truthyCell_(product.active)) reasons.push('inactive');
    if (isEmptyValue_(product.registro_sanitario)) reasons.push('missing_health_registry');
    if (reasons.length === 0) return;
    var copy = {};
    Object.keys(product).forEach(function (key) {
      copy[key] = product[key];
    });
    copy.reasons = reasons;
    out.push(copy);
  });
  return out;
};
