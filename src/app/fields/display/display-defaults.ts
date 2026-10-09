import type { Type } from '@angular/core';

import type { FieldType } from '../../core/models/schema.model';

/** Carga perezosa del componente que pinta un valor en modo `display`. */
export type DisplayLoader = () => Promise<Type<any>>;

const TEXTO: DisplayLoader = () =>
  import('./display-text').then((module) => module.FieldDisplayText);
const FECHA: DisplayLoader = () =>
  import('./display-date').then((module) => module.FieldDisplayDate);
const NUMERO: DisplayLoader = () =>
  import('./display-number').then((module) => module.FieldDisplayNumber);
const BADGE: DisplayLoader = () =>
  import('./display-badge').then((module) => module.FieldDisplayBadge);
const IMAGEN: DisplayLoader = () =>
  import('./display-image').then((module) => module.FieldDisplayImage);
const LISTA: DisplayLoader = () =>
  import('./display-list').then((module) => module.FieldDisplayList);

/**
 * **Tabla de display por defecto según `field.type`** (F3 de
 * `doc/refactormotor.md`, R4.1 del plan): «cada descriptor declara si sabe
 * pintarse en `display`; si no, usa un `display` por defecto según tipo».
 *
 * La declaración vive en el descriptor (`surfaces: ['form', 'display']`) y
 * el componente sale de acá: un solo sitio decide qué pinta cada tipo en la
 * ficha de detalle. Es la misma familia de cambio que la tabla de formato
 * de columna de R4.4 — «declarada, no implícita».
 *
 * `Record<FieldType, …>` es el **tripwire de exhaustividad en compilación**:
 * un tipo nuevo obliga a elegir su display antes de que el build pase, y un
 * tipo retirado obliga a limpiar la entrada. En runtime el acceso pasa por
 * `displayLoader()`, que no lanza si el `type` viene de un schema mal
 * escrito.
 *
 * Paridad con el `formatValue` que vivía en `detail-view` (R4.2):
 * `text/textarea/slug/url/email/phone/readonly-text/relation/group/
 * key-value/string-list/multiselect/time` → texto crudo · `date` → fecha ·
 * `number/currency` → número · `boolean/select` → badge · `image` →
 * miniatura · `list` → timeline.
 */
const DISPLAY_POR_DEFECTO: Record<FieldType, DisplayLoader> = {
  text: TEXTO,
  textarea: TEXTO,
  slug: TEXTO,
  url: TEXTO,
  email: TEXTO,
  phone: TEXTO,
  'readonly-text': TEXTO,
  relation: TEXTO,
  group: TEXTO,
  'key-value': TEXTO,
  'string-list': TEXTO,
  multiselect: TEXTO,
  time: TEXTO,
  date: FECHA,
  number: NUMERO,
  currency: NUMERO,
  boolean: BADGE,
  select: BADGE,
  image: IMAGEN,
  list: LISTA,
};

/**
 * Componente de display para un `type`, o `undefined` si no está en la
 * tabla (tipo fuera de la unión — p. ej. un schema con un `type` mal
 * escrito). Ese `undefined` es lo que el host traduce en la degradación
 * controlada de R1.10: en dev se avisa, en producción se omite.
 */
export function displayLoader(type: string): DisplayLoader | undefined {
  return Object.prototype.hasOwnProperty.call(DISPLAY_POR_DEFECTO, type)
    ? DISPLAY_POR_DEFECTO[type as FieldType]
    : undefined;
}
