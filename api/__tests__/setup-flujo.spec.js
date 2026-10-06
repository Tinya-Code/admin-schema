// api/__tests__/setup-flujo — Ejecuta el setup COMPLETO contra un libro en
// memoria, no sólo `getSheetSpecs_`.
//
// El hueco que cubre: `setup-sheets.spec.js` sólo verifica qué specs se
// empujan; nadie ejercitaba `ensureSheet_`, `setupDrift` ni `setupSeed`,
// que son los tres pasos que corren sobre el libro real de Google. Acá se
// encadenan en el mismo orden en que los llama un operador y se pide
// idempotencia (2ª corrida ⇒ 0 cambios).

import { beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let ss;
let setupSheets;
let setupDrift;
let setupSeed;

/** Hoja en memoria con la superficie que usan setup/02 y setup/03. */
function makeSheet(name, grid = []) {
  const state = { name, grid: grid.map((row) => row.slice()) };
  const sheet = {
    getName: () => state.name,
    getLastRow: () => state.grid.length,
    getLastColumn: () => (state.grid.length ? state.grid[0].length : 0),
    getProtections: () => [],

    // GAS: agrega una fila al final con los valores dados.
    appendRow(values) {
      const width = Math.max(sheet.getLastColumn(), values.length);
      const row = new Array(width).fill('');
      values.forEach((value, index) => {
        row[index] = value;
      });
      state.grid.push(row);
    },

    getRange(row, col, height, width) {
      const h = height ?? 1;
      const w = width ?? 1;
      const slice = () =>
        state.grid.slice(row - 1, row - 1 + h).map((values) => values.slice(col - 1, col - 1 + w));
      return {
        getValues: slice,
        setValues(rows) {
          rows.forEach((values, i) => {
            const gridRow = row - 1 + i;
            while (state.grid.length <= gridRow) {
              state.grid.push(new Array(state.grid[0]?.length ?? 0).fill(''));
            }
            values.forEach((value, j) => {
              state.grid[gridRow][col - 1 + j] = value;
            });
          });
        },
        setValue(value) {
          this.setValues([[value]]);
        },
        clearContent() {
          for (let i = 0; i < h; i++) {
            const gridRow = row - 1 + i;
            if (!state.grid[gridRow]) continue;
            for (let j = 0; j < w; j++) state.grid[gridRow][col - 1 + j] = '';
          }
        },
        // Formato/validación: sólo tienen que existir.
        setNumberFormat() {
          return this;
        },
        setDataValidation() {
          return this;
        },
        protect() {
          return {
            setDescription() {
              return this;
            },
          };
        },
      };
    },

    // Inserta una columna DESPUÉS de `index` (1-based) en todas las filas.
    insertColumnAfter(index) {
      if (state.grid.length === 0) state.grid.push([]);
      state.grid.forEach((row) => {
        while (row.length < index) row.push('');
        row.splice(index, 0, '');
      });
    },
  };
  return sheet;
}

/** Libro: getSheetByName / insertSheet / getSheets. */
function makeWorkbook(initial = {}) {
  const sheets = { ...initial };
  return {
    getSheetByName: (name) =>
      Object.prototype.hasOwnProperty.call(sheets, name) ? sheets[name] : null,
    insertSheet(name) {
      const sheet = makeSheet(name);
      sheets[name] = sheet;
      return sheet;
    },
    getSheets: () => Object.values(sheets),
    _sheets: sheets,
  };
}

beforeAll(() => {
  loadBackend();
  setupSheets = globalThis.setupSheets;
  setupDrift = globalThis.setupDrift;
  setupSeed = globalThis.setupSeed;

  ss = makeWorkbook();
  globalThis.SpreadsheetApp = {
    openById: () => ss,
    ProtectionType: { RANGE: 'RANGE' },
    newDataValidation: () => {
      const chain = {
        requireValueInList: () => chain,
        setAllowInvalid: () => chain,
        build: () => chain,
      };
      return chain;
    },
  };
});

describe('setup completo contra un libro en memoria', () => {
  it('setupSheets crea todas las hojas del schema sin lanzar', () => {
    let result;
    expect(() => {
      result = setupSheets();
    }).not.toThrow();

    expect(result.ok).toBe(true);
    expect(result.created.length).toBeGreaterThan(0);
    // Ningún spec con nombre indefinido llega al libro.
    expect(result.sheets.every((entry) => typeof entry.name === 'string')).toBe(true);
    expect(ss.getSheetByName(undefined)).toBeNull();
  });

  it('las hojas creadas quedan con cabeceras (nunca vacías)', () => {
    const specs = globalThis.getSheetSpecs_();
    for (const spec of specs) {
      const sheet = ss.getSheetByName(spec.name);
      expect(sheet, `falta la hoja ${spec.name}`).not.toBeNull();
      expect(sheet.getLastRow(), `${spec.name} sin cabecera`).toBeGreaterThanOrEqual(1);
    }
  });

  it('setupDrift no reporta columnas añadidas ni huérfanas tras setupSheets', () => {
    let report;
    expect(() => {
      report = setupDrift();
    }).not.toThrow();

    expect(report.blocked).toEqual([]);
    expect(report.added).toEqual([]);
    expect(report.orphans).toEqual([]);
  });

  it('setupSeed siembra enums, placeholders y filas KV de los singletons', () => {
    let report;
    expect(() => {
      report = setupSeed();
    }).not.toThrow();

    expect(report.placeholdersUpdated).toEqual(['pattern']);
    expect(report.enumsUpdated.length).toBeGreaterThan(0);

    for (const singleton of ['site_config', 'legal_config', 'pickpass_config']) {
      const sheet = ss.getSheetByName(singleton);
      expect(sheet, `falta la hoja singleton ${singleton}`).not.toBeNull();
      expect(sheet.getLastRow(), `${singleton} sin filas KV`).toBeGreaterThan(1);
    }
  });

  it('la 2ª corrida completa es idempotente (0 hojas nuevas, 0 columnas)', () => {
    const before = Object.keys(ss._sheets).length;

    const first = setupSheets();
    const second = setupSheets();
    const drift = setupDrift();
    const seed = setupSeed();

    expect(second.created).toEqual([]);
    expect(drift.createdSheets).toEqual([]);
    expect(drift.added).toEqual([]);
    expect(seed.kvRowsAdded).toEqual([]);
    expect(Object.keys(ss._sheets).length).toBe(before);
    expect(first.ok).toBe(true);
  });
});
