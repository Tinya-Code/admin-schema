import type { MetricCardWidget } from '../../core/models/schema.model';
import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del widget `metric-card` (R3.6). */
export const descriptor: RenderDescriptor = {
  kind: 'widget',
  type: 'metric-card',
  since: '1.0',
  load: () => import('./metric-card').then((module) => module.MetricCard),
  surfaces: ['display'],
  // El KPI no recibe el widget entero: sólo vive de su rótulo, del dato y de
  // la nota al pie. Pasa el dato tal cual — `MetricCard` ya distingue el
  // `0` de un vacío.
  inputs: (config, extras) => {
    const cfg = config as MetricCardWidget;
    return { label: cfg.label, value: extras.data, hint: cfg.hint ?? '' };
  },
};
