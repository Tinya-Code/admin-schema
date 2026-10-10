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
  return data
    .map((row): BarDatum | null => {
      if (typeof row !== 'object' || row === null) return null;
      const r = row as { label?: unknown; group?: unknown; value?: unknown };
      // El agregado agrupado del backend (R6.2) llega como { group, value };
      // la forma histórica de tabla es { label, value }. El gráfico sólo
      // entiende label ⇒ traducimos acá, en el borde.
      const label = typeof r.label === 'string' ? r.label : r.group;
      if (typeof label !== 'string' || typeof r.value !== 'number') return null;
      return { label, value: r.value };
    })
    .filter((row): row is BarDatum => row !== null);
}
