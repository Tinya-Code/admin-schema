import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `slug` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'slug',
  since: '1.0',
  load: () => import('./slug').then((module) => module.FieldSlug),
  // Nace como cadena: los textos, fechas, urls, selects y relacionales.
  seed: 'string',
  surfaces: ['form'],
  // Se aparta de la forma estándar sólo por `exists`: con el registro ya
  // creado el campo queda bloqueado (`lockAfterCreate`, R3.6).
  inputs: (config, extras) => ({
    field: config,
    tree: extras.ctx.tree,
    exists: extras.ctx.exists,
  }),
};
