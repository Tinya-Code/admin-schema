import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del widget `status-progress` (R3.6). */
export const descriptor: RenderDescriptor = {
  kind: 'widget',
  type: 'status-progress',
  since: '1.0',
  load: () => import('./status-progress').then((module) => module.StatusProgress),
  surfaces: ['display'],
  // Contadores por clave: sólo un objeto plano tiene sentido como payload de
  // segmentos — un array se descarta en vez de indexarse por posición.
  inputs: (config, extras) => ({
    widget: config,
    data:
      typeof extras.data === 'object' && extras.data !== null && !Array.isArray(extras.data)
        ? (extras.data as Record<string, unknown>)
        : null,
  }),
};
