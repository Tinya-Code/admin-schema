import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `image` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'image',
  since: '1.0',
  load: () => import('./image').then((module) => module.FieldImage),
  // Nace como cadena: los textos, fechas, urls, selects y relacionales.
  seed: 'string',
  surfaces: ['form'],
};
