import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `url` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'url',
  since: '1.0',
  load: () => import('./url').then((module) => module.FieldUrl),
  // Nace como cadena: los textos, fechas, urls, selects y relacionales.
  seed: 'string',
  surfaces: ['form'],
};
