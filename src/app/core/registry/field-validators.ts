/**
 * Registro de validadores del formulario (Plan 2 · F7 + B11 · R4.6).
 *
 * F7: «los validadores y reglas del formulario viven en un registro». Un
 * validador es UNA entrada: `declares` dice si el campo lo pide (tipo + props
 * del schema) y `register` ata la regla de Signal Forms a su ruta.
 * `buildFormSchema` sólo recorre el registro — añadir un validador no toca
 * `form-schema.ts`, que queda con lo que NO es validador: el ciclo de vida
 * (visible/readonly/dependencias) y la estructura (hijos de `group`, ítems
 * de `list`).
 *
 * B11: «mismos nombres que el back». `ValidatorName` es el vocabulario
 * compartido con `api/engine/23-validate.js` (tabla `VALIDATORS_`): el
 * contract check (`scripts/contract-check.mjs`) lo compara con esa tabla y
 * un nombre de un lado sin su entrada del otro es ROJO. Así el front y el
 * back hablan del mismo validador aunque cada uno pinte su mensaje.
 *
 * Los MENSAJES son los del front (más amables que los del back): lo que se
 * comparte es el nombre, el código `VALIDATION_*` y el significado.
 *
 * Para añadir un validador: una entrada acá + su nombre en `ValidatorName` +
 * su tabla en el back. Nada más.
 */
import { resource } from '@angular/core';
import {
  email as emailRule,
  max as maxRule,
  maxLength as maxLengthRule,
  min as minRule,
  minLength as minLengthRule,
  pattern as patternRule,
  required as requiredRule,
  validate,
  validateAsync,
  type PathKind,
  type SchemaPath,
  type SchemaPathRules,
} from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';

import { validateMaxWords, validateMinWords } from '../../shared/utils/validators';
import type { FieldSchema, ListOptions, ResourceSchema } from '../models/schema.model';
import type { ApiService } from '../services/api.service';

/** Ruta de un campo en el árbol de Signal Forms. Los casts viven acá. */
export type FieldPath<V> = SchemaPath<V, SchemaPathRules.Supported, PathKind.Child>;

/**
 * Vocabulario compartido con el back (`VALIDATORS_` en 23-validate.js).
 *
 * El orden es el de registro de `FIELD_VALIDATORS`, que fija el orden de los
 * errores en `field.errors()`: el primero es el que pinta el campo.
 */
export type ValidatorName =
  | 'required'
  | 'email'
  | 'url'
  | 'min-length'
  | 'max-length'
  | 'pattern'
  | 'min-words'
  | 'max-words'
  | 'min'
  | 'max'
  | 'min-items'
  | 'max-items'
  | 'date-min'
  | 'date-max'
  | 'unique';

/** Todo lo que un validador necesita para decidir y para registrarse. */
export interface ValidatorContext {
  path: FieldPath<unknown>;
  field: FieldSchema;
  schema: ResourceSchema;
  api: ApiService;
  excludeKey: string | undefined;
}

export interface ValidatorEntry {
  readonly name: ValidatorName;
  /** ¿Este campo declara este validador? (tipo + props del schema) */
  readonly declares: (ctx: ValidatorContext) => boolean;
  /** Ata la regla de Signal Forms a `ctx.path`. */
  readonly register: (ctx: ValidatorContext) => void;
}

// ── Tipos ───────────────────────────────────────────────────────────────────

/** Tipos con valor de texto: son los que pueden llevar reglas de string. */
const TEXT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'textarea',
  'email',
  'url',
  'slug',
  'phone',
  'time',
  'readonly-text',
  'select',
  'relation',
]);

/** Tipos que son un arreglo con conmin: `required` se vuelve `min-items`. */
const LIST_TYPES: ReadonlySet<string> = new Set(['list', 'string-list', 'key-value']);

// ── Resolución de límites (los mismos `??` de siempre, en un solo lugar) ────

function minLengthOf(field: FieldSchema): number | undefined {
  return TEXT_TYPES.has(field.type) ? field.validators?.minLength : undefined;
}

/** `validators` tiene prioridad; `text` además declara `maxLength` propio. */
function maxLengthOf(field: FieldSchema): number | undefined {
  if (!TEXT_TYPES.has(field.type)) return undefined;
  if (field.type === 'text') return field.validators?.maxLength ?? field.maxLength;
  return field.validators?.maxLength;
}

function patternOf(field: FieldSchema): string | undefined {
  if (!TEXT_TYPES.has(field.type)) return undefined;
  if (field.type === 'text') return field.validators?.pattern ?? field.pattern;
  return field.validators?.pattern;
}

/** `textarea` trae `minWords`/`maxWords` propios; el resto, sólo `validators`. */
function minWordsOf(field: FieldSchema): number | undefined {
  if (!TEXT_TYPES.has(field.type)) return undefined;
  if (field.type === 'textarea') return field.validators?.minWords ?? field.minWords;
  return field.validators?.minWords;
}

function maxWordsOf(field: FieldSchema): number | undefined {
  if (!TEXT_TYPES.has(field.type)) return undefined;
  if (field.type === 'textarea') return field.validators?.maxWords ?? field.maxWords;
  return field.validators?.maxWords;
}

/** `number` declara `min`/`max` propio; `currency` sólo en `validators`. */
function numberBoundOf(field: FieldSchema, bound: 'min' | 'max'): number | undefined {
  if (field.type === 'number') {
    return field.validators?.[bound] ?? (bound === 'min' ? field.min : field.max);
  }
  if (field.type === 'currency') return field.validators?.[bound];
  return undefined;
}

/** Ítems mínimos: un `required` de lista exige al menos uno. */
function minItemsOf(field: FieldSchema): number | undefined {
  if (!LIST_TYPES.has(field.type)) return undefined;
  const list = field as FieldSchema & ListOptions;
  return list.required ? Math.max(list.min ?? 1, 1) : list.min;
}

function maxItemsOf(field: FieldSchema): number | undefined {
  if (!LIST_TYPES.has(field.type)) return undefined;
  return (field as FieldSchema & ListOptions).max;
}

// ── Implementaciones compartidas ────────────────────────────────────────────

function toError(kind: string, message: string | null): { kind: string; message: string } | null {
  return message === null ? null : { kind, message };
}

/**
 * Mensaje cuando el `pattern` no coincide (§2: «nada de *Formato inválido*»).
 *
 * El error **reemplaza** a la ayuda bajo el campo (`field-host.ts:284`), así
 * que si el mensaje no repite lo que decía la ayuda el usuario pierde el
 * único texto que explica lo esperado: «11 dígitos.» se convierte en
 * «Formato esperado: 11 dígitos.». La ayuda de las schemas ya está escrita
 * en lenguaje humano, así que se reutiliza en vez de inventar otro.
 */
function patternMessageFor(field: FieldSchema): string {
  const hint = field.help?.trim().replace(/[.。]+$/, '');
  return hint ? `Formato esperado: ${hint}.` : 'Revisa el formato de este campo.';
}

function validateUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    return URL_MESSAGE;
  }
  return /^https?:\/\/\S+$/i.test(value) ? null : URL_MESSAGE;
}

const URL_MESSAGE = 'Debe ser una URL válida (http o https).';

/** Fechas ISO `YYYY-MM-DD`: la comparación lexicográfica es correcta. */
function dateError(
  value: unknown,
  bound: 'min' | 'max',
  iso: string,
): { kind: string; message: string } | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const outside = bound === 'min' ? value < iso : value > iso;
  if (!outside) {
    return null;
  }
  return {
    kind: `${bound}-date`,
    message:
      bound === 'min'
        ? `La fecha no puede ser anterior a ${iso}.`
        : `La fecha no puede ser posterior a ${iso}.`,
  };
}

/** Formato de URL para una ruta cualquiera (`string-list`, ítems de list). */
export function registerUrlRule(path: FieldPath<unknown>): void {
  validate(path as FieldPath<string>, (ctx) => toError('url', validateUrl(ctx.value())));
}

/** Formato de correo para una ruta cualquiera (`string-list`, ítems de list). */
export function registerEmailRule(path: FieldPath<unknown>): void {
  emailRule(path as FieldPath<string>, { message: 'Debe ser un correo electrónico válido.' });
}

/**
 * Regla `unique`: `resource` contra el listado del recurso, descartando el
 * propio registro. Si el listado no se puede leer (error de red) no se
 * bloquea el formulario — `onError` falla abierto.
 */
function registerUniqueRule(ctx: ValidatorContext): void {
  const { path, field, schema, api, excludeKey } = ctx;
  const endpoint = schema.endpoint;
  const keyField = schema.keyField;
  const fieldName = field.key;
  const text = path as FieldPath<string>;

  validateAsync(text, {
    debounce: 300,
    params: (c) => {
      const value = c.value().trim();
      return value === '' ? undefined : { value, exclude: excludeKey };
    },
    factory: (params) =>
      resource({
        // El `Signal` es a la vez la fuente de `params` del recurso y la que
        // `validateAsync` controla: `undefined` deja el recurso en `idle`.
        params,
        loader: async ({ params: request }) => {
          const rows = await firstValueFrom(api.list<Record<string, unknown>>(endpoint));
          if (!Array.isArray(rows)) {
            return [];
          }
          return rows.filter(
            (row) =>
              row[fieldName] === request.value &&
              (request.exclude === undefined || row[keyField] !== request.exclude),
          );
        },
      }),
    onError: () => null,
    onSuccess: (rows, c) => {
      const value = c.value().trim();
      if (value === '' || !Array.isArray(rows) || rows.length === 0) {
        return null;
      }
      return { kind: 'unique', message: 'Este valor ya existe en el registro.' };
    },
  });
}

// ── El registro ─────────────────────────────────────────────────────────────

export const FIELD_VALIDATORS: readonly ValidatorEntry[] = [
  {
    // `boolean`: `isEmpty` de Signal Forms considera `false` vacío, así que un
    // booleano obligatorio bloquearía el guardado al desmarcarlo → se omite.
    // `group`: su valor es un objeto y un objeto nunca está vacío → sin regla.
    // Listas: lo resuelve `min-items` (un `[]` necesita al menos un ítem).
    name: 'required',
    declares: ({ field }) =>
      field.required === true &&
      field.type !== 'boolean' &&
      field.type !== 'group' &&
      !LIST_TYPES.has(field.type),
    register: ({ path }) => requiredRule(path, { message: 'Campo obligatorio.' }),
  },
  {
    name: 'email',
    declares: ({ field }) => field.type === 'email',
    register: ({ path }) => registerEmailRule(path),
  },
  {
    name: 'url',
    declares: ({ field }) => field.type === 'url',
    register: ({ path }) => registerUrlRule(path),
  },
  {
    name: 'min-length',
    declares: ({ field }) => minLengthOf(field) !== undefined,
    register: ({ path, field }) => {
      const min = minLengthOf(field);
      if (min !== undefined) {
        minLengthRule(path as FieldPath<string>, min, {
          message: `Debe tener al menos ${min} caracteres.`,
        });
      }
    },
  },
  {
    name: 'max-length',
    declares: ({ field }) => maxLengthOf(field) !== undefined,
    register: ({ path, field }) => {
      const max = maxLengthOf(field);
      if (max !== undefined) {
        maxLengthRule(path as FieldPath<string>, max, {
          message: `Como máximo ${max} caracteres.`,
        });
      }
    },
  },
  {
    name: 'pattern',
    declares: ({ field }) => patternOf(field) !== undefined,
    register: ({ path, field }) => {
      const pattern = patternOf(field);
      if (pattern !== undefined) {
        patternRule(path as FieldPath<string>, new RegExp(pattern), {
          message: patternMessageFor(field),
        });
      }
    },
  },
  {
    name: 'min-words',
    declares: ({ field }) => minWordsOf(field) !== undefined,
    register: ({ path, field }) => {
      const min = minWordsOf(field);
      if (min !== undefined) {
        validate(path as FieldPath<string>, (ctx) =>
          toError('min-words', validateMinWords(ctx.value(), min)),
        );
      }
    },
  },
  {
    name: 'max-words',
    declares: ({ field }) => maxWordsOf(field) !== undefined,
    register: ({ path, field }) => {
      const max = maxWordsOf(field);
      if (max !== undefined) {
        validate(path as FieldPath<string>, (ctx) =>
          toError('max-words', validateMaxWords(ctx.value(), max)),
        );
      }
    },
  },
  {
    name: 'min',
    declares: ({ field }) => numberBoundOf(field, 'min') !== undefined,
    register: ({ path, field }) => {
      const min = numberBoundOf(field, 'min');
      if (min !== undefined) {
        minRule(path as FieldPath<number | null>, min, {
          message: `Debe ser como mínimo ${min}.`,
        });
      }
    },
  },
  {
    name: 'max',
    declares: ({ field }) => numberBoundOf(field, 'max') !== undefined,
    register: ({ path, field }) => {
      const max = numberBoundOf(field, 'max');
      if (max !== undefined) {
        maxRule(path as FieldPath<number | null>, max, {
          message: `Debe ser como máximo ${max}.`,
        });
      }
    },
  },
  {
    name: 'min-items',
    declares: ({ field }) => minItemsOf(field) !== undefined,
    register: ({ path, field }) => {
      const min = minItemsOf(field);
      if (min !== undefined) {
        minLengthRule(path as FieldPath<unknown[]>, min, {
          message:
            min === 1 ? 'Debe tener al menos 1 elemento.' : `Debe tener al menos ${min} elementos.`,
        });
      }
    },
  },
  {
    name: 'max-items',
    declares: ({ field }) => maxItemsOf(field) !== undefined,
    register: ({ path, field }) => {
      const max = maxItemsOf(field);
      if (max !== undefined) {
        maxLengthRule(path as FieldPath<unknown[]>, max, {
          message: max === 1 ? 'Como máximo 1 elemento.' : `Como máximo ${max} elementos.`,
        });
      }
    },
  },
  {
    name: 'date-min',
    declares: ({ field }) => field.type === 'date' && field.min !== undefined,
    register: ({ path, field }) => {
      const min = field.type === 'date' ? field.min : undefined;
      if (min !== undefined) {
        validate(path as FieldPath<string>, (ctx) => dateError(ctx.value(), 'min', min));
      }
    },
  },
  {
    name: 'date-max',
    declares: ({ field }) => field.type === 'date' && field.max !== undefined,
    register: ({ path, field }) => {
      const max = field.type === 'date' ? field.max : undefined;
      if (max !== undefined) {
        validate(path as FieldPath<string>, (ctx) => dateError(ctx.value(), 'max', max));
      }
    },
  },
  {
    // Un singleton no tiene listado, así que no hay cómo verificarlo y se omite.
    // Cualquier campo de valor texto puede ser único: `text`, `slug`, `select`…
    // (antes sólo los tipos sin `case` propio, y `products.sku` — `text` —
    // se quedaba sin regla aunque el schema la declaraba y el back la exige).
    name: 'unique',
    declares: ({ field, schema }) =>
      field.validators?.unique === true && TEXT_TYPES.has(field.type) && !!schema.endpoint.list,
    register: (ctx) => registerUniqueRule(ctx),
  },
];

/** Nombres del registro: lo que `contract-check.mjs` compara con el back. */
export const VALIDATOR_NAMES: readonly ValidatorName[] = FIELD_VALIDATORS.map(
  (entry) => entry.name,
);
