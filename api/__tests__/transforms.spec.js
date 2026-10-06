// api/__tests__/transforms — REGISTRY.transforms (primitivas parametrizadas).
//
// Es la suite que prueba que el harness de carga funciona: slugify es
// puro, no toca Google ni la hoja, y su contrato está documentado en
// api/primitives/transforms.js.

import { beforeAll, describe, expect, it } from 'vitest';

import { slugify as slugifyFront } from '../../src/app/shared/utils/slugify';
import { loadBackend } from './_harness.js';

/** @type {{ transforms: Record<string, (v: string, p?: object) => string> }} */
let REGISTRY;

beforeAll(() => {
  REGISTRY = loadBackend();
});

describe('REGISTRY.transforms.slugify', () => {
  const slugify = (...args) => REGISTRY.transforms.slugify(...args);

  it('replica el ejemplo documentado', () => {
    expect(slugify('Lomo Saltado Ñoño')).toBe('lomo-saltado-nono');
  });

  it('manda a minúsculas por defecto', () => {
    expect(slugify('PAN DE MUJER')).toBe('pan-de-mujer');
  });

  it('conserva mayúsculas sólo si `keep` también las admite', () => {
    // Con el keep por defecto (a-z0-9) una mayúscula es SEPARADOR: es el
    // comportamiento real del código, y explica por qué hay que declarar
    // keep junto a lower: false si se quiere respetar la caja.
    expect(slugify('Pan de Mujer', { lower: false })).toBe('an-de-ujer');
    expect(slugify('Pan de Mujer', { lower: false, keep: 'a-zA-Z0-9' })).toBe('Pan-de-Mujer');
  });

  it('respeta el separador declarado', () => {
    expect(slugify('Torta de Chocolate', { sep: '_' })).toBe('torta_de_chocolate');
  });

  it('con sep vacío no introduce separadores', () => {
    expect(slugify('Torta de Chocolate', { sep: '' })).toBe('tortadechocolate');
  });

  it('restringe los caracteres conservados a lo declarado en keep', () => {
    // keep: 'a-z' deja los dígitos fuera ⇒ pasan a ser separador.
    expect(slugify('Mousse de limón 2', { keep: 'a-z' })).toBe('mousse-de-limon');
  });

  it('quita los separadores sobrantes al inicio y al final', () => {
    expect(slugify('  --- Tres  Leches ---  ')).toBe('tres-leches');
  });

  it('devuelve el separador por defecto cuando no hay parámetros', () => {
    expect(slugify('Tres Leches', undefined)).toBe('tres-leches');
  });

  it('saca las tildes con NFD antes de comparar', () => {
    expect(slugify('Úrsula con acento')).toBe('ursula-con-acento');
  });

  it('con parámetros por defecto es idéntica a la réplica del front', () => {
    // El contrato dice «réplica EXACTA de src/app/shared/utils/slugify.ts».
    // Este test es el que impide que las dos implementaciones se separen.
    const frases = [
      'Lomo Saltado Ñoño',
      'Tres  Leches',
      '  Pan de Mujer  ',
      'Úrsula',
      'Mousse de limón',
      'Ñandú 3 veces',
    ];
    for (const frase of frases) {
      expect(slugify(frase)).toBe(slugifyFront(frase));
    }
  });
});

// Alfabeto de 32 símbolos SIN ambiguos: se lee en voz alta en un local de
// comida (0/O y 1/I se confunden) y, al ser 32 = 2^5, mapear un byte a un
// símbolo es uniforme sin necesidad de rechazo.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SOLO_ALFABETO = new RegExp('^[' + ALFABETO + ']+$');

describe('REGISTRY.transforms.token', () => {
  const token = (...args) => REGISTRY.transforms.token(...args);

  it('está registrado y es función (el registro es idempotente)', () => {
    expect(typeof REGISTRY.transforms.token).toBe('function');
  });

  it('devuelve un string no vacío de 6 símbolos por defecto', () => {
    const t = token('María');
    expect(typeof t).toBe('string');
    expect(t).not.toBe('');
    expect(t).toHaveLength(6);
    expect(t).toMatch(SOLO_ALFABETO);
  });

  it('usa sólo símbolos del alfabeto, sin los ambiguos 0, 1, I, O', () => {
    const t = token('');
    expect(t).toMatch(SOLO_ALFABETO);
    for (const ambiguo of ['0', '1', 'I', 'O']) {
      expect(t, `no debe contener "${ambiguo}"`).not.toContain(ambiguo);
    }
  });

  it('es seguro para URL: no necesita codificarse', () => {
    const t = token('valor');
    expect(encodeURIComponent(t)).toBe(t);
  });

  it('respeta el prefijo declarado y lo suma a la longitud', () => {
    const t = token('x', { prefix: 'PP-' });
    expect(t.startsWith('PP-')).toBe(true);
    expect(t).toHaveLength(3 + 6);
    expect(t.slice(3)).toMatch(SOLO_ALFABETO);
  });

  it('respeta la longitud declarada', () => {
    expect(token('x', { length: 10 })).toHaveLength(10);
    expect(token('x', { length: 1 })).toHaveLength(1);
    expect(token('x', { length: 4, prefix: 'A' })).toHaveLength(5);
  });

  it('funciona sin parámetros ni valor de origen', () => {
    expect(token(undefined, undefined)).toHaveLength(6);
    expect(token('   ', null)).toHaveLength(6);
  });

  it('cae al default cuando `length` no es un entero positivo', () => {
    // Un parámetro mal declarado no debe romper la creación: cae al default
    // y `23-validate` sigue mandando sobre `maxLength` si el campo lo declara.
    expect(token('x', { length: 'nada' })).toHaveLength(6);
    expect(token('x', { length: 0 })).toHaveLength(6);
    expect(token('x', { length: -3 })).toHaveLength(6);
    expect(token('x', { length: 3.7 })).toHaveLength(3);
  });

  it('recorta `length` por encima del techo', () => {
    expect(token('x', { length: 500 })).toHaveLength(64);
  });

  it('convierte `prefix` no string', () => {
    expect(token('x', { prefix: 42 }).startsWith('42')).toBe(true);
    expect(token('x', { prefix: null })).toHaveLength(6);
  });

  it('ignora su entrada: la longitud no depende del valor de origen', () => {
    // 24-crud:612-614 exige `from` y sólo lo usa como trigger. El token no
    // deriva del nombre del cliente — si derivara, cambiar el nombre cambiaría
    // el código y no podría haber dos pedidos del mismo cliente.
    for (const origen of ['a', 'María Fernanda de la Cruz', '', 'Ñ'.repeat(50)]) {
      expect(token(origen)).toHaveLength(6);
    }
  });

  it('es prácticamente único: 200 muestras sin repetidos', () => {
    // 32^6 ≈ 1.070 M de combinaciones ⇒ probabilidad de choque ≈ 2e-5.
    // La unicidad REAL la garantiza `unique` en 23-validate:65 contra la hoja.
    const vistos = new Set();
    for (let i = 0; i < 200; i++) vistos.add(token('x'));
    expect(vistos.size).toBe(200);
  });

  it('sigue funcionando cuando no hay crypto (camino de Apps Script)', () => {
    // Apps Script V8 no expone Web Crypto: el transform debe caer a Math.random.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    delete globalThis.crypto;
    try {
      expect(token('x')).toMatch(SOLO_ALFABETO);
      expect(token('x', { length: 8 })).toHaveLength(8);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });
});
