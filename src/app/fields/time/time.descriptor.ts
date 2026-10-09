import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `time` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'time',
  since: '1.0',
  load: () => import('./time').then((module) => module.FieldTime),
  // Nace como cadena: los textos, fechas, urls, selects y relacionales.
  seed: 'string',
  surfaces: ['form'],
};
