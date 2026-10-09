import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `relation` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'relation',
  since: '1.0',
  load: () => import('./relation').then((module) => module.FieldRelation),
  // Nace como cadena: los textos, fechas, urls, selects y relacionales.
  seed: 'string',
  surfaces: ['form'],
};
