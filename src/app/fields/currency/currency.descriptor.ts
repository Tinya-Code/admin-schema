import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `currency` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'currency',
  since: '1.0',
  load: () => import('./currency').then((module) => module.FieldCurrency),
  // Nace como `null`: no puede ser `0`, que sería un valor ya cargado.
  seed: 'number',
  surfaces: ['form'],
};
