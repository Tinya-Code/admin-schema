import { computed, signal } from '@angular/core';

import type { ResourceSchema } from '../core/models/schema.model';

import { categoriesSchema } from './categories.schema';
import { legalSchema } from './legal.schema';
import { productsSchema } from './products.schema';
import { mergeResourceSchema, remoteToSchema, type RemoteResource } from './schema-merge';
import { siteSchema } from './site.schema';

/**
 * Catálogo ordenado de recursos (base.md §3, §13.1): alimenta el menú
 * lateral y las rutas dinámicas. Agregar un recurso nuevo solo requiere
 * crear su schema — o, desde F7-4, declararlo en el backend: los ids que
 * sólo existen en `/admin/schema` se sintetizan con `remoteToSchema`.
 *
 * `remote` (baseapi §12): proyección opcional de `/admin/schema`. Fusionada
 * por `key` sobre la presentación local — el array `schemas` (locales)
 * NUNCA cambia; sólo `getSchema`/`allSchemas` devuelven el efectivo. Si la
 * carga remota falla, `remote` queda `null` y todo funciona con el schema
 * local (fallback del §12).
 */
export const schemas: readonly ResourceSchema[] = [
  categoriesSchema,
  productsSchema,
  siteSchema,
  legalSchema,
];

/** Schema remoto validado por `parseSchemaResponse`; `null` = sin merge. */
const remoteSchemas = signal<Record<string, RemoteResource> | null>(null);

/**
 * Schemas efectivos, cacheados: se recalculan UNA sola vez cuando llega el
 * schema remoto (identidad estable, los `computed` consumidores no se
 * re-disparan en vano). Incluye los recursos sólo-remotos sintetizados
 * (F7-4): un id nuevo del backend entra al mismo mapa.
 */
const mergedSchemas = computed(() => {
  const remote = remoteSchemas();
  if (remote === null) {
    return null;
  }
  const merged = new Map<string, ResourceSchema>();
  for (const local of schemas) {
    const source = remote[local.id];
    merged.set(local.id, source !== undefined ? mergeResourceSchema(local, source) : local);
  }
  // F7-4: recurso sin schema local ⇒ sintetizado completo desde la
  // proyección remota (0 cambios en `src/` para darlo de alta).
  for (const [id, source] of Object.entries(remote)) {
    if (merged.has(id)) {
      continue;
    }
    const built = remoteToSchema(source);
    if (built !== undefined) {
      merged.set(id, built);
    }
  }
  return merged;
});

/** Aplica la proyección remota de `/admin/schema` (`null` → fallback local). */
export function setRemoteSchema(resources: Record<string, RemoteResource> | null): void {
  remoteSchemas.set(resources);
}

/** Busca un schema por `id` (fusionado si hay remoto); `undefined` si no existe. */
export function getSchema(id: string): ResourceSchema | undefined {
  return mergedSchemas()?.get(id) ?? schemas.find((schema) => schema.id === id);
}

/**
 * Catálogo efectivo en orden (F7-4): locales fusionados + sintetizados
 * desde el remoto. Sin schema remoto ⇒ sólo locales. Es lo que consume el
 * menú lateral: un recurso nuevo del backend aparece sin tocar `src/`.
 */
export function allSchemas(): readonly ResourceSchema[] {
  const merged = mergedSchemas();
  return merged !== null ? Array.from(merged.values()) : schemas;
}
