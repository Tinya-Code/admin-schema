import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del campo `group` (R3.3). */
export const descriptor: RenderDescriptor = {
  kind: 'field',
  type: 'group',
  since: '1.0',
  load: () => import('./group').then((module) => module.FieldGroup),
  // Contenedor: siembra un nodo por cada hijo declarado.
  seed: 'recursive',
  surfaces: ['form', 'display'],
  // Compuesto: además de su árbol dibuja el template de sus hijos, que sólo
  // existe en la plantilla del host. Él es quien decide recibirlo (R3.6).
  inputs: (config, extras) => ({
    field: config,
    tree: extras.ctx.tree,
    serverErrors: extras.ctx.serverErrors,
    pathPrefix: extras.ctx.pathPrefix,
    content: extras.groupContent,
  }),
};
