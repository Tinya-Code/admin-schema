import type { RenderDescriptor } from '../../core/registry/render-registry';

/** Descriptor del widget `record-list` (R3.6). */
export const descriptor: RenderDescriptor = {
  kind: 'widget',
  type: 'record-list',
  since: '1.0',
  load: () => import('./record-list').then((module) => module.RecordList),
  surfaces: ['display'],
  // `RecordList` dibuja filas: fuera de un array no hay nada que listar, y un
  // objeto suelto no debe colarse como si fuera una única fila.
  inputs: (config, extras) => ({
    widget: config,
    data: Array.isArray(extras.data) ? (extras.data as Record<string, unknown>[]) : null,
  }),
};
