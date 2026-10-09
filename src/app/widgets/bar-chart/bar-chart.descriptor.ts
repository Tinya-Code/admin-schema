import type { BarChartWidget } from '../../core/models/schema.model';
import type { RenderDescriptor } from '../../core/registry/render-registry';

import { toSeries } from '../series';

/** Descriptor del widget `bar-chart` (R3.6). */
export const descriptor: RenderDescriptor = {
  kind: 'widget',
  type: 'bar-chart',
  since: '1.0',
  load: () => import('./bar-chart').then((module) => module.BarChart),
  surfaces: ['display'],
  inputs: (config, extras) => {
    const cfg = config as BarChartWidget;
    return { label: cfg.label, data: toSeries(extras.data), unit: cfg.unit ?? '' };
  },
};
