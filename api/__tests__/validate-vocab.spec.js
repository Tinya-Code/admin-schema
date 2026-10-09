// api/__tests__/validate-vocab — engine/23-validate: el VOCABULARIO de
// validadores y su código estable (Plan 2 · F7 «un registro; mismos nombres
// que el back» + B11 «código además del texto» · R4.6).
//
// Tres cosas se prueban acá:
//   1. El texto NO cambió: los mensajes de VALIDATORS_ son textualmente los
//      de siempre (cambia el sobre, no el texto).
//   2. Cada issue lleva `code` MAYUS_SNAKE con prefijo de dominio
//      (auth.md §6): VALIDATION_* + nombre en mayúsculas, con `-` → `_`.
//   3. El código llega hasta la respuesta: respondError_ serializa
//      error.errors[] tal cual, así que el front puede mapear por código.
//
// Los casos negativos (nombre fuera de la tabla → 500, rango de fecha
// declarado rechazado) cubren las dos caras nuevas: el catálogo y el rango
// de fechas que el form ya rechazaba y el back no.

import { beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let validateScalar_;
let validateChild_;
let validatorIssue_;
let validationCode_;
let respondError_;

beforeAll(() => {
  loadBackend();
  validateScalar_ = globalThis.validateScalar_;
  validateChild_ = globalThis.validateChild_;
  validatorIssue_ = globalThis.validatorIssue_;
  validationCode_ = globalThis.validationCode_;
  respondError_ = globalThis.respondError_;
});

/** name, params, message esperado, code esperado. */
const VOCAB = [
  ['required', undefined, 'Este campo es obligatorio', 'VALIDATION_REQUIRED'],
  ['unique', undefined, 'Ya existe un registro con este valor', 'VALIDATION_UNIQUE'],
  ['immutable', undefined, 'Este valor es inmutable', 'VALIDATION_IMMUTABLE'],
  ['pattern', undefined, 'No coincide con el formato que pide este campo', 'VALIDATION_PATTERN'],
  [
    'min-length',
    { min: 5, actual: 3 },
    'Debe tener al menos 5 caracteres (3)',
    'VALIDATION_MIN_LENGTH',
  ],
  [
    'max-length',
    { max: 10, actual: 12 },
    'Debe tener como máximo 10 caracteres (12)',
    'VALIDATION_MAX_LENGTH',
  ],
  [
    'min-words',
    { min: 2, actual: 1 },
    'Debe tener al menos 2 palabras (1)',
    'VALIDATION_MIN_WORDS',
  ],
  [
    'max-words',
    { max: 4, actual: 6 },
    'Debe tener como máximo 4 palabras (6)',
    'VALIDATION_MAX_WORDS',
  ],
  ['min', { min: 10 }, 'Debe ser ≥ 10', 'VALIDATION_MIN'],
  ['max', { max: 10 }, 'Debe ser ≤ 10', 'VALIDATION_MAX'],
  ['min-items', { min: 1 }, 'Agrega al menos 1 elemento', 'VALIDATION_MIN_ITEMS'],
  ['min-items', { min: 3 }, 'Agrega al menos 3 elementos', 'VALIDATION_MIN_ITEMS'],
  ['max-items', { max: 4 }, 'Máximo 4 elementos', 'VALIDATION_MAX_ITEMS'],
  ['number', undefined, 'Debe ser un número', 'VALIDATION_NUMBER'],
  ['boolean', undefined, 'Debe ser verdadero o falso', 'VALIDATION_BOOLEAN'],
  ['enum', undefined, 'Valor no permitido', 'VALIDATION_ENUM'],
  ['enum', { value: 'x' }, 'Valor no permitido: x', 'VALIDATION_ENUM'],
  ['multiselect', undefined, 'Debe ser una lista de valores', 'VALIDATION_MULTISELECT'],
  ['list', undefined, 'Debe ser una lista', 'VALIDATION_LIST'],
  ['email', undefined, 'Correo inválido', 'VALIDATION_EMAIL'],
  ['url', undefined, 'Debe ser una URL http(s)://', 'VALIDATION_URL'],
  ['image', undefined, 'Debe ser una imagen subida a Cloudinary (https)', 'VALIDATION_IMAGE'],
  ['slug', undefined, 'Slug inválido: minúsculas, números y guiones', 'VALIDATION_SLUG'],
  ['date', undefined, 'Fecha inválida (YYYY-MM-DD)', 'VALIDATION_DATE'],
  [
    'date-min',
    { min: '2026-01-01' },
    'La fecha no puede ser anterior a 2026-01-01.',
    'VALIDATION_DATE_MIN',
  ],
  [
    'date-max',
    { max: '2026-12-31' },
    'La fecha no puede ser posterior a 2026-12-31.',
    'VALIDATION_DATE_MAX',
  ],
  ['time', undefined, 'Hora inválida (HH:mm)', 'VALIDATION_TIME'],
  ['phone', { digits: false }, 'Teléfono inválido: formato +51…', 'VALIDATION_PHONE'],
  ['phone', { digits: true }, 'Sólo dígitos, sin signos', 'VALIDATION_PHONE'],
  ['relation', undefined, 'La referencia no existe', 'VALIDATION_RELATION'],
  ['relation-active', undefined, 'La referencia debe estar activa', 'VALIDATION_RELATION_ACTIVE'],
];

describe('VALIDATORS_ — mensaje + código por nombre', () => {
  it.each(VOCAB)('%s → %s', (name, params, message, code) => {
    const issue = validatorIssue_('campo', name, params);
    expect(issue).toEqual({ path: 'campo', message: message, code: code });
  });

  it('el código es VALIDATION_ + nombre en mayúsculas con guiones bajos', () => {
    expect(validationCode_('min-length')).toBe('VALIDATION_MIN_LENGTH');
    expect(validationCode_('relation-active')).toBe('VALIDATION_RELATION_ACTIVE');
    expect(validationCode_('required')).toBe('VALIDATION_REQUIRED');
  });

  it('un nombre fuera del vocabulario es 500: configuración rota, no error de usuario', () => {
    let lanzado = null;
    try {
      validatorIssue_('campo', 'no-existe');
    } catch (e) {
      lanzado = e;
    }
    expect(lanzado).toBeTruthy();
    expect(lanzado.apiStatus).toBe(500);
    expect(lanzado.message).toContain('Validador no registrado: no-existe');
  });
});

describe('validateScalar_ — cableado: el código sale del motor, no de la tabla suelta', () => {
  /** @type {Array<{path:string,message:string,code:string}>} */
  let errores;
  const corrida = (field, value, path = 'campo') => {
    errores = [];
    validateScalar_(null, field, value, path, errores);
    return errores;
  };

  it('min-length: mensaje y código desde la ruta de texto', () => {
    expect(corrida({ type: 'text', minLength: 5 }, 'abc')).toEqual([
      {
        path: 'campo',
        message: 'Debe tener al menos 5 caracteres (3)',
        code: 'VALIDATION_MIN_LENGTH',
      },
    ]);
  });

  it('max-words: mensaje y código desde el conteo de palabras', () => {
    expect(corrida({ type: 'textarea', maxWords: 2 }, 'uno dos tres')).toEqual([
      {
        path: 'campo',
        message: 'Debe tener como máximo 2 palabras (3)',
        code: 'VALIDATION_MAX_WORDS',
      },
    ]);
  });

  it('min: el número fuera de rango conserva el ≥ y gana código', () => {
    expect(corrida({ type: 'number', min: 10 }, '4')).toEqual([
      { path: 'campo', message: 'Debe ser ≥ 10', code: 'VALIDATION_MIN' },
    ]);
  });

  it('enum: valor suelto y valor de ítem de multiselect', () => {
    expect(corrida({ type: 'select', enum: ['a', 'b'] }, 'z')).toEqual([
      { path: 'campo', message: 'Valor no permitido', code: 'VALIDATION_ENUM' },
    ]);
    expect(corrida({ type: 'multiselect', enum: ['a', 'b'] }, ['a', 'z'])).toEqual([
      { path: 'campo[1]', message: 'Valor no permitido: z', code: 'VALIDATION_ENUM' },
    ]);
  });

  it('phone: los dos formatos comparten código y guardan su texto', () => {
    expect(corrida({ type: 'phone', format: 'e164' }, '12345')).toEqual([
      { path: 'campo', message: 'Teléfono inválido: formato +51…', code: 'VALIDATION_PHONE' },
    ]);
    expect(corrida({ type: 'phone', format: 'digits' }, '+51999')).toEqual([
      { path: 'campo', message: 'Sólo dígitos, sin signos', code: 'VALIDATION_PHONE' },
    ]);
  });
});

describe('validateChild_ — códigos en las listas y en sus ítems', () => {
  it('no-array → list; faltantes → min-items; de más → max-items', () => {
    const errores = [];
    validateChild_(null, { key: 'specs', min: 1 }, 'no soy lista', errores);
    expect(errores).toEqual([
      { path: 'specs', message: 'Debe ser una lista', code: 'VALIDATION_LIST' },
    ]);

    const faltan = [];
    validateChild_(null, { key: 'specs', min: 2 }, [1], faltan);
    expect(faltan).toEqual([
      { path: 'specs', message: 'Agrega al menos 2 elementos', code: 'VALIDATION_MIN_ITEMS' },
    ]);

    const sobran = [];
    validateChild_(null, { key: 'specs', max: 1 }, [1, 2], sobran);
    expect(sobran).toEqual([
      { path: 'specs', message: 'Máximo 1 elementos', code: 'VALIDATION_MAX_ITEMS' },
    ]);
  });

  it('key-value: la clave vacía del ítem es required con su ruta anidada', () => {
    const errores = [];
    validateChild_(null, { key: 'kv', type: 'key-value' }, [{ key: '' }], errores);
    expect(errores).toEqual([
      { path: 'kv[0].key', message: 'Este campo es obligatorio', code: 'VALIDATION_REQUIRED' },
    ]);
  });
});

describe('date — rango declarado (nuevo en R4.6)', () => {
  it('fuera de rango → date-min / date-max con la fecha en el mensaje', () => {
    const a = [];
    validateScalar_(null, { type: 'date', min: '2026-01-01' }, '2025-12-31', 'fecha', a);
    expect(a).toEqual([
      {
        path: 'fecha',
        message: 'La fecha no puede ser anterior a 2026-01-01.',
        code: 'VALIDATION_DATE_MIN',
      },
    ]);

    const b = [];
    validateScalar_(null, { type: 'date', max: '2026-12-31' }, '2027-01-01', 'fecha', b);
    expect(b).toEqual([
      {
        path: 'fecha',
        message: 'La fecha no puede ser posterior a 2026-12-31.',
        code: 'VALIDATION_DATE_MAX',
      },
    ]);
  });

  it('dentro de rango no dice nada y una fecha mal formada sigue siendo date', () => {
    const dentro = [];
    validateScalar_(
      null,
      { type: 'date', min: '2026-01-01', max: '2026-12-31' },
      '2026-06-15',
      'fecha',
      dentro,
    );
    expect(dentro).toEqual([]);

    const malFormada = [];
    validateScalar_(null, { type: 'date', min: '2026-01-01' }, 'ayer', 'fecha', malFormada);
    expect(malFormada).toEqual([
      { path: 'fecha', message: 'Fecha inválida (YYYY-MM-DD)', code: 'VALIDATION_DATE' },
    ]);
  });
});

describe('respondError_ — el código llega hasta el sobre del 422', () => {
  it('error.errors[] viaja con path, message y code', () => {
    const issues = validatorIssue_('nombre', 'min-length', { min: 5, actual: 3 });
    const salida = JSON.parse(respondError_(422, 'Errores de validación', [issues]).getContent());
    expect(salida.error).toEqual({
      status: 422,
      message: 'Errores de validación',
      errors: [
        {
          path: 'nombre',
          message: 'Debe tener al menos 5 caracteres (3)',
          code: 'VALIDATION_MIN_LENGTH',
        },
      ],
    });
  });
});
