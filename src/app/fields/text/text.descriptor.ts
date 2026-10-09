import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `text` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'text',
  since: '1.0',
  load: () => import('./text').then((module) => module.FieldText),
  // Nace como cadena: los textos, fechas, urls, selects y relacionales.
  seed: 'string',
  surfaces: ['form', 'display'],
};
