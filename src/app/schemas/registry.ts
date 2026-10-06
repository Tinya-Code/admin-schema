import type { ResourceSchema } from '../core/models/schema.model';

import { categoriesSchema } from './categories.schema';
import { dashboardSchema } from './dashboard.schema';
import { legalSchema } from './legal.schema';
import { ordersSchema } from './orders.schema';
import { pickpassSchema } from './pickpass.schema';
import { productsSchema } from './products.schema';
import { siteSchema } from './site.schema';

/**
 * Catálogo ordenado de recursos (base.md §3, §13.1): alimenta el menú
 * lateral y las rutas dinámicas. Es la ÚNICA fuente de verdad de las
 * definiciones en el front — agregar un recurso nuevo = crear su
 * `*.schema.ts` y sumarlo a este array (la validación de que coincida con
 * el backend la hace `scripts/contract-check.mjs` en `npm run api:check`).
 *
 * No hay capa remota: `/admin/schema` no se consume en runtime y no existe
 * el recurso sólo-backend (F7-4) que se sintetizara desde esa proyección.
 */
export const schemas: readonly ResourceSchema[] = [
  dashboardSchema,
  categoriesSchema,
  productsSchema,
  ordersSchema,
  pickpassSchema,
  siteSchema,
  legalSchema,
];

/** Busca un schema por `id`; `undefined` si no existe. */
export function getSchema(id: string): ResourceSchema | undefined {
  return schemas.find((schema) => schema.id === id);
}

/** Catálogo completo en orden (lo que consume el menú lateral). */
export function allSchemas(): readonly ResourceSchema[] {
  return schemas;
}
