import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `multiselect` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'multiselect',
  since: '1.0',
  load: () => import('./multiselect').then((module) => module.FieldMultiselect),
  seed: 'array',
  surfaces: ['form'],
};
