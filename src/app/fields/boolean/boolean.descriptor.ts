import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `boolean` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'boolean',
  since: '1.0',
  load: () => import('./boolean').then((module) => module.FieldBoolean),
  seed: 'boolean',
  surfaces: ['form', 'display'],
};
