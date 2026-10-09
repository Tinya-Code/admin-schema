import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del widget `quick-actions` (R3.6). */
export const descriptor: RenderDescriptor = {
  kind: 'widget',
  type: 'quick-actions',
  since: '1.0',
  load: () => import('./quick-actions').then((module) => module.QuickActions),
  surfaces: ['display'],
  // El único widget sin dato: sus botones salen todos del schema. Por eso no
  // recibe `data` — `ngComponentOutletInputs` no admite inputs inexistentes.
  inputs: (config) => ({ widget: config }),
};
