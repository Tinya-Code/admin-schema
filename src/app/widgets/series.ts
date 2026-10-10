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

/**
 * Normaliza el payload de un contador repartido por segmentos a
 * `{ clave: número }`.
 *
 * Dos formas, igual que `toSeries`:
 * - **payload** del panel: ya es un objeto plano de contadores por clave;
 * - **fuente declarada** (F8 · R6.5): una vista con `groupBy` devuelve filas
 *   `[{ group, value }]` y cada grupo es el nombre de un segmento.
 *
 * `null` ante cualquier otra cosa: `StatusProgress` lo pinta como vacío en
 * vez de sumar un `[object Object]`.
 */
export function toCounters(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const out: Record<string, unknown> = {};
    for (const row of data) {
      if (typeof row !== 'object' || row === null) continue;
      const r = row as { group?: unknown; value?: unknown };
      if (typeof r.group === 'string' && 'value' in r) out[r.group] = r.value;
    }
    return out;
  }
  if (typeof data === 'object' && data !== null) return data as Record<string, unknown>;
  return null;
}
