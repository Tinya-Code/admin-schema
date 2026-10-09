import type { RenderDescriptor, RenderExtras } from '../core/registry/render-registry';

/**
 * Manifiesto de descriptores de formato de columna (R4.3 · `kind:
 * 'column-format'`).
 *
 * Es el equivalente a `fields/descriptors.ts` y `widgets/descriptors.ts`:
 * una línea por formato y ningún import de componente — cada `load()` guarda
 * el cierre de un `import()` **con literal**, que es lo que permite al
 * bundler partir el chunk; el registro los recoge al importar este módulo
 * (`core/registry/render-registry.ts`).
 *
 * **Añadir un formato** ⇒ crear `format-<nombre>.ts` + una entrada acá.
 * `list-view` no se toca: ése es el criterio de éxito de R4.3.
 *
 * Todos comparten el cableado: el descriptor sólo expone la celda, que la
 * vista cuelga de `extras.data`.
 */
const inputs = (_config: unknown, extras: RenderExtras): Record<string, unknown> => ({
  cell: extras.data,
});

const text: RenderDescriptor = {
  kind: 'column-format',
  type: 'text',
  since: '1.0',
  surfaces: ['list'],
  load: () => import('./format-text').then((module) => module.ColumnFormatText),
  inputs,
};

const badge: RenderDescriptor = {
  kind: 'column-format',
  type: 'badge',
  since: '1.0',
  surfaces: ['list'],
  load: () => import('./format-badge').then((module) => module.ColumnFormatBadge),
  inputs,
};

const thumbnail: RenderDescriptor = {
  kind: 'column-format',
  type: 'thumbnail',
  since: '1.0',
  surfaces: ['list'],
  load: () => import('./format-thumbnail').then((module) => module.ColumnFormatThumbnail),
  inputs,
};

const boolean: RenderDescriptor = {
  kind: 'column-format',
  type: 'boolean',
  since: '1.0',
  surfaces: ['list'],
  load: () => import('./format-boolean').then((module) => module.ColumnFormatBoolean),
  inputs,
};

const number: RenderDescriptor = {
  kind: 'column-format',
  type: 'number',
  since: '1.0',
  surfaces: ['list'],
  load: () => import('./format-number').then((module) => module.ColumnFormatNumber),
  inputs,
};

const currency: RenderDescriptor = {
  kind: 'column-format',
  type: 'currency',
  since: '1.0',
  surfaces: ['list'],
  load: () => import('./format-currency').then((module) => module.ColumnFormatCurrency),
  inputs,
};

const date: RenderDescriptor = {
  kind: 'column-format',
  type: 'date',
  since: '1.0',
  surfaces: ['list'],
  load: () => import('./format-date').then((module) => module.ColumnFormatDate),
  inputs,
};

/** Los 7 formatos del `@switch` que este registro reemplaza (R4.3). */
export const columnFormatDescriptors: readonly RenderDescriptor[] = [
  text,
  badge,
  thumbnail,
  boolean,
  number,
  currency,
  date,
];

/**
 * Los 7 nombres, como dato.
 *
 * Va en paralelo a `ListColumnFormat` (unión de `schema.model`) y lo vigila
 * `core/registry/contract.spec.ts`: la unión vive en tipos y el registro en
 * runtime, y sólo un test reconcilia los dos — el mismo tripwire que ya
 * existe para los 20 campos y los 6 widgets.
 */
export const COLUMN_FORMAT_TYPES = [
  'text',
  'badge',
  'thumbnail',
  'boolean',
  'number',
  'currency',
  'date',
] as const;
