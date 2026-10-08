// api/__tests__/write-response — R1.3: la respuesta de create/update sale
// de LO ESCRITO + los computados, no de una relectura de la hoja.
//
// Cadena original (doc/pedidos-rectificacion.md §1, eslabón 3): la respuesta
// salía de `readDetail_`, así que cualquier valor perdido en el camino
// aparecía «ok pero vacío» en el front. Ahora la fila se construye primero y
// la respuesta se arma desde ELLA; la relectura queda sólo como contraste.
//
// La prueba de oro es `expect(out).toEqual(reread)`: si la respuesta se
// construyera de otra fuente que la hoja, esta igualdad se rompe.

import { beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let storageMap_;
let resourceCreate_;
let resourcePut_;
let readDetail_;

const SHEET = '__written_sheet__';
const RESOURCE_ID = '__written_test__';

const HEADERS = ['key', 'name', 'slug', 'created_at'];

/** Colección con DOS computados: por transform (slug) y por celda (now). */
function buildCollection_() {
  return {
    id: RESOURCE_ID,
    kind: 'collection',
    sheet: SHEET,
    keyField: 'key',
    titleField: 'name',
    ordering: 'none',
    activeField: null,
    onDelete: 'none',
    dependents: [],
    listProjection: null,
    imageFolder: null,
    views: {},
    policies: { access: { read: 'admin', write: 'admin' }, lock: false },
    exposeToFront: false,
    operations: {
      create: { computed: [{ field: 'slug', transform: 'slugify', from: 'name' }] },
    },
    fields: [
      { key: 'key', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
      { key: 'slug', type: 'text' },
      { key: 'created_at', type: 'readonly-text', system: true, computed: 'now' },
    ],
  };
}

function scenario_() {
  const resource = buildCollection_();
  const map = storageMap_(resource);
  const sheet = fakeSheet_([HEADERS]);
  return { resource, map, sheet, ss: fakeApp_({ [SHEET]: sheet }) };
}

beforeAll(() => {
  loadBackend();
  storageMap_ = globalThis.storageMap_;
  resourceCreate_ = globalThis.resourceCreate_;
  resourcePut_ = globalThis.resourcePut_;
  readDetail_ = globalThis.readDetail_;
});

describe('R1.3 — respuesta desde lo escrito', () => {
  it('create: los DOS computados llegan en la respuesta, sin quedar vacíos', () => {
    const s = scenario_();
    const out = resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'Pan Integral' },
    });

    // computado por transform (operations.create.computed)
    expect(out.slug).toBeTruthy();
    expect(out.slug).not.toBe('');
    // computado por celda (col.computed === 'now')
    expect(out.created_at).toBeTruthy();
    expect(out.created_at).not.toBe('');
  });

  it('create: releer la hoja CONFIRMA lo mismo — nada se pierde en el ensamblado', () => {
    const s = scenario_();
    const out = resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'Pan Integral' },
    });

    const reread = readDetail_(s.ss, s.resource, s.map, 'p1');
    expect(out).toEqual(reread);
  });

  it('create: el computado en la respuesta es EXACTAMENTE lo que se escribió en la hoja', () => {
    const s = scenario_();
    const out = resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'Pan Integral' },
    });

    const row = s.sheet.rows()[1]; // [0] es la cabecera
    expect(row[2]).toBe(out.slug);
    expect(row[3]).toBe(out.created_at);
  });

  it('update: mismo contrato — respuesta == relectura, computados presentes', () => {
    const s = scenario_();
    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'Pan Integral' },
    });

    const out = resourcePut_(s.ss, s.resource, s.map, {
      method: 'PUT',
      params: { key: 'p1' },
      payload: { name: 'Pan de Molde' },
    });

    expect(out.slug).toBeTruthy();
    expect(out.created_at).toBeTruthy();
    expect(out).toEqual(readDetail_(s.ss, s.resource, s.map, 'p1'));
  });

  it('el campo que el payload NO trae también se conserva (sin borrarse)', () => {
    const s = scenario_();
    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'p1', name: 'Pan Integral' },
    });
    const antes = readDetail_(s.ss, s.resource, s.map, 'p1');

    const out = resourcePut_(s.ss, s.resource, s.map, {
      method: 'PUT',
      params: { key: 'p1' },
      payload: { name: 'Pan de Molde' },
    });

    // `slug` no está en el payload del PUT ni se recalcula (el transform es
    // sólo de create) ⇒ debe salir intacto de la fila guardada.
    expect(out.slug).toBe(antes.slug);
    expect(out.name).toBe('Pan de Molde'); // sí lo actualizó
  });
});
