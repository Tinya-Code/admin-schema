import type { FieldSchema } from '../../core/models/schema.model';

/**
 * Siembra del modelo del formulario: un valor por defecto para CADA campo
 * declarado en el schema (base.md §10).
 *
 * Compartido entre `form-model` (crear/recargar) y los componentes de lista
 * (crear ítems nuevos con la forma de sus `itemFields`).
 */

/** Valor inicial cuando el schema no declara `default`. */
export function seedValue(field: FieldSchema): unknown {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'slug':
    case 'url':
    case 'email':
    case 'phone':
    case 'date':
    case 'time':
    case 'readonly-text':
    case 'relation':
    case 'image':
    case 'select':
      return '';
    case 'number':
    case 'currency':
      return null;
    case 'boolean':
      return false;
    case 'multiselect':
    case 'string-list':
    case 'list':
    case 'key-value':
      return [];
    case 'group':
      return seedFields(field.fields);
  }
}

/** Valor sembrado de un campo, fusionando `default` con la forma del schema. */
export function seedFieldValue(field: FieldSchema): unknown {
  if (field.default === undefined) {
    return seedValue(field);
  }
  if (field.type === 'group' && isRecord(field.default)) {
    // Un `default` de grupo podría traer claves incompletas: los hijos se
    // acceden por árbol, así que la forma completa es obligatoria.
    return { ...seedFields(field.fields), ...field.default };
  }
  if (field.type === 'list' && Array.isArray(field.default)) {
    return field.default.map((item) =>
      isRecord(item) ? { ...seedFields(field.itemFields), ...item } : item,
    );
  }
  return field.default;
}

/**
 * Siembra recursiva: los `group` anidan sus propios campos. Exportada porque
 * la lista crea sus ítems nuevos con la misma forma (`base.md §6`).
 */
export function seedFields(fields: readonly FieldSchema[]): Record<string, unknown> {
  const model: Record<string, unknown> = {};
  for (const field of fields) {
    model[field.key] = seedFieldValue(field);
  }
  return model;
}

/**
 * Fusiona el registro leído con la forma sembrada del schema.
 *
 * El backend puede omitir claves (p. ej. un ítem guardado antes de que el
 * schema agregara un campo): sin esta fusión el árbol no tendría nodo para
 * ese campo y `childTree` lanzaría al renderizar. Lo ausente toma su
 * `default` y los extras del registro (p. ej. `position` de los ítems) se
 * conservan.
 */
export function mergeRecord(
  fields: readonly FieldSchema[],
  record: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const field of fields) {
    const incoming = record[field.key];
    if (field.type === 'group') {
      merged[field.key] = isRecord(incoming)
        ? mergeRecord(field.fields, incoming)
        : seedFieldValue(field);
      continue;
    }
    if (field.type === 'list') {
      const itemSeed = seedFields(field.itemFields);
      merged[field.key] = Array.isArray(incoming)
        ? incoming.map((item) => (isRecord(item) ? { ...itemSeed, ...item } : item))
        : seedFieldValue(field);
      continue;
    }
    merged[field.key] = incoming !== undefined ? incoming : seedFieldValue(field);
  }
  return merged;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
