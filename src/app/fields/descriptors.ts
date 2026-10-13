import type { RenderDescriptor } from '../core/registry/render-registry';
import type { FieldType } from '../core/models/schema.model';

import { descriptor as booleanDescriptor } from './boolean/boolean.descriptor';
import { descriptor as currencyDescriptor } from './currency/currency.descriptor';
import { descriptor as dateDescriptor } from './date/date.descriptor';
import { descriptor as emailDescriptor } from './email/email.descriptor';
import { descriptor as fileDescriptor } from './file/file.descriptor';
import { descriptor as groupDescriptor } from './group/group.descriptor';
import { descriptor as imageDescriptor } from './image/image.descriptor';
import { descriptor as keyValueDescriptor } from './key-value/key-value.descriptor';
import { descriptor as listDescriptor } from './list/list.descriptor';
import { descriptor as multiselectDescriptor } from './multiselect/multiselect.descriptor';
import { descriptor as numberDescriptor } from './number/number.descriptor';
import { descriptor as phoneDescriptor } from './phone/phone.descriptor';
import { descriptor as readonlyTextDescriptor } from './readonly-text/readonly-text.descriptor';
import { descriptor as relationDescriptor } from './relation/relation.descriptor';
import { descriptor as selectDescriptor } from './select/select.descriptor';
import { descriptor as slugDescriptor } from './slug/slug.descriptor';
import { descriptor as stringListDescriptor } from './string-list/string-list.descriptor';
import { descriptor as textDescriptor } from './text/text.descriptor';
import { descriptor as textareaDescriptor } from './textarea/textarea.descriptor';
import { descriptor as timeDescriptor } from './time/time.descriptor';
import { descriptor as urlDescriptor } from './url/url.descriptor';

/**
 * Tripwire de compilación (R1.7 · D17): que la unión `FieldType` y los
 * tipos que la UI sabe dibujar sigan diciendo lo mismo.
 *
 *   · un valor que no esté en la unión `FieldSchema` ⇒ `satisfies` falla;
 *   · un tipo de la unión que falte acá ⇒ `FaltaEnLaUi` no es `never`.
 *
 * **No es una fuente de verdad en runtime.** El catálogo vive en
 * `core/registry/render-registry.ts`, alimentado por los descriptores de
 * abajo. Esta lista sólo existe para que `npm run build` y `npm test` vean
 * la aserción por igual, sin depender de que un test la ejecute.
 *
 * **Exportada en R3.7** para que `core/registry/contract.spec.ts` pueda
 * verificar además el sentido que este archivo no cubre — que cada nombre de
 * la lista tenga **descriptor**: aquí sólo se comprueba que está en la unión,
 * y un tipo declarado en la lista pero ausente del manifiesto se vería en el
 * primer schema que lo use.
 *
 * **Mudado acá en R3.8.** Vivía en `field-host/field-host.ts`, y §0 es
 * explícito: «si añadir un tipo obliga a editar `FieldHost`, el motor no
 * está terminado». Estaba sin uso en runtime — sólo servía a este tripwire —
 * así que trasladarlo acá no cambia comportamiento y deja el registro y su
 * aserción en el **mismo archivo**: añadir un tipo toca una carpeta y una
 * línea de este manifiesto, y el host no se entera.
 */
export const SUPPORTED_FIELD_TYPE_LIST = [
  'text',
  'textarea',
  'slug',
  'number',
  'currency',
  'boolean',
  'select',
  'multiselect',
  'url',
  'email',
  'phone',
  'date',
  'time',
  'readonly-text',
  'group',
  'list',
  'string-list',
  'key-value',
  'relation',
  'image',
  'file',
] as const satisfies readonly FieldType[];

type FaltaEnLaUi = Exclude<FieldType, (typeof SUPPORTED_FIELD_TYPE_LIST)[number]>;
const _exhaustivo: FaltaEnLaUi extends never
  ? true
  : ['Falta en SUPPORTED_FIELD_TYPE_LIST', FaltaEnLaUi] = true;

/**
 * Manifiesto de descriptores de campo (R3.3 · registro único de render).
 *
 * Una línea por tipo: el registro los recoge al importar este módulo. Es la
 * **única** lista manual del catálogo de campos — `import.meta.glob` no
 * sobrevive a `ng build`, así que D9-1 se resuelve con «registro manual de
 * una línea». Ver `core/registry/render-registry.ts`.
 *
 * Añadir un tipo de campo ⇒ crear la carpeta + su `.descriptor.ts` + una
 * línea acá. **Ningún host se toca** (R3.8).
 */
export const fieldDescriptors: readonly RenderDescriptor[] = [
  booleanDescriptor,
  currencyDescriptor,
  dateDescriptor,
  emailDescriptor,
  fileDescriptor,
  groupDescriptor,
  imageDescriptor,
  keyValueDescriptor,
  listDescriptor,
  multiselectDescriptor,
  numberDescriptor,
  phoneDescriptor,
  readonlyTextDescriptor,
  relationDescriptor,
  selectDescriptor,
  slugDescriptor,
  stringListDescriptor,
  textDescriptor,
  textareaDescriptor,
  timeDescriptor,
  urlDescriptor,
];
