import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FieldSchema, SelectField } from '../../core/models/schema.model';
import { SUPPORTED_FIELD_TYPE_LIST } from '../descriptors';
import { RenderHost } from '../../core/registry/render-host';
import { displayLoader } from './display-defaults';

/**
 * Paridad del modo `display` (R4.1 · R4.2).
 *
 * Cada caso es una fila de la tabla vieja `formatValue` de `detail-view`:
 * si un tipo pinta distinto de lo que pintaba antes de R4.2, este test se
 * pone rojo. Se monta por `RenderHost` y no por el componente suelto, para
 * que la prueba cubra también la rama de display del host (vacío, tabla y
 * degradación), no sólo el componente.
 */
@Component({
  selector: 'spec-display-host',
  imports: [RenderHost],
  template: `
    <app-render-host
      [type]="type()"
      [config]="campo()"
      mode="display"
      [value]="valor()"
      [chip]="chip()"
    />
  `,
})
class Host {
  readonly type = input.required<string>();
  readonly campo = input.required<FieldSchema>();
  readonly valor = input<unknown>(null);
  readonly chip = input(false);
}

describe('R4.1 — display por defecto según tipo', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  /**
   * Monta el host y espera el `load()` perezoso del display.
   *
   * `whenStable()` no cubre el `import()` dinámico (promesa ajena al rastreo
   * de Angular), así que se espera acotadamente mientras quede `<app-skeleton>`;
   * si el componente nunca monta, la espera se agota y falla la aserción.
   */
  async function pintar(campo: FieldSchema, valor: unknown, chip = false): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(Host);
    fixture.componentRef.setInput('type', campo.type);
    fixture.componentRef.setInput('campo', campo);
    fixture.componentRef.setInput('valor', valor);
    fixture.componentRef.setInput('chip', chip);
    fixture.detectChanges();
    await fixture.whenStable();
    for (
      let intento = 0;
      intento < 100 && fixture.nativeElement.querySelector('app-skeleton');
      intento++
    ) {
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const texto: FieldSchema = { key: 'nota', label: 'Nota', type: 'text' };
  const fecha: FieldSchema = { key: 'fecha', label: 'Fecha', type: 'date' };
  const numero: FieldSchema = { key: 'total', label: 'Total', type: 'number' };
  const moneda: FieldSchema = { key: 'precio', label: 'Precio', type: 'currency' };
  const booleano: FieldSchema = { key: 'activo', label: 'Activo', type: 'boolean' };
  const estado: SelectField = {
    key: 'status',
    label: 'Estado',
    type: 'select',
    options: [
      { value: 'PENDIENTE', label: 'Pendiente' },
      { value: 'ENTREGADO', label: 'Entregado' },
    ],
  };
  const imagen: FieldSchema = { key: 'foto', label: 'Foto', type: 'image' };
  const historial: FieldSchema = {
    key: 'history',
    label: 'Historial',
    type: 'list',
    itemFields: [{ key: 'action', label: 'Acción', type: 'text' }],
  };

  it('los 20 tipos de la unión tienen display en la tabla', () => {
    // Tripwire de la tabla: `Record<FieldType, …>` ya no compila si falta
    // uno, pero el acceso en runtime pasa por `displayLoader()` con un
    // `string` (un schema puede escribir cualquier cosa), y ahí sólo este
    // test vigila que el string válido no caiga en `undefined`.
    const sinDisplay = SUPPORTED_FIELD_TYPE_LIST.filter((type) => !displayLoader(type));
    expect(sinDisplay).toEqual([]);
  });

  it('un type fuera de la unión degrada a control desconocido, no a pantalla roja', async () => {
    const inventado = { key: 'x', label: 'X', type: 'wat' } as unknown as FieldSchema;
    const nodo = await pintar(inventado, 'valor');
    expect(nodo.querySelector('app-unknown-render'), 'debe pintarse la degradación').not.toBeNull();
    expect(nodo.textContent).toContain('wat');
  });

  describe('vacío', () => {
    // El criterio no cambia: `null`, `undefined` y `''` son vacío; `false`,
    // `0` y `[]` no lo son.
    for (const [nombre, valor] of [
      ['null', null],
      ['undefined', undefined],
      ['cadena vacía', ''],
    ] as const) {
      it(`${nombre} pinta — y no monta componente`, async () => {
        const nodo = await pintar(texto, valor);
        expect(nodo.textContent).toContain('—');
        expect(nodo.querySelector('app-field-display-text')).toBeNull();
      });
    }

    it('false, 0 y [] sí se pintan', async () => {
      expect((await pintar(booleano, false)).textContent).toContain('No');
      expect((await pintar(numero, 0)).textContent).toContain('0');
      expect((await pintar(historial, [])).textContent).toContain('historial');
    });
  });

  describe('texto crudo', () => {
    it('un string sale tal cual', async () => {
      expect((await pintar(texto, 'ORD-42')).textContent).toContain('ORD-42');
    });

    it('un array sale unido por comas (String(raw), como antes)', async () => {
      expect((await pintar(texto, ['a', 'b'])).textContent).toContain('a,b');
    });

    it('un objeto sale [object Object] (degradación heredada)', async () => {
      expect((await pintar(texto, { a: 1 })).textContent).toContain('[object Object]');
    });
  });

  it('date: es-PE, medium y UTC', async () => {
    const nodo = await pintar(fecha, '2026-10-10');
    // El mismo formato que usaba `formatValue`: sin UTC se correría un día.
    expect(nodo.textContent).toContain('10 oct. 2026');
  });

  it('date no parseable se pinta crudo', async () => {
    expect((await pintar(fecha, 'no-es-fecha')).textContent).toContain('no-es-fecha');
  });

  it('number y currency comparten formato es-PE', async () => {
    expect((await pintar(numero, 1234567.5)).textContent).toContain('1,234,567.5');
    expect((await pintar(moneda, 1234567.5)).textContent).toContain('1,234,567.5');
  });

  it('number no numérico se pinta crudo', async () => {
    expect((await pintar(numero, 'muchos')).textContent).toContain('muchos');
  });

  describe('boolean', () => {
    it('true → «Sí» en success', async () => {
      const nodo = await pintar(booleano, true);
      expect(nodo.textContent).toContain('Sí');
      expect(nodo.querySelector('app-badge')?.className).toContain('bg-success');
    });

    it('false → «No» en neutral', async () => {
      const nodo = await pintar(booleano, false);
      expect(nodo.textContent).toContain('No');
      expect(nodo.querySelector('app-badge')?.className).toContain('bg-neutral');
    });
  });

  describe('select', () => {
    it('el valor se traduce a la etiqueta de la opción', async () => {
      const nodo = await pintar(estado, 'PENDIENTE');
      expect(nodo.textContent).toContain('Pendiente');
      expect(nodo.querySelector('app-badge')?.className).toContain('bg-accent/20');
    });

    it('un valor sin opción se pinta crudo con su clase de estado', async () => {
      const nodo = await pintar(estado, 'DESCONOCIDO');
      expect(nodo.textContent).toContain('DESCONOCIDO');
      expect(nodo.querySelector('app-badge')?.className).toContain('bg-neutral');
    });

    it('ENTREGADO sigue siendo success (vocabulario heredado)', async () => {
      const nodo = await pintar(estado, 'ENTREGADO');
      expect(nodo.textContent).toContain('Entregado');
      expect(nodo.querySelector('app-badge')?.className).toContain('bg-success');
    });
  });

  it('image: miniatura enlazada con alt de la etiqueta', async () => {
    const nodo = await pintar(imagen, 'https://x.test/a.png');
    const img = nodo.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://x.test/a.png');
    expect(img?.getAttribute('alt')).toBe('Foto');
    expect(nodo.querySelector('a')?.getAttribute('href')).toBe('https://x.test/a.png');
  });

  it('list: timeline con acción, fecha y detalle', async () => {
    const nodo = await pintar(historial, [
      { action: 'PEDIDO_CREADO', at: '2026-10-10T15:30:00Z', detail: 'Pedido registrado' },
    ]);
    expect(nodo.textContent).toContain('PEDIDO CREADO');
    expect(nodo.textContent).toContain('Pedido registrado');
    expect(nodo.textContent).toContain('10 oct. 2026');
  });

  it('list vacío sigue diciendo que no hay registros', async () => {
    expect((await pintar(historial, [])).textContent).toContain(
      'No hay registros en el historial.',
    );
  });

  describe('chip de cabecera', () => {
    it('un texto con chip sale como badge', async () => {
      const nodo = await pintar(texto, 'ORD-42', true);
      expect(nodo.querySelector('app-badge')?.textContent?.trim()).toBe('ORD-42');
    });

    it('una fecha con chip sale como badge con la fecha formateada', async () => {
      const nodo = await pintar(fecha, '2026-10-10', true);
      expect(nodo.querySelector('app-badge')?.textContent?.trim()).toBe('10 oct. 2026');
    });

    it('una lista con chip resume en «N elementos»', async () => {
      const nodo = await pintar(historial, [{ action: 'X' }], true);
      expect(nodo.querySelector('app-badge')?.textContent?.trim()).toBe('1 elementos');
    });

    it('un select con chip conserva la clase de estado', async () => {
      const nodo = await pintar(estado, 'PENDIENTE', true);
      expect(nodo.querySelector('app-badge')?.className).toContain('bg-accent/20');
    });
  });
});
