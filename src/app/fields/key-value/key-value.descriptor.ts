import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `key-value` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'key-value',
  since: '1.0',
  load: () => import('./key-value').then((module) => module.FieldKeyValue),
  seed: 'array',
  surfaces: ['form'],
};
