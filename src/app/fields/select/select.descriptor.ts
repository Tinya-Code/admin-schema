import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `select` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'select',
  since: '1.0',
  load: () => import('./select').then((module) => module.FieldSelect),
  // Nace como cadena: los textos, fechas, urls, selects y relacionales.
  seed: 'string',
  surfaces: ['form', 'display'],
};
