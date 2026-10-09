import { describe, expect, it } from 'vitest';

import type { FieldSchema } from '../../core/models/schema.model';
import { register } from '../../core/registry/render-registry';
import { fieldDescriptors } from '../../fields/descriptors';
import { seedValue, type SeedKind } from './seed';

/**
 * D32 · R3.8 — la siembra vive en el descriptor, no en un `switch`.
 *
 * Tres cosas distintas, ninguna cosmética:
 *
 *  1. **Oro por descriptor** — cada tipo registrado siembra la forma que su
 *     `seed` declara. Si alguien cambia `'number'` por `'string'` en un
 *     descriptor, el tipo empieza a nacer en `''` y este test lo dice antes
 *     que un formulario en producción.
 *  2. **Degradación** — un tipo fuera del catálogo siembra `undefined`, lo
 *     mismo que hace el render (R1.10): no se pinta, no existe.
 *  3. **Fail-loud** — un descriptor registrado *sin* `seed` lanza, en vez de
 *     sembrar `undefined` en silencio.
 *
 * El vitest aísla este fichero, así que el descriptor falso registrado en el
 * último test no se filtra al resto de la suite.
 */
describe('seedValue — siembra declarada por el descriptor', () => {
  const FORMA: Record<SeedKind, unknown> = {
    string: '',
    number: null,
    boolean: false,
    array: [],
    // `group` con `fields: []` siembra un objeto vacío.
    recursive: {},
  };

  const campos = fieldDescriptors.filter((descriptor) => descriptor.kind === 'field');

  for (const descriptor of campos) {
    it(`«${descriptor.type}» siembra la forma «${descriptor.seed}»`, () => {
      const campo = {
        key: 'k',
        label: 'K',
        type: descriptor.type,
        fields: [],
      } as unknown as FieldSchema;
      expect(seedValue(campo)).toEqual(FORMA[descriptor.seed as SeedKind]);
    });
  }

  it('un tipo fuera del catálogo siembra `undefined` y no revienta', () => {
    const campo = { key: 'k', label: 'K', type: 'sombrero' } as unknown as FieldSchema;
    expect(seedValue(campo)).toBeUndefined();
  });

  it('un descriptor sin `seed` lanza en sembrar', () => {
    register('field', {
      kind: 'field',
      type: 'sin-siembra',
      since: '1.0',
      load: () => Promise.resolve(class Vacia {}),
    });
    const campo = { key: 'k', label: 'K', type: 'sin-siembra' } as unknown as FieldSchema;
    expect(() => seedValue(campo)).toThrow(/no declara `seed`/);
  });
});
