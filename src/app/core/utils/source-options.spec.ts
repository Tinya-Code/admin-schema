import { describe, expect, it } from 'vitest';

import type { DataSource, ResourceSchema } from '../models/schema.model';
import { optionsFromRows } from './source-options';

const TARGET: ResourceSchema = {
  id: 'categories',
  label: 'Categoría',
  labelPlural: 'Categorías',
  kind: 'collection',
  endpoint: { list: '/admin/categories' },
  keyField: 'slug',
  titleField: 'name',
  listColumns: [],
  fields: [],
};

const FILAS = [
  { slug: 'bebidas', name: 'Bebidas', description: 'Frías', active: true },
  { slug: 'pan', name: '', description: '', active: false },
];

const source = (extra: Partial<DataSource> = {}): DataSource => ({
  resource: 'categories',
  ...extra,
});

describe('optionsFromRows', () => {
  it('usa valueField/labelField declarados en la fuente', () => {
    const opciones = optionsFromRows(FILAS, {
      source: source({ valueField: 'slug', labelField: 'name' }),
      target: TARGET,
    });
    expect(opciones).toEqual([
      { value: 'bebidas', label: 'Bebidas' },
      { value: 'pan', label: 'pan' }, // label vacío ⇒ cae al valor
    ]);
  });

  it('sin los campos declarados cae a keyField/titleField del recurso destino', () => {
    const opciones = optionsFromRows(FILAS, { source: source(), target: TARGET });
    expect(opciones[0]).toEqual({ value: 'bebidas', label: 'Bebidas' });
  });

  it('sin nada declarado el valor es `id` (último recurso conocido)', () => {
    const opciones = optionsFromRows([{ id: 'x' }], {
      source: source(),
      target: undefined,
    });
    expect(opciones).toEqual([{ value: 'x', label: 'x' }]);
  });

  it('una fila sin valor no es opción: no hay qué seleccionar', () => {
    const opciones = optionsFromRows(
      [{ slug: '', name: 'Vacía' }, { name: 'Sin clave' }, { slug: null, name: 'Nula' }],
      { source: source({ valueField: 'slug', labelField: 'name' }), target: TARGET },
    );
    expect(opciones).toEqual([]);
  });

  it('`onlyActive` descarta las inactivas en el cliente', () => {
    const opciones = optionsFromRows(FILAS, {
      source: source({ valueField: 'slug', labelField: 'name' }),
      target: TARGET,
      onlyActive: true,
    });
    expect(opciones.map((o) => o.value)).toEqual(['bebidas']);
  });

  it('secondaryField añade el dato con « · », y se cae si no hay dato', () => {
    const opciones = optionsFromRows(
      [
        { slug: 'a', name: 'A', description: 'Frías' },
        { slug: 'b', name: 'B', description: '' },
        { slug: 'c', name: 'C' },
      ],
      {
        source: source({ valueField: 'slug', labelField: 'name' }),
        target: TARGET,
        secondaryField: 'description',
      },
    );
    expect(opciones.map((o) => o.label)).toEqual(['A · Frías', 'B', 'C']);
  });

  it('no muta las filas de entrada', () => {
    const filas = [{ slug: 'a', name: 'A', active: false }];
    const copia = JSON.parse(JSON.stringify(filas));
    optionsFromRows(filas, {
      source: source({ valueField: 'slug', labelField: 'name' }),
      target: TARGET,
      onlyActive: true,
    });
    expect(filas).toEqual(copia);
  });
});
