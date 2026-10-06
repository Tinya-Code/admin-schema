// api/__tests__/contract-to-flat — contractToFlat_ (engine/22-assemble).
//
// Es el filtro que decide QUÉ llega a la hoja. Descarta todo campo con
// `system: true` o con `computed` declarado, porque de esos el backend es
// dueño (position, updated_at). Ese descarte es el que hizo fallar la
// primera versión de la propuesta `orders`: un `ref` marcado como system
// se derivaba y validaba bien, pero contractToFlat_ lo tiraba en el paso
// previo a escribir, así que la fila salía SIN ref.
//
// Se construye el mapa con storageMap_ real, no con un objeto inventado,
// para que la suite también cubra la traducción schema → columnas.

import { beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let storageMap_;
let contractToFlat_;

beforeAll(() => {
  loadBackend();
  storageMap_ = globalThis.storageMap_;
  contractToFlat_ = globalThis.contractToFlat_;
});

/** Recurso de colección mínimo con los tres casos que interesan. */
const recurso = {
  id: 'demo',
  kind: 'collection',
  sheet: 'demo',
  keyField: 'ref',
  titleField: 'name',
  ordering: 'none',
  fields: [
    { key: 'name', type: 'text' },
    { key: 'active', type: 'boolean' },
    { key: 'quantity', type: 'number' },
    // El backend es dueño: NO debe pasar a la hoja.
    { key: 'ref', type: 'text', system: true },
    // Se calcula al escribir ('now'): tampoco debe pasar.
    { key: 'updated_at', type: 'readonly-text', computed: 'now' },
  ],
};

describe('contractToFlat_', () => {
  let map;

  beforeAll(() => {
    map = storageMap_(recurso);
  });

  it('construye una columna por campo escalar', () => {
    expect(map.columns.map((col) => col.flatKey)).toEqual([
      'name',
      'active',
      'quantity',
      'ref',
      'updated_at',
    ]);
  });

  it('marca system y computed tal como los declara el schema', () => {
    const porKey = Object.fromEntries(map.columns.map((col) => [col.key, col]));
    expect(porKey['ref'].system).toBe(true);
    expect(porKey['ref'].computed).toBeNull();
    expect(porKey['updated_at'].system).toBe(false);
    expect(porKey['updated_at'].computed).toBe('now');
    expect(porKey['name'].system).toBe(false);
    expect(porKey['name'].computed).toBeNull();
  });

  it('pasa los campos normales a la hoja', () => {
    const flat = contractToFlat_(map, { name: 'Ana', quantity: 3 });
    expect(flat).toEqual({ name: 'Ana', quantity: 3 });
  });

  it('DESCARTA el campo system aunque venga con valor', () => {
    const flat = contractToFlat_(map, { name: 'Ana', ref: 'A1B2C3' });
    expect(flat).not.toHaveProperty('ref');
    expect(flat).toEqual({ name: 'Ana' });
  });

  it('DESCARTA el campo computed aunque venga con valor', () => {
    const flat = contractToFlat_(map, { name: 'Ana', updated_at: '2026-01-01T00:00:00' });
    expect(flat).not.toHaveProperty('updated_at');
    expect(flat).toEqual({ name: 'Ana' });
  });

  it('no escribe las claves ausentes ni las indefinidas', () => {
    const flat = contractToFlat_(map, { name: undefined });
    expect(flat).toEqual({});
  });

  it('coerciona booleanos y números al formato de celda', () => {
    const flat = contractToFlat_(map, { active: true, quantity: '7' });
    expect(flat.active).toBe(true);
    expect(flat.quantity).toBe(7);
  });

  it('descarta system y computed en el mismo paso en que escribe el resto', () => {
    const flat = contractToFlat_(map, {
      name: 'Pedido',
      active: false,
      ref: 'NO-DEBE-PASAR',
      updated_at: 'ignorame',
    });
    expect(Object.keys(flat).sort()).toEqual(['active', 'name']);
  });
});
