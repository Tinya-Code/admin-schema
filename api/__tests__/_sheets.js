// api/__tests__/_sheets — fixture mínima de Google Sheets para los tests del
// backend. NO es un spec: los specs la importan.
//
// Cubre EXACTAMENTE la superficie que usan engine/21-repo:
//   readSheetData_   → getSheetByName · getLastRow · getLastColumn ·
//                      getRange(r, c, h, w).getValues()
//   writeRowsBlock_  → getLastRow · getRange(…).setValues() · clearContent()
// y el append de fila de 24-crud (getRange(lastRow+1, 1, 1, n).setValues()).
//
// Con eso se ejercita el write path completo de 24-crud SIN Sheets reales y
// SIN disparar SpreadsheetApp (los tests llaman a
// resourceCreate_/resourcePut_/resourceDelete_ directamente, porque
// dispatchResource_ llama a openSpreadsheet_()).

/**
 * Hoja en memoria. `grid` es el contenido inicial: la PRIMERA fila son los
 * headers — el motor no puede derivarlos de una hoja vacía
 * (readSheetData_ devuelve `headers: []` si lastRow < 2).
 */
export function fakeSheet_(grid) {
  const state = { grid: grid.map((row) => row.slice()) };

  return {
    getLastRow: () => state.grid.length,
    getLastColumn: () => (state.grid.length ? state.grid[0].length : 0),

    getRange(row, col, height, width) {
      return {
        getValues: () =>
          state.grid
            .slice(row - 1, row - 1 + height)
            .map((values) => values.slice(col - 1, col - 1 + width)),

        setValues(rows) {
          rows.forEach((values, i) => {
            const gridRow = row - 1 + i;
            // Append: crece hasta la fila pedida, con el ancho de la cabecera.
            while (state.grid.length <= gridRow) {
              state.grid.push(new Array(state.grid[0].length).fill(''));
            }
            values.forEach((value, j) => {
              state.grid[gridRow][col - 1 + j] = value;
            });
          });
        },

        clearContent() {
          for (let i = 0; i < height; i++) {
            const gridRow = row - 1 + i;
            if (!state.grid[gridRow]) continue;
            for (let j = 0; j < width; j++) state.grid[gridRow][col - 1 + j] = '';
          }
        },
      };
    },

    /**
     * `appendRow` — sólo lo usa `50-audit.js`. Se ajusta al ancho de la
     * cabecera, como haría la hoja real al no recibir más columnas.
     */
    appendRow(values) {
      const row = new Array(state.grid[0].length).fill('');
      values.forEach((value, i) => {
        if (i < row.length) row[i] = value;
      });
      state.grid.push(row);
    },

    /**
     * `deleteRows(row, count)` — la usa la poda del `_audit_log`
     * (capabilities/handlers/audit-prune, R9.5.1). Igual que la hoja real:
     * borra `count` filas empezando en `row` (1-based) y el resto sube.
     */
    deleteRows(row, count) {
      const from = Math.max(row - 1, 0);
      const howMany = Math.min(Math.max(count, 0), state.grid.length - from);
      state.grid.splice(from, howMany);
    },

    /** Inspección directa desde el test. */
    rows: () => state.grid,
  };
}

/** `ss` mínimo: sólo getSheetByName. Ausente ⇒ null (igual que GAS). */
export function fakeApp_(sheets) {
  return {
    getSheetByName: (name) =>
      Object.prototype.hasOwnProperty.call(sheets, name) ? sheets[name] : null,
  };
}
