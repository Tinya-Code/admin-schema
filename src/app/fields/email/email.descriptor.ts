import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `email` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'email',
  since: '1.0',
  load: () => import('./email').then((module) => module.FieldEmail),
  // Nace como cadena: los textos, fechas, urls, selects y relacionales.
  seed: 'string',
  surfaces: ['form', 'display'],
};
