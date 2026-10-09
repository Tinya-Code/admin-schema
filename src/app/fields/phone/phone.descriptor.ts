import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `phone` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'phone',
  since: '1.0',
  load: () => import('./phone').then((module) => module.FieldPhone),
  // Nace como cadena: los textos, fechas, urls, selects y relacionales.
  seed: 'string',
  surfaces: ['form'],
};
