import type {
  FieldSchema,
  FieldType,
  ListColumn,
  ListColumnFormat,
} from '../core/models/schema.model';

/**
 * **Tabla de formato de columna por defecto según `field.type`** (R4.4 del
 * plan): «declarada, no implícita» — `column.format` sólo sirve para
 * sobreescribirla.
 *
 * Es la hermana de `fields/display/display-defaults.ts` (R4.1): un solo
 * sitio decide qué pinta una columna cuando el schema no dice nada, en vez
 * de un `?? 'text'` repartido por la vista. El vocabulario se alinea con el
 * display del detalle — `select` es chip, `date` es fecha, `image` es
 * miniatura — con las dos concesiones que sólo el listado puede hacer:
 * `boolean` baja al interruptor (R4.3) en vez de al chip, y `list`, que en
 * la ficha es timeline, acá sigue siendo texto porque el registro de
 * formatos no tiene timeline (D41).
 *
 * `Record<FieldType, …>` es el **tripwire de exhaustividad en compilación**:
 * un tipo nuevo obliga a elegir su formato de lista antes de que el build
 * pase, y un tipo retirado obliga a limpiar la entrada.
 */
export const FORMATO_POR_DEFECTO: Record<FieldType, ListColumnFormat> = {
  text: 'text',
  textarea: 'text',
  slug: 'text',
  url: 'text',
  email: 'text',
  phone: 'text',
  'readonly-text': 'text',
  relation: 'text',
  group: 'text',
  'key-value': 'text',
  'string-list': 'text',
  multiselect: 'text',
  time: 'text',
  list: 'text',
  date: 'date',
  number: 'number',
  currency: 'currency',
  boolean: 'boolean',
  select: 'badge',
  image: 'thumbnail',
  // Un archivo no tiene miniatura: en la lista va como URL en crudo (R9.5.3).
  file: 'text',
};

/**
 * Formato por defecto para un `type`, o `undefined` si el schema lo escribió
 * mal (tipo fuera de la unión). La degradación — igual que `displayLoader()` —
 * es `text`, que era el `@default` del `@switch` que R4.3 reemplazó.
 */
export function formatoPorTipo(type: string): ListColumnFormat | undefined {
  return Object.prototype.hasOwnProperty.call(FORMATO_POR_DEFECTO, type)
    ? FORMATO_POR_DEFECTO[type as FieldType]
    : undefined;
}

/**
 * Formato final de una columna: la declaración del schema si existe, si no,
 * la tabla de arriba según el `type` del campo con esa `key`, y si la columna
 * ni siquiera aparece en `fields` (columna derivada o key inventada), `text`.
 *
 * Es la única puerta por la que `list-view` decide qué pinta una celda.
 */
export function formatoDeColumna(
  column: ListColumn,
  fields: readonly FieldSchema[],
): ListColumnFormat {
  if (column.format) {
    return column.format;
  }
  const field = fields.find((candidate) => candidate.key === column.key);
  return (field ? formatoPorTipo(field.type) : undefined) ?? 'text';
}
