import { resource } from '@angular/core';
import {
  applyEach,
  disabled,
  email,
  hidden,
  max as maxRule,
  maxLength as maxLengthRule,
  min as minRule,
  minLength as minLengthRule,
  pattern as patternRule,
  readonly as readonlyRule,
  required,
  validate,
  validateAsync,
  type PathKind,
  type SchemaFn,
  type SchemaPath,
  type SchemaPathRules,
  type SchemaPathTree,
} from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';

import type { FieldSchema, ListOptions, ResourceSchema } from '../../core/models/schema.model';
import type { ApiService } from '../../core/services/api.service';
import { isSupportedFieldType } from '../../fields/field-host/field-host';
import { evaluateCondition } from '../../shared/utils/condition-evaluator';
import { validateMaxWords, validateMinWords } from '../../shared/utils/validators';

/** Ruta de un hijo bajo un path (raíz, grupo o ítem). */
type ChildPath<V> = SchemaPath<V, SchemaPathRules.Supported, PathKind.Child>;
/** Ruta raíz del formulario. */
type RootPath = SchemaPathTree<Record<string, unknown>>;
/** Ruta de un campo lista (para `applyEach` y `minLength`). */
type ListPath<V> = SchemaPath<V, SchemaPathRules.Supported, PathKind.Child>;

/**
 * Reglas de validación generadas desde el schema (base.md §4, §6, §9, §10).
 *
 * El schema de Signal Forms recibe el path RAÍZ; las reglas se atan a la ruta
 * dinámica de cada campo. Fase 11: el barrido es **recursivo** — un `group`
 * registra las reglas de sus hijos bajo su propia ruta y un `list` registra
 * las de cada ítem con `applyEach`, de modo que las reglas corren también
 * para los ítems que se agregan después.
 *
 * Solo se generan reglas para los tipos que la UI sabe editar (`isSupportedFieldType`):
 * un campo invisible con `required` bloquearía el guardado para siempre.
 *
 * `api` y `excludeKey` alimentan la validación `unique`: se consulta el
 * listado del recurso y se descarta el propio registro (la clave del registro
 * en edición, tomada de la ruta).
 */
export function buildFormSchema(
  schema: ResourceSchema,
  api: ApiService,
  excludeKey?: string,
): SchemaFn<Record<string, unknown>> {
  return (root) => {
    applyRulesToFields(
      { schema, api, excludeKey, root, container: root, siblings: schema.fields },
      schema.fields,
    );
  };
}

/**
 * Ámbito de registro de reglas.
 *
 * - `root` es siempre la raíz del formulario (referencia para condiciones que
 *   nombran un campo de la raíz, base.md §4: «mismo nivel o registro raíz»).
 * - `container` es el nodo del que cuelgan las rutas hijas: la raíz, un
 *   `group` o un ítem de un `list`.
 * - `siblings` son los campos declarados en `container`: si una condición
 *   nombra a uno de ellos se evalúa contra el contenedor, si no, contra la
 *   raíz.
 */
interface RuleScope {
  schema: ResourceSchema;
  api: ApiService;
  excludeKey: string | undefined;
  root: RootPath;
  container: object;
  siblings: readonly FieldSchema[];
}

function applyRulesToFields(scope: RuleScope, fields: readonly FieldSchema[]): void {
  for (const field of fields) {
    if (!isSupportedFieldType(field.type)) {
      continue;
    }
    applyRulesToField(scope, field, pathAt<unknown>(scope.container, field.key));
  }
}

function applyRulesToField(scope: RuleScope, field: FieldSchema, path: ChildPath<unknown>): void {
  const validators = field.validators;

  applyCommonRules(scope, field, path);

  const text = path as unknown as ChildPath<string>;

  switch (field.type) {
    case 'text': {
      // `validators` tiene prioridad sobre las opciones propias del tipo
      // (`TextField` declara `maxLength`/`pattern`; el mínimo vive en
      // `validators.minLength`).
      applyTextRules(
        text,
        {
          minLength: validators?.minLength,
          maxLength: validators?.maxLength ?? field.maxLength,
          pattern: validators?.pattern ?? field.pattern,
        },
        patternMessageFor(field),
      );
      break;
    }
    case 'textarea': {
      applyTextRules(
        text,
        {
          minLength: validators?.minLength,
          maxLength: validators?.maxLength,
          pattern: validators?.pattern,
        },
        patternMessageFor(field),
      );
      applyWordRules(
        text,
        validators?.minWords ?? field.minWords,
        validators?.maxWords ?? field.maxWords,
      );
      break;
    }
    case 'number': {
      applyNumberRules(
        path as unknown as ChildPath<number | null>,
        validators?.min ?? field.min,
        validators?.max ?? field.max,
      );
      break;
    }
    case 'currency': {
      applyNumberRules(
        path as unknown as ChildPath<number | null>,
        validators?.min,
        validators?.max,
      );
      break;
    }
    case 'email': {
      email(text, { message: 'Debe ser un correo electrónico válido.' });
      applyTextRules(
        text,
        {
          minLength: validators?.minLength,
          maxLength: validators?.maxLength,
          pattern: validators?.pattern,
        },
        patternMessageFor(field),
      );
      break;
    }
    case 'url': {
      validate(text, (ctx) => toError('url', validateUrl(ctx.value())));
      applyTextRules(
        text,
        {
          minLength: validators?.minLength,
          maxLength: validators?.maxLength,
          pattern: validators?.pattern,
        },
        patternMessageFor(field),
      );
      break;
    }
    case 'date': {
      const minIso = field.min;
      const maxIso = field.max;
      if (minIso !== undefined) {
        validate(text, (ctx) => dateError(ctx.value(), 'min', minIso));
      }
      if (maxIso !== undefined) {
        validate(text, (ctx) => dateError(ctx.value(), 'max', maxIso));
      }
      break;
    }
    case 'group': {
      // El grupo no valida su propio valor (un objeto nunca está vacío para
      // `isEmpty`): lo que importa son sus hijos, registrados bajo SU ruta.
      applyRulesToFields({ ...scope, container: path, siblings: field.fields }, field.fields);
      break;
    }
    case 'list': {
      applyListCountRules(path, field);
      applyEach(path as unknown as ListPath<Record<string, unknown>[]>, (item) =>
        applyRulesToFields(
          { ...scope, container: item as object, siblings: field.itemFields },
          field.itemFields,
        ),
      );
      break;
    }
    case 'string-list': {
      applyListCountRules(path, field);
      applyEach(path as unknown as ListPath<string[]>, (item) =>
        applyStringItemRules(item as ChildPath<string>, field.itemType),
      );
      break;
    }
    case 'key-value': {
      applyListCountRules(path, field);
      break;
    }
    default:
      if (STRING_TYPES.has(field.type)) {
        applyTextRules(
          text,
          {
            minLength: validators?.minLength,
            maxLength: validators?.maxLength,
            pattern: validators?.pattern,
          },
          patternMessageFor(field),
        );
      }
  }

  // Conteo de palabras: `FieldBase.validators` vale para cualquier campo de
  // texto (`textarea` además trae sus propios `minWords`/`maxWords`, ya
  // resueltos arriba). Sobre valores no textuales no hace nada.
  if (field.type !== 'textarea') {
    applyWordRules(text, validators?.minWords, validators?.maxWords);
  }

  // Único: validación asíncrona contra el listado del recurso. Un singleton
  // no tiene listado, así que no hay cómo verificarlo y se omite.
  if (validators?.unique && scope.schema.endpoint.list && STRING_TYPES.has(field.type)) {
    applyUniqueRule(text, field, scope.schema, scope.api, scope.excludeKey);
  }
}

/**
 * Reglas comunes a todos los tipos: obligatoriedad y condiciones.
 *
 * - `boolean`: `isEmpty` de Signal Forms considera `false` vacío, así que un
 *   booleano obligatorio bloquearía el guardado al desmarcarlo → se omite.
 * - `group`: su valor es un objeto y un objeto nunca está vacío → sin regla.
 * - Listas: `required` se traduce a `minLength` (un `[]` tampoco es «vacío»
 *   para `isEmpty`, pero para el usuario una lista obligatoria necesita al
 *   menos un ítem). Lo resuelve `applyListCountRules`.
 */
function applyCommonRules(scope: RuleScope, field: FieldSchema, path: ChildPath<unknown>): void {
  const isList =
    field.type === 'list' || field.type === 'string-list' || field.type === 'key-value';
  const isGroup = field.type === 'group';

  if (field.required && !isList && !isGroup && field.type !== 'boolean') {
    required(path, { message: 'Campo obligatorio.' });
  }

  // Condiciones (base.md §4). `hidden` además excluye el campo de `dirty`,
  // `invalid` y del payload (base.md §10 «Campos ocultos»).
  if (field.visibleWhen) {
    const condition = field.visibleWhen;
    hidden(path, {
      when: (ctx) =>
        !evaluateCondition(condition, ctx.valueOf(conditionPath(scope, condition.field))),
    });
  }
  // Selección dependiente (guía §1, plan 6.6): el hijo no se puede tocar
  // hasta que el padre tenga valor. Al estar `disabled` además queda fuera
  // de la validación, así un `required` en el hijo no bloquea el guardado
  // mientras no haya nada que elegir.
  //
  // Acá NO sirve `conditionPath`: eso devuelve el contenedor entero porque
  // `evaluateCondition` recibe el objeto de hermanos. Acá se necesita el
  // valor concreto del padre.
  if (field.dependsOn) {
    const parentKey = field.dependsOn;
    const isSibling = scope.siblings.some((candidate) => candidate.key === parentKey);
    const parent = isSibling ? scope.container : scope.root;
    const parentPath = pathAt<unknown>(parent, parentKey);
    disabled(path, ({ valueOf }) => isEmptyValue(valueOf(parentPath)));
  }
  if (field.readonly) {
    readonlyRule(path, { when: () => true });
  }
  if (field.readonlyWhen) {
    const condition = field.readonlyWhen;
    readonlyRule(path, {
      when: (ctx) =>
        evaluateCondition(condition, ctx.valueOf(conditionPath(scope, condition.field))),
    });
  }
}

/** Vacío para el propósito de «el padre todavía no eligió nada». */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  return Array.isArray(value) && value.length === 0;
}

/**
 * Path contra el que se evalúa una condición: el contenedor si nombra a un
 * campo hermano, la raíz si no (base.md §4: «otro campo del mismo nivel o
 * del registro raíz»).
 */
function conditionPath(scope: RuleScope, key: string): RootPath {
  const isSibling = scope.siblings.some((field) => field.key === key);
  const target = isSibling ? scope.container : scope.root;
  return target as RootPath;
}

/** `min`/`max` de una lista → `minLength`/`maxLength` sobre el arreglo. */
function applyListCountRules(
  path: ChildPath<unknown>,
  field: ListOptions & { required?: boolean },
): void {
  const minItems = field.required ? Math.max(field.min ?? 1, 1) : field.min;
  if (minItems !== undefined) {
    minLengthRule(path as unknown as ListPath<unknown[]>, minItems, {
      message:
        minItems === 1
          ? 'Debe tener al menos 1 elemento.'
          : `Debe tener al menos ${minItems} elementos.`,
    });
  }
  if (field.max !== undefined) {
    maxLengthRule(path as unknown as ListPath<unknown[]>, field.max, {
      message: field.max === 1 ? 'Como máximo 1 elemento.' : `Como máximo ${field.max} elementos.`,
    });
  }
}

/** Ítems de `string-list`: validan según el tipo declarado (§9: text/url/email). */
function applyStringItemRules(
  path: ChildPath<string>,
  itemType: 'text' | 'url' | 'email' | undefined,
): void {
  if (itemType === 'email') {
    email(path, { message: 'Debe ser un correo electrónico válido.' });
  }
  if (itemType === 'url') {
    validate(path, (ctx) => toError('url', validateUrl(ctx.value())));
  }
}

/** Tipos con valor de texto que llegan por acá (los demás tienen case propio). */
const STRING_TYPES: ReadonlySet<string> = new Set([
  'slug',
  'phone',
  'time',
  'readonly-text',
  'select',
  'relation',
]);

interface TextRules {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

/**
 * Navegación dinámica sobre el árbol de paths.
 *
 * Indexar `SchemaPathTree<Record<string, unknown>>` con una clave dinámica
 * devuelve `SchemaPath<unknown, …> | undefined`: el `| undefined` es solo una
 * consecuencia del index signature, y las reglas con valor concreto (`min`,
 * `minLength`, `email`…) exigen afinar el tipo. Los casts viven acá, en un
 * solo lugar (solución reportada en plan.md, Fase 10).
 */
function pathAt<V>(parent: object, key: string): ChildPath<V> {
  const path = (parent as unknown as Record<string, unknown>)[key];
  if (path === undefined) {
    throw new Error(`El formulario no contiene la ruta "${key}".`);
  }
  return path as ChildPath<V>;
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

function applyTextRules(path: ChildPath<string>, rules: TextRules, patternMessage: string): void {
  if (rules.minLength !== undefined) {
    minLengthRule(path, rules.minLength, {
      message: `Debe tener al menos ${rules.minLength} caracteres.`,
    });
  }
  if (rules.maxLength !== undefined) {
    maxLengthRule(path, rules.maxLength, { message: `Como máximo ${rules.maxLength} caracteres.` });
  }
  if (rules.pattern !== undefined) {
    patternRule(path, new RegExp(rules.pattern), { message: patternMessage });
  }
}

function applyNumberRules(path: ChildPath<number | null>, min?: number, max?: number): void {
  if (min !== undefined) {
    minRule(path, min, { message: `Debe ser como mínimo ${min}.` });
  }
  if (max !== undefined) {
    maxRule(path, max, { message: `Debe ser como máximo ${max}.` });
  }
}

function applyWordRules(path: ChildPath<string>, min?: number, max?: number): void {
  if (min !== undefined) {
    validate(path, (ctx) => toError('min-words', validateMinWords(ctx.value(), min)));
  }
  if (max !== undefined) {
    validate(path, (ctx) => toError('max-words', validateMaxWords(ctx.value(), max)));
  }
}

/**
 * Regla `unique`: `resource` contra el listado del recurso, descartando el
 * propio registro. Si el listado no se puede leer (error de red) no se
 * bloquea el formulario — `onError` falla abierto.
 */
function applyUniqueRule(
  path: ChildPath<string>,
  field: FieldSchema,
  schema: ResourceSchema,
  api: ApiService,
  excludeKey: string | undefined,
): void {
  const endpoint = schema.endpoint;
  const keyField = schema.keyField;
  const fieldName = field.key;

  validateAsync(path, {
    debounce: 300,
    params: (ctx) => {
      const value = ctx.value().trim();
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
    onSuccess: (rows, ctx) => {
      const value = ctx.value().trim();
      if (value === '' || !Array.isArray(rows) || rows.length === 0) {
        return null;
      }
      return { kind: 'unique', message: 'Este valor ya existe en el registro.' };
    },
  });
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

function toError(kind: string, message: string | null): { kind: string; message: string } | null {
  return message === null ? null : { kind, message };
}
