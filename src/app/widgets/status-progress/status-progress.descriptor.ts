import type { RenderDescriptor } from '../../core/registry/render-registry';

import { toCounters } from '../series';

/** Descriptor del widget `status-progress` (R3.6). */
export const descriptor: RenderDescriptor = {
  kind: 'widget',
  type: 'status-progress',
  since: '1.0',
  load: () => import('./status-progress').then((module) => module.StatusProgress),
  surfaces: ['display'],
  // Contadores por clave: un objeto plano del payload O las filas de una
  // fuente con `groupBy` (F8 · R6.5) — `toCounters` traduce en el borde y
  // devuelve `null` si no hay nada que contar.
  inputs: (config, extras) => ({
    widget: config,
    data: toCounters(extras.data),
  }),
};
