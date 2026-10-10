import type { MetricCardWidget } from '../../core/models/schema.model';
import type { RenderDescriptor } from '../../core/registry/render-registry';

/**
 * El dato de un KPI es un ESCALAR y puede llegar de dos formas:
 *
 * - **payload**: `data[widget.key]` ya es la cifra (la resuelve el handler
 *   del panel);
 * - **fuente declarada** (F8 · R6.5): una vista con `aggregate` devuelve
 *   `[{ value: … }]` y la cifra es ese `value`.
 *
 * Cualquier otra forma ⇒ `null`, que `MetricCard` pinta como vacío. Se
 * traduce acá, en el borde — el componente no debería saber de dónde salió
 * el número.
 */
function valorDeKpi(data: unknown): number | string | null {
  if (Array.isArray(data)) {
    const first = data[0];
    if (typeof first !== 'object' || first === null) return null;
    const value = (first as { value?: unknown }).value;
    return value === undefined || value === null ? null : (value as number | string);
  }
  if (data === undefined) return null;
  return data as number | string | null;
}

/** Descriptor del widget `metric-card` (R3.6). */
export const descriptor: RenderDescriptor = {
  kind: 'widget',
  type: 'metric-card',
  since: '1.0',
  load: () => import('./metric-card').then((module) => module.MetricCard),
  surfaces: ['display'],
  // El KPI no recibe el widget entero: sólo vive de su rótulo, del dato y de
  // la nota al pie. Pasa el dato ya traducido — `MetricCard` distingue el
  // `0` de un vacío, y el `0` de un agregado llega como `[{ value: 0 }]`.
  inputs: (config, extras) => {
    const cfg = config as MetricCardWidget;
    return { label: cfg.label, value: valorDeKpi(extras.data), hint: cfg.hint ?? '' };
  },
};
