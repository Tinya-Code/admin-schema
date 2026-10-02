import type { FieldSchema, ResourceSchema } from '../../core/models/schema.model';
import { childTree, itemTree, listTree, type RootTree } from '../../fields/field-node';
import { seedFields } from '../../shared/utils/seed';

/**
 * Modelo y payload del formulario genérico (Fase 10, ampliado en Fase 11).
 *
 * - `seedModel` siembra un valor inicial para CADA campo declarado en el
 *   schema antes de crear el formulario: el árbol de Signal Forms replica la
 *   forma del modelo, así que un campo ausente no tendría estado (ni valor
 *   que enviar). La siembra vive en `shared/utils/seed.ts`.
 * - `buildPayload` decide qué viaja al backend (base.md §10): solo las claves
 *   declaradas en el schema, sin los ocultos y sin `positionField` raíz.
 */

/** Valores por defecto del schema, en el mismo orden/shape que el JSON. */
export function seedModel(schema: ResourceSchema): Record<string, unknown> {
  return seedFields(schema.fields);
}

/**
 * Payload del guardado: whitelist de `schema.fields`.
 *
 * - Los campos ocultos (`visibleWhen` falso) no se muestran ni se envían
 *   (base.md §10): usar `hidden()` garantiza que no aparezcan acá aunque
 *   tengan valor sembrado — también dentro de `group` y de los ítems de una
 *   `list` (recursivo).
 * - `positionField` del recurso se excluye aunque esté declarado: el orden
 *   del listado lo gestiona el backend (api.md R3, nunca se expone). El
 *   `positionField` de los ÍTEMS de una lista sí viaja: el orden local lo
 *   calcula el front (base.md §8).
 * - Los tipos que la UI todavía no edita SÍ viajan: sus valores llegan del
 *   registro leído, así que reenviarlos evita pisarlos.
 */
export function buildPayload(schema: ResourceSchema, root: RootTree): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  collectPayload(root, schema.fields, payload, schema.positionField);
  return payload;
}

function collectPayload(
  tree: RootTree,
  fields: readonly FieldSchema[],
  payload: Record<string, unknown>,
  excludedKey: string | undefined,
): void {
  for (const field of fields) {
    if (excludedKey !== undefined && field.key === excludedKey) {
      continue;
    }
    const state = childTree<unknown>(tree, field.key)();
    if (state.hidden()) {
      continue;
    }
    if (field.type === 'group') {
      const nested: Record<string, unknown> = {};
      collectPayload(
        childTree<Record<string, unknown>>(tree, field.key),
        field.fields,
        nested,
        undefined,
      );
      payload[field.key] = nested;
      continue;
    }
    if (field.type === 'list') {
      const items = listTree(tree, field.key);
      const raw = (state.value() as Record<string, unknown>[] | null) ?? [];
      const list: unknown[] = [];
      for (let index = 0; index < raw.length; index++) {
        const nested: Record<string, unknown> = {};
        collectPayload(itemTree(items, index), field.itemFields, nested, undefined);
        // El orden de los ítems viaja con el registro padre (base.md §8): el
        // `positionField` no es un campo editable, por eso no está en
        // `itemFields` y hay que leerlo del modelo crudo.
        const positionKey = field.positionField;
        const position = positionKey !== undefined ? raw[index]?.[positionKey] : undefined;
        if (positionKey !== undefined && position !== undefined) {
          nested[positionKey] = position;
        }
        list.push(nested);
      }
      payload[field.key] = list;
      continue;
    }
    payload[field.key] = state.value();
  }
}
