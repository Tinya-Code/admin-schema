import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `number` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'number',
  since: '1.0',
  load: () => import('./number').then((module) => module.FieldNumber),
  // Nace como `null`: no puede ser `0`, que sería un valor ya cargado.
  seed: 'number',
  surfaces: ['form', 'display'],
};
