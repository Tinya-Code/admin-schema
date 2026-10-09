import type { ChartLineWidget } from '../../core/models/schema.model';
import type { RenderDescriptor } from '../../core/registry/render-registry';

import { toSeries } from '../series';

/** Descriptor del widget `chart-line` (R3.6). */
export const descriptor: RenderDescriptor = {
  kind: 'widget',
  type: 'chart-line',
  since: '1.0',
  load: () => import('./chart-line').then((module) => module.ChartLine),
  surfaces: ['display'],
  inputs: (config, extras) => {
    const cfg = config as ChartLineWidget;
    return { label: cfg.label, data: toSeries(extras.data), unit: cfg.unit ?? '' };
  },
};
