import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `date` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'date',
  since: '1.0',
  load: () => import('./date').then((module) => module.FieldDate),
  // Nace como cadena: los textos, fechas, urls, selects y relacionales.
  seed: 'string',
  surfaces: ['form', 'display'],
};
