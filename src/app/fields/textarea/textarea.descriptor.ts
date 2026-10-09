import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `textarea` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'textarea',
  since: '1.0',
  load: () => import('./textarea').then((module) => module.FieldTextarea),
  // Nace como cadena: los textos, fechas, urls, selects y relacionales.
  seed: 'string',
  surfaces: ['form'],
};
