import type { FieldSchema } from '../../core/models/schema.model';
import { seedFieldValue } from './seed';

/**
 * Enlaces de selección dependiente (guía §1, plan 6.6).
 *
 * `condition-evaluator.ts` sólo RESUELVE condiciones (`visibleWhen` /
 * `readonlyWhen`): no resetea nada. Acá se levanta el mapa de «cuando el
 * padre cambie, limpiar el hijo» que `form-view` observa con un `effect`.
 *
 * Alcance: raíz y `group` (contenedores estáticos). Los ítems de un `list`
 * se crean y borran mientras se edita y sus rutas no son estables — un
 * dependiente dentro de una lista queda sin resetear, así que no se promete.
 */
export interface DependsOnLink {
  /** Ruta de contenedores desde la raíz: `[]` en la raíz, `['contacto']` en un grupo. */
  container: string[];
  childKey: string;
  parentKey: string;
  /** Valor con el que se limpia el hijo (el default del schema). */
  resetValue: unknown;
  /** Clave estable del enlace para el snapshot de comparación. */
  id: string;
}

export function collectDependsOn(
  fields: readonly FieldSchema[],
  container: string[] = [],
): DependsOnLink[] {
  const links: DependsOnLink[] = [];
  for (const field of fields) {
    if (field.type === 'group') {
      links.push(...collectDependsOn(field.fields, [...container, field.key]));
      continue;
    }
    if (field.dependsOn === undefined) {
      continue;
    }
    links.push({
      container,
      childKey: field.key,
      parentKey: field.dependsOn,
      resetValue: seedFieldValue(field),
      id: `${container.join('.')}.${field.key}<-${field.dependsOn}`,
    });
  }
  return links;
}
