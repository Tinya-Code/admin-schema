import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `string-list` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'string-list',
  since: '1.0',
  load: () => import('./string-list').then((module) => module.FieldStringList),
  seed: 'array',
  surfaces: ['form', 'display'],
};
