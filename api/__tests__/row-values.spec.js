// api/__tests__/row-values — engine/21-repo: `rowValues_` FAIL-LOUD (R1.1).
//
// El bug: `rowValues_` itera sobre `headers`, así que una clave de `flat`
// sin columna en la hoja JAMÁS se consultaba — se descartaba en silencio y
// el create devolvía OK con el dato perdido para siempre. Este spec cubre la
// superficie completa del write path (map completo ⇒ OK; hoja corta ⇒ 500).
//
// Se llama a resourceCreate_ DIRECTAMENTE (no dispatchResource_) porque
// éste abre el SpreadsheetApp real. Recurso mínimo sin lock/audit/hijos, como
// en crud-hooks.spec.js.

import { beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let storageMap_;
let resourceCreate_;

const SHEET = '__rowvalues_sheet__';
const RESOURCE_ID = '__rowvalues_test__';

/** Recurso mínimo: dos campos escalar, sin nada que arrastre a otra hoja. */
function buildResource_() {
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
    fields: [
      { key: 'key', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
    ],
  };
}

/**
 * Hoja con un SUBCONJUNTO de las columnas que el schema declara.
 * `headers` es literalmente la primera fila de la hoja: acá es donde vive
 * el desajuste schema ⇄ hoja que R1.1 debe atrapar.
 */
function scenario_(headers) {
  const resource = buildResource_();
  const map = storageMap_(resource);
  const sheet = fakeSheet_([headers]);
  return { resource, map, sheet, ss: fakeApp_({ [SHEET]: sheet }) };
}

/** Falla si NO lanza; devuelve el error para seguir inspeccionando. */
function expectStatus(fn, status, fragmento) {
  let error;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  expect(error, 'esperaba que tirara').toBeDefined();
  expect(error.apiStatus).toBe(status);
  if (fragmento) expect(error.message).toContain(fragmento);
  return error;
}

const payload = { key: 'p1', name: 'Pan' };
const post = { method: 'POST', payload };

beforeAll(() => {
  loadBackend();
  storageMap_ = globalThis.storageMap_;
  resourceCreate_ = globalThis.resourceCreate_;
});

describe('rowValues_ — fail-loud ante columna ausente (R1.1)', () => {
  it('la hoja pone TODAS las columnas del schema ⇒ escribe y responde OK', () => {
    const s = scenario_(['key', 'name']);
    const out = resourceCreate_(s.ss, s.resource, s.map, post);

    expect(out).toBeDefined();
    // Fila escrita con AMBOS valores: nada se cayó en el camino.
    expect(s.sheet.rows()).toContainEqual(['p1', 'Pan']);
  });

  it('falta una columna que el schema espera ⇒ 500 nombrándola', () => {
    const s = scenario_(['key']); // `name` no existe en la hoja
    expectStatus(() => resourceCreate_(s.ss, s.resource, s.map, post), 500, 'name');
    // La orientación es accionable: dice qué correr.
    expectStatus(() => resourceCreate_(s.ss, s.resource, s.map, post), 500, 'setupDrift');
  });

  it('la hoja vacía sin cabecera ⇒ 500, nunca un OK silencioso', () => {
    const s = scenario_([]);
    expectStatus(() => resourceCreate_(s.ss, s.resource, s.map, post), 500);
  });

  it('falla ANTES de tocar la hoja: no queda nada a medias', () => {
    const s = scenario_(['key']);
    expectStatus(() => resourceCreate_(s.ss, s.resource, s.map, post), 500);
    expect(s.sheet.rows()).toEqual([['key']]);
  });

  it('la columna ausente se nombra como la que el payload traía', () => {
    const s = scenario_(['name']); // falta `key`, el campo obligatorio
    const err = expectStatus(
      () => resourceCreate_(s.ss, s.resource, s.map, { method: 'POST', payload }),
      500,
    );
    expect(err.message).toContain('key');
    expect(err.message).not.toContain('name'); // `name` SÍ está en la hoja
  });
});
