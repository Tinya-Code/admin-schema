/**
 * Registro de validadores — vocabulario y declaración (Plan 2 · F7 + B11).
 *
 * Dos capas se prueban acá, sin construir formularios:
 *
 * 1. **Vocabulario**: los nombres del registro son los del back
 *    (`api/engine/23-validate.js`, tabla `VALIDATORS_`); el contract check
 *    (`scripts/contract-check.mjs`) es quien los compara con la tabla real,
 *    y esta lista congelada evita que un nombre se caiga en silencio.
 * 2. **`declares`**: qué validador pide cada campo. Es la parte que antes
 *    vivía en un `switch (field.type)` de `form-schema.ts` — un error acá es
 *    un campo sin validar (o un `required` bloqueando un booleano).
 */
import { of } from 'rxjs';

import type { FieldSchema, ResourceSchema } from '../models/schema.model';
import type { ApiService } from '../services/api.service';
import {
  FIELD_VALIDATORS,
  VALIDATOR_NAMES,
  type FieldPath,
  type ValidatorContext,
} from './field-validators';

/** El vocabulario compartido, escrito a mano: caer de él tiene que doler. */
const VOCAB_ESPERADO = [
  'date-max',
  'date-min',
  'email',
  'max',
  'max-items',
  'max-length',
  'max-words',
  'min',
  'min-items',
  'min-length',
  'min-words',
  'pattern',
  'required',
  'unique',
  'url',
];

function contexto(field: FieldSchema, list = '/api/items'): ValidatorContext {
  const schema = {
    id: 'items',
    kind: 'collection',
    endpoint: list === '' ? {} : { list },
    keyField: 'key',
    titleField: 'name',
    listColumns: [],
    fields: [field],
  } as unknown as ResourceSchema;
  return {
    path: {} as FieldPath<unknown>,
    field,
    schema,
    api: { list: () => of([]) } as unknown as ApiService,
    excludeKey: undefined,
  };
}

/** Nombres que el registro declara para un campo. */
function declarados(field: FieldSchema, list?: string): string[] {
  const ctx = contexto(field, list);
  return FIELD_VALIDATORS.filter((entry) => entry.declares(ctx)).map((entry) => entry.name);
}

describe('FIELD_VALIDATORS — vocabulario compartido con el back (B11)', () => {
  it('declara exactamente los nombres de la lista congelada', () => {
    expect([...VALIDATOR_NAMES].sort()).toEqual(VOCAB_ESPERADO);
  });

  it('sin nombres repetidos: un validador es una entrada', () => {
    expect(new Set(VALIDATOR_NAMES).size).toBe(VALIDATOR_NAMES.length);
  });

  it('cada entrada del registro tiene nombre, declara y registra', () => {
    for (const entry of FIELD_VALIDATORS) {
      expect(typeof entry.declares).toBe('function');
      expect(typeof entry.register).toBe('function');
      expect(VOCAB_ESPERADO).toContain(entry.name);
    }
  });
});

describe('declares — qué validador pide cada campo', () => {
  it('un campo simple sin reglas no declara nada', () => {
    expect(declarados({ type: 'text', key: 'n', label: 'N' })).toEqual([]);
    expect(declarados({ type: 'select', key: 's', label: 'S', options: [] })).toEqual([]);
  });

  it('required: sí en escalares, nunca en booleano, group ni listas', () => {
    expect(declarados({ type: 'text', key: 'n', label: 'N', required: true })).toEqual([
      'required',
    ]);
    expect(declarados({ type: 'boolean', key: 'b', label: 'B', required: true })).toEqual([]);
    expect(declarados({ type: 'group', key: 'g', label: 'G', required: true, fields: [] })).toEqual(
      [],
    );
    // En listas `required` se vuelve min-items (un `[]` necesita un ítem).
    expect(
      declarados({ type: 'list', key: 'l', label: 'L', required: true, itemFields: [] }),
    ).toEqual(['min-items']);
  });

  it('longitud y patrón: de `validators`, con `text` tomando los suyos', () => {
    expect(
      declarados({
        type: 'text',
        key: 'n',
        label: 'N',
        maxLength: 10,
        pattern: '^\\d+$',
        validators: { minLength: 2 },
      }),
    ).toEqual(['min-length', 'max-length', 'pattern']);

    // `validators` tiene prioridad sobre la opción propia del tipo.
    expect(
      declarados({
        type: 'text',
        key: 'n',
        label: 'N',
        maxLength: 10,
        validators: { maxLength: 4 },
      }),
    ).toEqual(['max-length']);

    // `textarea` trae sus propios minWords/maxWords.
    expect(
      declarados({ type: 'textarea', key: 't', label: 'T', minWords: 3, maxWords: 12 }),
    ).toEqual(['min-words', 'max-words']);
  });

  it('palabras: sólo en tipos de texto (un número no cuenta palabras)', () => {
    expect(
      declarados({ type: 'number', key: 'n', label: 'N', validators: { minWords: 3 } }),
    ).toEqual([]);
    expect(declarados({ type: 'text', key: 'n', label: 'N', validators: { minWords: 3 } })).toEqual(
      ['min-words'],
    );
  });

  it('rangos numéricos: `number` declara min/max propios, `currency` no', () => {
    expect(declarados({ type: 'number', key: 'n', label: 'N', min: -90, max: 90 })).toEqual([
      'min',
      'max',
    ]);
    expect(declarados({ type: 'currency', key: 'c', label: 'C' })).toEqual([]);
    expect(declarados({ type: 'currency', key: 'c', label: 'C', validators: { min: 0 } })).toEqual([
      'min',
    ]);
  });

  it('conteo de ítems en los tres tipos de lista', () => {
    expect(declarados({ type: 'string-list', key: 'x', label: 'X', min: 1, max: 4 })).toEqual([
      'min-items',
      'max-items',
    ]);
    expect(declarados({ type: 'key-value', key: 'k', label: 'K', max: 2 })).toEqual(['max-items']);
  });

  it('email/url y el rango de fechas salen de las props del tipo', () => {
    expect(declarados({ type: 'email', key: 'e', label: 'E', required: true })).toEqual([
      'required',
      'email',
    ]);
    expect(
      declarados({ type: 'url', key: 'u', label: 'U', validators: { maxLength: 60 } }),
    ).toEqual(['url', 'max-length']);
    expect(declarados({ type: 'date', key: 'd', label: 'D', min: '2026-01-01' })).toEqual([
      'date-min',
    ]);
    expect(
      declarados({ type: 'date', key: 'd', label: 'D', min: '2026-01-01', max: '2026-12-31' }),
    ).toEqual(['date-min', 'date-max']);
  });

  it('unique: sólo con `validators.unique`, valor de texto y listado', () => {
    expect(
      declarados({ type: 'text', key: 'sku', label: 'SKU', validators: { unique: true } }),
    ).toEqual(['unique']);
    expect(
      declarados({
        type: 'slug',
        key: 'slug',
        label: 'Slug',
        from: 'name',
        validators: { unique: true },
      }),
    ).toEqual(['unique']);
    // Sin listado (singleton) no hay con qué verificarlo.
    expect(
      declarados({ type: 'text', key: 'sku', label: 'SKU', validators: { unique: true } }, ''),
    ).toEqual([]);
    expect(declarados({ type: 'text', key: 'sku', label: 'SKU' })).toEqual([]);
  });
});
