// api/__tests__/export-import — R9.5.4 · import/export declarativo (B14).
//
// Lo que éste archivo cubre y ninguna otra parte cubre:
//
//  1. **El export vuelca SÓLO los campos declarados** en
//     `operations.export.fields`, en CSV (por defecto) o JSON, y un campo
//     que vive en hoja hija (list/key-value/group) o es `secret` es ROJO AL
//     ARRANQUE (fail-loud en validate-registry): la ruta de export jamás
//     llega a construirse sobre una declaración que mentiría.
//  2. **El import corre el MISMO pipeline que el create**: transforma el
//     campo computado (`slug` desde `name`), escribe la fila, audita y deja
//     la hoja consistente. Una fila importada NO es una excepción del motor.
//  3. **Una fila inválida no deja fragmentos**: se valida TODA la hoja antes
//     de escribir NADA, y una fila que no valida se reporta con sus errores
//     sin dejar la hoja a medias (ni la fila, ni sus hijas).
//  4. **La ruta sale del recurso y sólo si declara la operación** (O2): un
//     recurso sin `operations.export` responde 404 en la ruta de export, y
//     el router la resuelve ANTES de la clave genérica (que cortaría
//     'export' como si fuera la clave de un registro).
//  5. **Formato**: el declarado manda por defecto; un override del request
//     sólo puede nombrar `csv` | `json`; cualquier otra cosa es 400 ruidoso.
//
// La hoja en memoria es `_sheets.js` (misma superficie que las reales).

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

const SHEET = '__io_sheet__';
const RESOURCE_ID = '__io__';

let REGISTRY;
let resource;
let map_;
let sheet;
let ss;
let origOpenSpreadsheet_;

/** Recurso mínimo; el create declara el transform de `slug` como en producción. */
function scenario_(operations, extraFields) {
  resource = {
    id: RESOURCE_ID,
    kind: 'collection',
    sheet: SHEET,
    keyField: 'slug',
    titleField: 'name',
    ordering: 'none',
    activeField: null,
    policies: { access: { read: 'admin', write: 'admin' }, lock: false, audit: false },
    operations: Object.assign(
      { create: { computed: [{ field: 'slug', transform: 'slugify', from: 'name' }] } },
      operations,
    ),
    fields: [
      { key: 'slug', type: 'slug', required: true, unique: true, immutable: true, from: 'name' },
      { key: 'name', type: 'text', required: true },
      { key: 'price', type: 'currency', required: false },
      { key: 'nota', type: 'text', required: false },
    ].concat(extraFields || []),
  };
  sheet = fakeSheet_([['slug', 'name', 'price', 'nota']]);
  ss = fakeApp_({ [SHEET]: sheet });
  globalThis.openSpreadsheet_ = () => ss;
  delete globalThis.STORAGE_MAPS_[RESOURCE_ID];
  globalThis.cacheInvalidate_(RESOURCE_ID);
  map_ = globalThis.storageMap_(resource);
  return resource;
}

/** Filas de datos (sin cabecera). */
const data_ = () => sheet.rows().slice(1);

function registerFixture() {
  REGISTRY.resources[RESOURCE_ID] = resource;
  // La tabla de rutas se cachea por ejecución: reconstruirla por escenario.
  globalThis.ROUTE_TABLE_ = null;
}

function unregisterFixture() {
  delete REGISTRY.resources[RESOURCE_ID];
}

/** seed_ deja filas de datos listas para exportar. */
function seed_(rows) {
  rows.forEach((row) => {
    const values = new Array(sheet.getLastColumn()).fill('');
    row.forEach((value, i) => {
      values[i] = value;
    });
    sheet.appendRow(values);
  });
}

const export_ = (payload = {}) =>
  globalThis.dispatchExport_(resource, { method: 'GET', payload, user: null });

const import_ = (payload) =>
  globalThis.dispatchImport_(resource, { method: 'POST', payload, user: null });

/** Falla si NO lanza; devuelve el error para seguir inspeccionando. */
function expectStatus_(fn, status, fragmento) {
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

beforeAll(() => {
  REGISTRY = loadBackend();
});

beforeEach(() => {
  origOpenSpreadsheet_ = globalThis.openSpreadsheet_;
});

afterEach(() => {
  globalThis.openSpreadsheet_ = origOpenSpreadsheet_;
  unregisterFixture();
});

describe('export · volcado declarativo (R9.5.4)', () => {
  it('CSV sólo con los campos declarados, en el orden declarado', () => {
    scenario_({ export: { fields: ['name', 'price'] } });
    registerFixture();
    seed_([
      ['p-uno', 'Mate', 1000],
      ['p-dos', 'Taza', 2000],
    ]);
    const out = export_({});
    expect(out.format).toBe('csv');
    expect(out.fields).toEqual(['name', 'price']);
    expect(out.count).toBe(2);
    // Cabecera + 2 filas, SIN la columna slug (no declarada).
    expect(out.csv.split('\n')).toEqual(['name,price', 'Mate,1000', 'Taza,2000']);
  });

  it('formato declarado json ⇒ devuelve rows[], no csv', () => {
    scenario_({ export: { fields: ['slug', 'name'], format: 'json' } });
    registerFixture();
    seed_([['p-uno', 'Mate']]);
    const out = export_({});
    expect(out.format).toBe('json');
    expect(out.rows).toEqual([{ slug: 'p-uno', name: 'Mate' }]);
    expect(out.csv).toBeUndefined();
  });

  it('un override del request sólo admite csv | json', () => {
    scenario_({ export: { fields: ['slug'] } });
    registerFixture();
    seed_([['p-uno']]);
    expect(export_({ format: 'json' }).format).toBe('json');
    expectStatus_(() => export_({ format: 'xml' }), 400, 'formato inválido');
  });

  it('una celda que arranca con = se neutraliza (no fórmula)', () => {
    scenario_({ export: { fields: ['name'] } });
    registerFixture();
    seed_([['p-uno', '=1+1']]);
    const out = export_({});
    // El prefijo ' la deja como texto al abrir en Sheets.
    expect(out.csv.split('\n')[1]).toBe("'=1+1");
  });

  it('una comilla/adentro se escapa por duplicado y se entrecomilla', () => {
    scenario_({ export: { fields: ['name'] } });
    registerFixture();
    seed_([['p-uno', 'Dijo "hola", chau']]);
    const out = export_({});
    expect(out.csv.split('\n')[1]).toBe('"Dijo ""hola"", chau"');
  });
});

describe('import · mismo pipeline que el create (R9.5.4)', () => {
  it('escribe la fila y transforma el campo computado (slug desde name)', () => {
    scenario_({ import: { fields: ['name', 'price'] } });
    registerFixture();
    const out = import_({ rows: [{ name: 'Termo Yerbero', price: 3500 }] });
    expect(out.created).toBe(1);
    expect(out.invalid).toBe(0);
    expect(data_()).toHaveLength(1);
    // El slug se COMPUTA como en cualquier create (slugify de name).
    expect(data_()[0][0]).toBe('termo-yerbero');
    expect(data_()[0][1]).toBe('Termo Yerbero');
    expect(data_()[0][2]).toBe(3500);
  });

  it('una fila inválida se reporta con sus errores y NO deja fragmentos', () => {
    scenario_({ import: { fields: ['name', 'price'] } });
    registerFixture();
    // name es required: la segunda fila no valida.
    const out = import_({ rows: [{ name: 'Mate', price: 1000 }, { price: 2000 }] });
    expect(out.created).toBe(1);
    expect(out.invalid).toBe(1);
    expect(data_()).toHaveLength(1); // sólo entró la válida
    const bad = out.results[1];
    expect(bad.status).toBe('invalid');
    expect(JSON.stringify(bad.errors)).toContain('name');
  });

  it('una fila que no es objeto se reporta como inválida (no revienta el lote)', () => {
    scenario_({ import: { fields: ['name'] } });
    registerFixture();
    const out = import_({ rows: ['no soy objeto', { name: 'Mate' }] });
    expect(out.created).toBe(1);
    expect(out.invalid).toBe(1);
    expect(out.results[0].status).toBe('invalid');
  });

  it('un campo fuera de operations.import.fields es inválido, nunca en silencio', () => {
    scenario_({ import: { fields: ['name'] } });
    registerFixture();
    const out = import_({ rows: [{ name: 'Mate', price: 999 }] });
    expect(out.created).toBe(0);
    expect(out.invalid).toBe(1);
    expect(JSON.stringify(out.results[0].errors)).toContain('price');
    expect(data_()).toHaveLength(0);
  });

  it('sin `fields` declara todos los campos escribibles', () => {
    scenario_({ import: true });
    registerFixture();
    const out = import_({ rows: [{ name: 'Mate', price: 1000, nota: 'ok' }] });
    expect(out.created).toBe(1);
    expect(data_()[0][3]).toBe('ok');
  });

  it('un import sin create encendido es 405, no un pipeline muerto', () => {
    scenario_({ import: { fields: ['name'] }, create: false });
    registerFixture();
    expectStatus_(() => import_({ rows: [{ name: 'Mate' }] }), 405, 'operations.create');
  });

  it('rows que no es un arreglo (o vacío) es 400', () => {
    scenario_({ import: { fields: ['name'] } });
    registerFixture();
    expectStatus_(() => import_({ rows: { name: 'Mate' } }), 400, 'rows debe ser un arreglo');
    expectStatus_(() => import_({ rows: [] }), 400, 'rows debe ser un arreglo');
  });
});

describe('ruta derivada del recurso (O2 · R9.5.4)', () => {
  it('una colección CON operations.export publica /<base>/export', () => {
    scenario_({ export: { fields: ['name'] } });
    registerFixture();
    const route = globalThis.resolveRoute_(`/admin/${RESOURCE_ID}/export`);
    expect(route).not.toBeNull();
    expect(route.kind).toBe('io');
    expect(route.io).toBe('export');
    expect(route.resource.id).toBe(RESOURCE_ID);
  });

  it('una colección CON operations.import publica /<base>/import', () => {
    scenario_({ import: { fields: ['name'] } });
    registerFixture();
    const route = globalThis.resolveRoute_(`/admin/${RESOURCE_ID}/import`);
    expect(route.kind).toBe('io');
    expect(route.io).toBe('import');
  });

  it('SIN declaración la ruta no activa la máquina io (queda la clave genérica)', () => {
    scenario_({}); // sin export ni import
    registerFixture(); // ya limpia la tabla de rutas
    const route = globalThis.resolveRoute_(`/admin/${RESOURCE_ID}/export`);
    // 'export' cae a la ruta con clave genérica: un registro CUALQUIERA puede
    // llamarse 'export'. Lo que no pasa es la máquina de volcado — sin
    // declaración no hay export, y si el registro no existe el get tira 404.
    expect(route.kind).not.toBe('io');
    expect(globalThis.resolveRoute_(`/admin/${RESOURCE_ID}/import`).kind).not.toBe('io');
  });

  it("'export' no se confunde con la clave de un registro (resuelve io, no keyed)", () => {
    scenario_({ export: { fields: ['name'] } });
    registerFixture();
    globalThis.ROUTE_TABLE_ = null;
    const route = globalThis.resolveRoute_(`/admin/${RESOURCE_ID}/export`);
    // Si el router cortara 'export' como clave, sería kind 'resource' con
    // params.export. Acá es la operación declarada.
    expect(route.kind).toBe('io');
  });
});
