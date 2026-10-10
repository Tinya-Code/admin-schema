import { toSeries } from './series';

// R6.3 — el agregado con groupBy del backend (R6.2) devuelve
// [{ group, value }], no [{ label, value }]. `toSeries` es el puente
// entre el contrato del motor y el de los gráficos: debe aceptar AMBAS
// formas. Sin esto, chart-line/bar-chart pintarían [] con un agregado
// agrupado declarado.
describe('toSeries', () => {
  it('normaliza las filas del agregado agrupado { group, value }', () => {
    expect(
      toSeries([
        { group: '2024-03-15', value: 30 },
        { group: '2024-03-16', value: 7 },
      ]),
    ).toEqual([
      { label: '2024-03-15', value: 30 },
      { label: '2024-03-16', value: 7 },
    ]);
  });

  it('conserva la forma histórica { label, value }', () => {
    expect(toSeries([{ label: 'Lun', value: 3 }])).toEqual([{ label: 'Lun', value: 3 }]);
  });

  it('descarta filas cuyo group no es string o value no es number', () => {
    expect(
      toSeries([
        { group: 'ok', value: 1 },
        { group: 42, value: 2 },
        { group: 'mal', value: 'x' },
        null,
        'fila',
      ]),
    ).toEqual([{ label: 'ok', value: 1 }]);
  });

  it('devuelve [] ante cualquier cosa que no sea array', () => {
    expect(toSeries(null)).toEqual([]);
    expect(toSeries({ group: 'x', value: 1 })).toEqual([]);
    expect(toSeries(7)).toEqual([]);
  });
});
