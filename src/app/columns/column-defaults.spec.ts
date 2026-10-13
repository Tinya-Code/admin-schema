import { describe, expect, it } from 'vitest';

import { SUPPORTED_FIELD_TYPE_LIST } from '../fields/descriptors';
import type { FieldSchema, ListColumn } from '../core/models/schema.model';
import { FORMATO_POR_DEFECTO, formatoDeColumna, formatoPorTipo } from './column-defaults';

/**
 * R4.4 — «declarada, no implícita»: la tabla de formato por defecto.
 *
 * Dos promesas: que la tabla cubra **todos** los tipos del catálogo, y que
 * una columna sin `format` pinta lo que la tabla dice — no un `?? 'text'`
 * implícito que dependía de la memoria de quien escribía el schema.
 */
describe('R4.4 — formato por defecto según field.type', () => {
  const columna = (parcial: Partial<ListColumn> & Pick<ListColumn, 'key'>): ListColumn => ({
    label: parcial.key,
    ...parcial,
  });
  const campo = (key: string, type: FieldSchema['type']): FieldSchema =>
    ({ key, label: key, type }) as FieldSchema;

  it('cubre exactamente el catálogo de tipos de campo', () => {
    // El `Record<FieldType, …>` ya lo exige en compilación; el test además
    // fija que ningún tipo se quede sin fila ni aparezca una fantasma.
    expect(Object.keys(FORMATO_POR_DEFECTO).sort()).toEqual([...SUPPORTED_FIELD_TYPE_LIST].sort());
    expect(SUPPORTED_FIELD_TYPE_LIST.length).toBe(21);
  });

  it('repasa la paridad tipo a tipo con el display del detalle', () => {
    const esperado: Record<string, string> = {
      text: 'text',
      textarea: 'text',
      slug: 'text',
      url: 'text',
      email: 'text',
      phone: 'text',
      'readonly-text': 'text',
      relation: 'text',
      group: 'text',
      'key-value': 'text',
      'string-list': 'text',
      multiselect: 'text',
      time: 'text',
      list: 'text',
      date: 'date',
      number: 'number',
      currency: 'currency',
      boolean: 'boolean',
      select: 'badge',
      image: 'thumbnail',
      file: 'text',
    };
    expect(Object.keys(FORMATO_POR_DEFECTO).sort()).toEqual(Object.keys(esperado).sort());
    for (const [tipo, formato] of Object.entries(esperado)) {
      expect(formatoPorTipo(tipo), `tipo ${tipo}`).toBe(formato);
    }
  });

  it('la declaración del schema manda sobre la tabla', () => {
    expect(
      formatoDeColumna(columna({ key: 'status', format: 'text' }), [campo('status', 'select')]),
    ).toBe('text');
    expect(
      formatoDeColumna(columna({ key: 'price', format: 'badge' }), [campo('price', 'currency')]),
    ).toBe('badge');
  });

  it('sin formato declarado usa el tipo del campo', () => {
    const campos = [
      campo('status', 'select'),
      campo('pickup_date', 'date'),
      campo('active', 'boolean'),
      campo('photo', 'image'),
      campo('price', 'currency'),
      campo('name', 'slug'),
    ];
    expect(formatoDeColumna(columna({ key: 'status' }), campos)).toBe('badge');
    expect(formatoDeColumna(columna({ key: 'pickup_date' }), campos)).toBe('date');
    expect(formatoDeColumna(columna({ key: 'active' }), campos)).toBe('boolean');
    expect(formatoDeColumna(columna({ key: 'photo' }), campos)).toBe('thumbnail');
    expect(formatoDeColumna(columna({ key: 'price' }), campos)).toBe('currency');
    expect(formatoDeColumna(columna({ key: 'name' }), campos)).toBe('text');
  });

  it('una columna sin campo asociado o con tipo mal escrito degrada a text', () => {
    // El `@default` del `@switch` que R4.3 reemplazó: la degradación es la
    // misma y nunca lanza.
    expect(formatoDeColumna(columna({ key: 'inventada' }), [campo('otra', 'text')])).toBe('text');
    expect(formatoPorTipo('holograma')).toBeUndefined();
    expect(
      formatoDeColumna(columna({ key: 'raro' }), [
        campo('raro', 'holograma' as FieldSchema['type']),
      ]),
    ).toBe('text');
  });
});
