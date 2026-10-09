// api/__tests__/capabilities — REGISTRY.capabilities y su única puerta de
// entrada (refactormotor.md §B1).
//
// Dos familias de pruebas:
//   1. La puerta (`registerCapability`): qué registra y qué rechaza — el
//      fail-loud del arranque, no el del runtime.
//   2. El contrato uniforme: TODO lo que quedó registrado cumple
//      { id, since, argsSchema, run } Y está proyectado en su mapa legacy.
//      Es el tripwire que impide dejar capacidades a medias.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

/** @type {any} */
let REGISTRY;

const CATEGORIAS = [
  'fieldTypes',
  'validators',
  'checks',
  'computed',
  'hooks',
  'operators',
  'handlers',
  'adapters',
];
const EJECUTABLES = ['checks', 'computed', 'hooks', 'operators', 'handlers'];

// Mapa legacy donde proyecta cada categoría ({} = todavía sin consumidor).
const LEGACY = {
  fieldTypes: () => FIELD_TYPES,
  checks: () => REGISTRY.checks,
  computed: () => REGISTRY.transforms,
  handlers: () => REGISTRY.handlers,
  hooks: () => REGISTRY.hooks,
  operators: () => REGISTRY.ops,
  validators: () => ({}),
  adapters: () => ({}),
};

const register = (...args) => globalThis.registerCapability(...args);
const argsIssues = (...args) => globalThis.capabilityArgsIssues_(...args);

// Toda capacidad sintética se da de baja: los registros son globales y el
// worker de vitest puede compartir proceso entre archivos.
const sinteticas = [];
afterEach(() => {
  for (const { category, id } of sinteticas.splice(0)) {
    delete REGISTRY.capabilities[category][id];
    delete LEGACY[category]()[id];
  }
});

function sintetica(category, extra = {}) {
  const id = `__sintetica_${sinteticas.length}__`;
  const descriptor = {
    id,
    since: '9.9',
    argsSchema: null,
    run: EJECUTABLES.includes(category) ? () => [] : null,
    ...extra,
  };
  sinteticas.push({ category, id });
  register(category, descriptor);
  return descriptor;
}

beforeAll(() => {
  REGISTRY = loadBackend();
});

describe('la puerta única: registerCapability', () => {
  it('está en el global y es la que declara REGISTRY.capabilities', () => {
    // Si alguien la mueve de archivo, el global desaparece y esto truena.
    expect(typeof globalThis.registerCapability).toBe('function');
    expect(typeof globalThis.capabilityArgsIssues_).toBe('function');
  });

  it('registra en su categoría y proyecta al mapa legacy', () => {
    const d = sintetica('operators');
    expect(REGISTRY.capabilities.operators[d.id]).toBe(d);
    expect(REGISTRY.ops[d.id]).toBe(d.run);
  });

  it('proyecta sólo los metadatos de las categorías de datos', () => {
    const d = sintetica('fieldTypes', { storage: 'column', sheetFormat: 'text' });
    expect(REGISTRY.capabilities.fieldTypes[d.id]).toBe(d);
    expect(FIELD_TYPES[d.id]).toEqual({ storage: 'column', sheetFormat: 'text' });
    expect(FIELD_TYPES[d.id]).not.toHaveProperty('id');
    expect(FIELD_TYPES[d.id]).not.toHaveProperty('since');
  });

  it('rechaza una categoría desconocida', () => {
    expect(() => register('teletransporte', { id: 'x' })).toThrow(/categoría desconocida/);
  });

  it('rechaza un descriptor que no es objeto', () => {
    expect(() => register('checks', 'nope')).toThrow(/debe ser un objeto/);
  });

  it('rechaza id ausente o vacío', () => {
    expect(() => register('checks', { since: '1.0', argsSchema: null, run: () => [] })).toThrow(
      /id debe ser/,
    );
    expect(() =>
      register('checks', { id: '', since: '1.0', argsSchema: null, run: () => [] }),
    ).toThrow(/id debe ser/);
  });

  it('rechaza since ausente', () => {
    expect(() => register('checks', { id: 'x', argsSchema: null, run: () => [] })).toThrow(
      /since debe ser/,
    );
  });

  it('rechaza argsSchema o run ausentes: el sobre es completo', () => {
    expect(() => register('checks', { id: 'x', since: '1.0', run: () => [] })).toThrow(
      /falta argsSchema/,
    );
    expect(() => register('checks', { id: 'x', since: '1.0', argsSchema: null })).toThrow(
      /falta run/,
    );
  });

  it('exige función en categorías ejecutables y null en las de datos', () => {
    expect(() =>
      register('checks', { id: 'x', since: '1.0', argsSchema: null, run: null }),
    ).toThrow(/run debe ser una función/);
    expect(() =>
      register('fieldTypes', { id: 'x', since: '1.0', argsSchema: null, run: () => {} }),
    ).toThrow(/run debe ser null/);
  });

  it('rechaza dos capacidades con el mismo id en la misma categoría', () => {
    const d = sintetica('hooks');
    expect(() =>
      register('hooks', { id: d.id, since: '1.0', argsSchema: null, run: () => {} }),
    ).toThrow(/ya está registrada/);
  });

  it('valida el vocabulario de argsSchema al registrar', () => {
    expect(() =>
      register('checks', {
        id: 'x',
        since: '1.0',
        argsSchema: { a: { type: 'fecha' } },
        run: () => [],
      }),
    ).toThrow(/fuera de ARGS_TYPES_/);
    expect(() =>
      register('checks', { id: 'x', since: '1.0', argsSchema: { a: 'text' }, run: () => [] }),
    ).toThrow(/\{ type, required\? \}/);
    expect(() =>
      register('checks', {
        id: 'x',
        since: '1.0',
        argsSchema: { a: { type: 'text', required: 'si' } },
        run: () => [],
      }),
    ).toThrow(/required que no es boolean/);
  });
});

describe('contrato uniforme de todo lo registrado', () => {
  it('las 8 categorías de §B1 existen', () => {
    expect(Object.keys(REGISTRY.capabilities).sort()).toEqual([...CATEGORIAS].sort());
  });

  it('toda entrada cumple { id, since, argsSchema, run } y está proyectada', () => {
    let vistas = 0;
    for (const categoria of CATEGORIAS) {
      const bucket = REGISTRY.capabilities[categoria];
      const legacy = LEGACY[categoria]();
      const ejecutable = EJECUTABLES.includes(categoria);
      for (const [id, cap] of Object.entries(bucket)) {
        vistas++;
        expect(cap, `${categoria}.${id}`).toMatchObject({ id });
        expect(cap.id).toBe(id);
        expect(typeof cap.since).toBe('string');
        expect(cap.since).not.toBe('');
        expect(cap).toHaveProperty('argsSchema');
        expect(cap).toHaveProperty('run');
        expect(cap.argsSchema === null || typeof cap.argsSchema === 'object').toBe(true);
        if (ejecutable) {
          expect(typeof cap.run, `${categoria}.${id}.run`).toBe('function');
          expect(legacy[id], `${categoria}.${id} proyectada`).toBe(cap.run);
        } else {
          expect(cap.run, `${categoria}.${id}.run`).toBeNull();
        }
      }
    }
    // Tripwire de que el test mira buckets reales, no vacíos.
    expect(vistas).toBeGreaterThan(0);
  });

  it('las categorías de datos proyectan metadatos sin el sobre', () => {
    for (const [id, meta] of Object.entries(FIELD_TYPES)) {
      expect(meta).not.toHaveProperty('since');
      expect(meta).not.toHaveProperty('argsSchema');
      expect(meta.storage).toBeTruthy();
    }
    expect(Object.keys(FIELD_TYPES).length).toBe(20);
  });
});

describe('capabilityArgsIssues_ — args contra argsSchema', () => {
  const esquema = {
    field: { type: 'text', required: true },
    pattern: { type: 'text', required: true },
    negate: { type: 'boolean' },
    weights: { type: 'array' },
    length: { type: 'number' },
  };

  it('sin argsSchema no juzga nada', () => {
    expect(argsIssues('x', null, { cualquier: 'cosa' })).toEqual([]);
  });

  it('acepta una declaración completa', () => {
    expect(
      argsIssues('x', esquema, {
        field: 'ruc',
        pattern: '^\\d+$',
        negate: true,
        weights: [1, 2],
        length: 6,
      }),
    ).toEqual([]);
  });

  it('omite los opcionales ausentes', () => {
    expect(argsIssues('x', esquema, { field: 'ruc', pattern: '^\\d+$' })).toEqual([]);
    // null y '' también cuentan como ausentes.
    expect(argsIssues('x', esquema, { field: 'ruc', pattern: 'p', negate: null })).toEqual([]);
  });

  it('marca el obligatorio ausente', () => {
    expect(argsIssues('x', esquema, { field: 'ruc' })).toEqual([
      "x: falta el argumento obligatorio 'pattern'",
    ]);
    expect(argsIssues('x', esquema, undefined)).toHaveLength(2);
  });

  it('marca el tipo equivocado', () => {
    expect(argsIssues('x', esquema, { field: 1, pattern: 'p' })).toEqual([
      "x: el argumento 'field' debe ser text",
    ]);
    expect(argsIssues('x', esquema, { field: 'f', pattern: 'p', length: '6' })).toEqual([
      "x: el argumento 'length' debe ser number",
    ]);
    expect(argsIssues('x', esquema, { field: 'f', pattern: 'p', weights: '1,2' })).toEqual([
      "x: el argumento 'weights' debe ser array",
    ]);
  });

  it('marca el argumento desconocido', () => {
    expect(argsIssues('x', esquema, { field: 'f', pattern: 'p', otro: 1 })).toEqual([
      "x: argumento desconocido 'otro'",
    ]);
  });

  it('marca args que no es objeto', () => {
    expect(argsIssues('x', esquema, 'de nada')).toEqual(['x: args no es un objeto']);
    expect(argsIssues('x', esquema, [1, 2])).toEqual(['x: args no es un objeto']);
  });

  it('un argsSchema vacío no admite ningún argumento', () => {
    expect(argsIssues('x', {}, {})).toEqual([]);
    expect(argsIssues('x', {}, { extra: 1 })).toEqual(["x: argumento desconocido 'extra'"]);
  });
});
