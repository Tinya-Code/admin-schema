import type { ResourceSchema } from '../core/models/schema.model';

import { categoriesSchema } from './categories.schema';
import { legalSchema } from './legal.schema';
import { productsSchema } from './products.schema';
import { siteSchema } from './site.schema';

/**
 * Catálogo ordenado de recursos (base.md §3, §13.1): alimenta el menú
 * lateral (Fase 7) y las rutas dinámicas. Agregar un recurso nuevo solo
 * requiere crear su schema y agregarlo aquí.
 */
export const schemas: readonly ResourceSchema[] = [
  categoriesSchema,
  productsSchema,
  siteSchema,
  legalSchema,
];

/** Busca un schema por `id`; `undefined` si no existe. */
export function getSchema(id: string): ResourceSchema | undefined {
  return schemas.find((schema) => schema.id === id);
}
