import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `file` (R3.3 · R9.5.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'file',
  since: '9.5',
  load: () => import('./file').then((module) => module.FieldFile),
  // Nace como cadena: la URL pública es el valor, igual que en `image`.
  seed: 'string',
  surfaces: ['form', 'display'],
  // Como `image` (D27): control propio cuya sincronización con Signal Forms
  // vive en ɵɵcontrol, así que el host lo declara a mano con `[formField]`.
};
