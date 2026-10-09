import type { BarDatum } from './bar-chart/bar-chart';

/**
 * Normaliza el payload de un gráfico a `{ label: string, value: number }`.
 *
 * El dashboard recibe filas de una tabla y no todas llegan limpias, así que
 * el filtro se hace en el **borde** — en el descriptor, antes de que el dato
 * llegue al componente — y no dentro de cada gráfico. `bar-chart` y
 * `chart-line` comparten la misma regla, de ahí la función suelta.
 *
 * Devuelve `[]` ante cualquier cosa que no sea un array: un `metric-card`
 * pasado por error a un gráfico no puede romper la tarjeta.
 */
export function toSeries(data: unknown): BarDatum[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.filter(
    (row): row is BarDatum =>
      typeof row === 'object' &&
      row !== null &&
      typeof (row as BarDatum).label === 'string' &&
      typeof (row as BarDatum).value === 'number',
  );
}
