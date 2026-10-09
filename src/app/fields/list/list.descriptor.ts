import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `list` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'list',
  since: '1.0',
  load: () => import('./list').then((module) => module.FieldList),
  seed: 'array',
  surfaces: ['form'],
  // Compuesto: además de su árbol dibuja el template de cada hijo y hereda
  // el `exists` del nivel para no reactivar el borrado de filas (R3.6).
  inputs: (config, extras) => ({
    field: config,
    tree: extras.ctx.tree,
    childTemplate: extras.childTemplate,
    serverErrors: extras.ctx.serverErrors,
    pathPrefix: extras.ctx.pathPrefix,
    exists: extras.ctx.exists,
  }),
};
