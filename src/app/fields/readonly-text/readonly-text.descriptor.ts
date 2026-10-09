import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `readonly-text` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'readonly-text',
  since: '1.0',
  load: () => import('./readonly-text').then((module) => module.FieldReadonlyText),
  // Nace como cadena: los textos, fechas, urls, selects y relacionales.
  seed: 'string',
  surfaces: ['form'],
};
