// schema/resources/categories — Colección reordenable (baseapi §15).
// Columnas: api.md §3.1 · Front: src/app/schemas/categories.schema.ts
// Top-level: sólo declaraciones (auto-registro en REGISTRY, mejoras §3).

REGISTRY.resources.categories = {
  id: 'categories',
  kind: 'collection',
  sheet: 'categories',
  keyField: 'slug',
  immutableKey: true,
  titleField: 'name',
  ordering: 'positioned', // position 1..N, paso 1000, dueño = backend (§9)
  orderStep: 1000,
  activeField: 'active', // FALSE ⇒ fuera del público (R1)
  onDelete: 'restrict', // con productos → 409 con motivo (§6)
  dependents: ['products'],
  listProjection: ['slug', 'image_url', 'name', 'active', 'position'],
  imageFolder: 'categories', // carpeta Cloudinary del recurso (§11)
  operations: {
    create: { computed: [{ field: 'slug', transform: 'slugify', from: 'name' }] },
  },
  views: {},
  policies: {
    // §8: 11-auth lee `access` (no el prefijo de ruta); el límite por
    // operación, el TTL de caché y los flags de audit/lock salen de acá.
    // Fail-closed: sin política ⇒ admin; sin `lock` explícito ⇒ con lock.
    access: { read: 'admin', write: 'admin' },
    cache: { ttl: 300 },
    audit: true,
    lock: true,
  },
  exposeToFront: true, // publica la proyección §12 en /admin/schema
  fields: [
    { key: 'slug', type: 'slug', required: true, unique: true, immutable: true, from: 'name' },
    { key: 'name', type: 'text', required: true },
    { key: 'seo_title', type: 'text', required: true },
    { key: 'seo_description', type: 'textarea', required: true },
    { key: 'intro', type: 'textarea', required: true, minWords: 100, maxWords: 200 },
    { key: 'image_url', type: 'image', required: true },
    { key: 'image_alt', type: 'text', required: false },
    { key: 'active', type: 'boolean', required: true, default: true },
    { key: 'position', type: 'number', required: true, system: true }, // la asigna 25-ordering
  ],
};
