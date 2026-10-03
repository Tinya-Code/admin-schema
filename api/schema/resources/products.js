// schema/resources/products — Colección con hojas hijas (baseapi §15).
// Columnas: api.md §3.2–§3.5 · Front: src/app/schemas/products.schema.ts
// Hijas: se leen/escriben SIEMPRE con el padre; reemplazo en lote (§2.2 #10).
// Top-level: sólo declaraciones (auto-registro en REGISTRY, mejoras §3).

REGISTRY.resources.products = {
  id: 'products',
  kind: 'collection',
  sheet: 'products',
  keyField: 'slug',
  immutableKey: true,
  titleField: 'name',
  ordering: 'none', // api.md §3.2 no tiene columna position
  activeField: 'active',
  onDelete: 'cascade-children', // borrar producto ⇒ borra hijas
  dependents: [],
  listProjection: [
    'slug',
    'name',
    'category_slug',
    'price',
    'availability',
    'registro_sanitario',
    // featured SE proyecta: la vista R4 lo evalúa sobre el listado.
    'featured',
    'active',
    'images',
  ],
  listPick: { images: 'primary' }, // en el listado, sólo la imagen position=1
  imageFolder: 'products',
  operations: {
    create: { computed: [{ field: 'slug', transform: 'slugify', from: 'name' }] },
    // F5-4: la forma de la respuesta cambia SÓLO aquí (diff de 1 archivo).
    // pick = campos del listado — incluye la base que evalúan las vistas
    // (active, registro_sanitario, category_slug, featured, images) — más
    // `brand`, que el listProjection legacy no exponía. envelope 'list'
    // envuelve la salida en { items, total }. Sin esta declaración ⇒
    // fallback listProjection, salida previa idéntica (F5-2, probado en v12).
    list: {
      shape: {
        pick: [
          'slug',
          'name',
          'brand',
          'category_slug',
          'price',
          'availability',
          'registro_sanitario',
          'featured',
          'active',
          'images',
        ],
        envelope: 'list',
      },
    },
  },
  // Vistas declarativas (mejoras §5): where/sort/limit interpretados por
  // engine/27-views sobre los ítems PROYECTADOS del listado (todo campo que
  // una vista necesita está en listProjection). Se exponen como
  // GET /admin/products?{view} vía payload { filter, view, key }.
  views: {
    // publishable (R1+R2): active + registro_sanitario + categoría activa
    // + ≥1 imagen. NO bloquea guardado: R2 oculta, no valida (spec §7).
    // ref in-active ⇒ fail-closed: categoría desconocida/inactiva ⇒ oculta.
    publishable: {
      where: [
        { field: 'active', op: 'eq', value: true },
        { field: 'registro_sanitario', op: 'empty', not: true },
        { field: 'category_slug', op: 'in-active', ref: 'categories' },
        { field: 'images', op: 'empty', not: true },
      ],
    },
    // R4 — destacados publicables, tope duro de CONFIG.MAX_FEATURED (§7).
    featured: {
      extends: 'publishable',
      where: [{ field: 'featured', op: 'eq', value: true }],
      limit: 6,
    },
    // R5 — misma categoría que el producto ancla (key), sin él,
    // publicables, tope de CONFIG.MAX_RELATED (§7). Sin ancla ⇒ [] (fail-
    // closed: $item sin ctx.self no resuelve).
    related: {
      extends: 'publishable',
      where: [
        { field: 'category_slug', op: 'eq', from: '$item.category_slug' },
        { field: 'slug', op: 'neq', from: '$item.slug' },
      ],
      limit: 4,
    },
    // R6 — productos OCULTOS por R1/R2 con su motivo (vista admin, §7).
    // Escape hatch §6: no expresable con where/sort/limit — la población es
    // OR de dos causas (la declaración sólo evalúa AND) y además anota cada
    // ítem con `reasons` (salida enriquecida). Justificación en
    // primitives/handlers/hidden-list.js.
    'hidden-with-reason': { handler: 'hiddenList' },
  },
  policies: {
    // §8: 11-auth lee `access` (no el prefijo de ruta); TTL de caché y
    // flags de audit/lock salen de acá (fail-closed: sin política ⇒ admin).
    access: { read: 'admin', write: 'admin' },
    cache: { ttl: 300 },
    audit: true,
    lock: true,
  },
  exposeToFront: true,
  fields: [
    // ── Escalares (hoja products) ───────────────────────────────────────
    { key: 'slug', type: 'slug', required: true, unique: true, immutable: true, from: 'name' },
    { key: 'name', type: 'text', required: true },
    {
      key: 'category_slug',
      type: 'relation',
      required: true,
      resource: 'categories',
      valueField: 'slug',
      labelField: 'name',
      onlyActive: true,
    },
    { key: 'sku', type: 'text', required: true, unique: true },
    { key: 'brand', type: 'text', required: false },
    { key: 'price', type: 'currency', required: true },
    { key: 'availability', type: 'select', required: true, enum: 'availability' },
    { key: 'featured', type: 'boolean', required: true, default: false },
    { key: 'active', type: 'boolean', required: true, default: true },
    { key: 'description', type: 'textarea', required: true, minLength: 100, maxLength: 2000 },
    { key: 'seo_title', type: 'text', required: false },
    { key: 'seo_description', type: 'textarea', required: true },
    // vacío ⇒ R2 (publishable) lo oculta; NO bloquea el guardado
    { key: 'registro_sanitario', type: 'text', required: false },
    { key: 'clase_riesgo', type: 'select', required: false, enum: 'risk_class' },
    { key: 'titular_registro', type: 'text', required: false },
    { key: 'updated_at', type: 'readonly-text', system: true, computed: 'now' },

    // ── Hoja hija: imágenes (mín 1; la primera = principal) ─────────────
    {
      key: 'images',
      type: 'list',
      sheet: 'product_images',
      fk: 'product_slug',
      required: true,
      min: 1,
      primaryFirst: true,
      positionField: 'position',
      itemFields: [
        { key: 'image_url', type: 'image', required: true },
        { key: 'image_alt', type: 'text', required: true },
      ],
    },
    // ── Hoja hija: especificaciones (par clave/valor) ───────────────────
    {
      key: 'specs',
      type: 'key-value',
      sheet: 'product_specs',
      fk: 'product_slug',
      positionField: 'position',
      keyColumn: 'spec_key',
      valueColumn: 'spec_value',
    },
    // ── Hoja hija: preguntas frecuentes ─────────────────────────────────
    {
      key: 'faq',
      type: 'list',
      sheet: 'product_faq',
      fk: 'product_slug',
      positionField: 'position',
      itemFields: [
        { key: 'question', type: 'text', required: true },
        { key: 'answer', type: 'textarea', required: true },
      ],
    },
  ],
};
