// primitives/transforms — Derivados parametrizados (mejoras §6).
//
// REGISTRY.transforms: fn(value, params) → string.
// El motor (engine/24-crud, computeRules_) los invoca desde la declaración
//   resource.operations.create.computed = [{ field, transform, from, params? }]
// sólo al CREAR y sólo si el destino viene vacío (ver 24-crud).
// Transform no registrado o declaración mal formada = 500 (§16: el schema manda).
//
// slugify — réplica EXACTA de src/app/shared/utils/slugify.ts (baseapi §12:
// mismo vocabulario en los dos lados). 'Lomo Saltado Ñoño' → 'lomo-saltado-nono'.
// Params con defaults = comportamiento canónico:
//   lower  → minúsculas (default true)
//   sep    → separador (default '-')
//   keep   → regex de caracteres conservados (default 'a-z0-9')
REGISTRY.transforms = {
  slugify: function (value, params) {
    var p = params || {};
    var lower = p.lower !== false;
    var sep = p.sep === undefined ? '-' : String(p.sep);
    var keep = p.keep === undefined || p.keep === null ? 'a-z0-9' : String(p.keep);
    var text = String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (lower) text = text.toLowerCase();
    text = text.trim();
    text = text.replace(new RegExp('[^' + keep + ']+', 'g'), sep);
    if (sep !== '') {
      var esc = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp('^' + esc + '+|' + esc + '+$', 'g'), '');
    }
    return text;
  },
};
