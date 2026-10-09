import type { FieldSchema, GroupField } from '../../core/models/schema.model';
import { get } from '../../core/registry/render-registry';

/**
 * Forma del valor inicial que siembra un campo (D32 · R3.8).
 *
 * Son **todos** los valores posibles del dominio: un campo de formulario
 * nuevo nace como cadena, número, booleano, lista o como contenedor que
 * siembra sus hijos. Si un tipo llegara a necesitar otra forma, ampliar este
 * `type` obliga a compilar el `switch` de `seedValue` — que es exactamente
 * el fail-loud que la regla 4 pide.
 */
export type SeedKind = 'string' | 'number' | 'boolean' | 'array' | 'recursive';

/**
 * Siembra del modelo del formulario: un valor por defecto para CADA campo
 * declarado en el schema (base.md §10).
 *
 * Compartido entre `form-model` (crear/recargar) y los componentes de lista
 * (crear ítems nuevos con la forma de sus `itemFields`).
 */

/**
 * Valor inicial cuando el schema no declara `default`.
 *
 * **D32 · ya no despacha por tipo.** El `switch` de 20 ramas que obligaba a
 * editar este fichero al añadir un campo — y que §0 contaba como tocar el
 * motor — pasa a resolver el nombre que declara el propio descriptor
 * (`RenderDescriptor.seed`). «Añadir un tipo» queda en carpeta + manifiesto
 * + unión: este archivo no se entera.
 *
 * Dos salidas distintas, ninguna silenciosa:
 *
 *  · **tipo fuera del catálogo** ⇒ `undefined`, la misma degradación
 *    controlada que el render (R1.10): el campo no se pinta, así que su
 *    valor no existe;
 *  · **descriptor sin `seed`** ⇒ lanza. Es un error de programación que
 *    `core/registry/contract.spec.ts` detecta en CI antes de llegar acá.
 */
export function seedValue(field: FieldSchema): unknown {
  const descriptor = get('field', field.type);

  if (!descriptor) {
    return undefined;
  }
  if (!descriptor.seed) {
    throw new Error(`[seed] el descriptor de "${field.type}" no declara \`seed\`.`);
  }

  switch (descriptor.seed) {
    case 'string':
      return '';
    case 'number':
      return null;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'recursive':
      return seedHijos(field, descriptor.seed);
  }
}

/**
 * Siembra recursiva de un contenedor.
 *
 * El único `seed` recursivo del catálogo es `group`, pero el registro no lo
 * sabe — sólo lleva un nombre. El estrechado se comprueba aquí y **falla
 * ruidoso** si algún día un tipo declara `'recursive'` sin traer subcampos.
 */
function seedHijos(field: FieldSchema, seed: 'recursive'): unknown {
  if (seed !== 'recursive' || !esGrupo(field)) {
    throw new Error(`[seed] "${field.type}" declara \`seed: 'recursive'\` pero no trae subcampos.`);
  }
  return seedFields(field.fields);
}

/** Estrechado de forma, no de despacho: no decide qué hacer, sólo accede. */
function esGrupo(field: FieldSchema): field is GroupField {
  return field.type === 'group';
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
