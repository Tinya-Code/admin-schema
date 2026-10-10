import type { DataSource, ResourceSchema, SelectOption } from '../models/schema.model';

/** Contexto de mapeo: la fuente declarada más las particularidades del campo. */
export interface RowsToOptions {
  /** Fuente de la que salieron las filas (F8 · R6.5). */
  source: DataSource;
  /** Schema del recurso destino: aporta `keyField`/`titleField` por defecto. */
  target: ResourceSchema | undefined;
  /** Descarta filas con `active: false` (`relation.onlyActive`). */
  onlyActive?: boolean;
  /** Dato secundario junto a la etiqueta («Juan Pérez · DNI 123»). */
  secondaryField?: string;
}

/**
 * Filas de una fuente declarada → opciones de desplegable (F8 · R6.5).
 *
 * Es el ÚNICO punto que traduce filas a `SelectOption`: antes esa regla
 * estaba escrita dos veces (en `relation` y cada consumidor montaba su
 * propia petición). Con `source` compartido, relaciones y desplegables con
 * datos remotos pasan por acá.
 *
 * Reglas, en orden:
 * - valor: `source.valueField` → `target.keyField` → `id`;
 * - etiqueta: `source.labelField` → `target.titleField` → el valor;
 * - fila sin valor (vacío o inexistente) no es opción: no hay qué seleccionar;
 * - `onlyActive` descarta las inactivas en el cliente — el back ya las excluye
 *   de su FK, pero una lista cacheada puede traer una fila vieja.
 */
export function optionsFromRows(
  rows: readonly Record<string, unknown>[],
  { source, target, onlyActive, secondaryField }: RowsToOptions,
): SelectOption[] {
  const valueKey = source.valueField ?? target?.keyField ?? 'id';
  const labelKey = source.labelField ?? target?.titleField ?? valueKey;
  const options: SelectOption[] = [];
  for (const row of rows) {
    if (onlyActive === true && row['active'] === false) continue;
    const value = row[valueKey];
    if (value === undefined || value === null || value === '') continue;
    const label = row[labelKey];
    const primary = typeof label === 'string' && label !== '' ? label : String(value);
    options.push({ value: String(value), label: withSecondary(primary, row, secondaryField) });
  }
  return options;
}

/** Etiqueta con su dato secundario, o la etiqueta tal cual si no hay. */
function withSecondary(primary: string, row: Record<string, unknown>, key?: string): string {
  if (key === undefined) return primary;
  const secondary = row[key];
  if (secondary === undefined || secondary === null || secondary === '') return primary;
  return `${primary} · ${String(secondary)}`;
}
