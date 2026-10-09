import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListColumn } from '../core/models/schema.model';
import { RenderHost } from '../core/registry/render-host';
import { COLUMN_FORMAT_TYPES } from './descriptors';
import type { ColumnCell } from './column-cell';

/**
 * Los 7 formatos de columna (R4.3 · `kind: 'column-format'`).
 *
 * Cada caso es un `@case` del `@switch` que vivía en `list-view`: si el
 * formato pinta distinto de lo que pintaba allí, este test se pone rojo. Se
 * monta por `RenderHost` y no por el componente suelto para cubrir también
 * la resolución del registro (descriptor, `inputs`, degradación).
 */
@Component({
  selector: 'spec-column-host',
  imports: [RenderHost],
  template: `
    <app-render-host kind="column-format" [type]="formato()" [config]="column()" [data]="cell()" />
  `,
})
class Host {
  readonly formato = input.required<string>();
  readonly column = input.required<ListColumn>();
  readonly cell = input.required<ColumnCell>();
}

describe('R4.3 — formatos de columna registrados', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  /**
   * Monta el host y espera el `load()` perezoso del formato.
   *
   * `whenStable()` no cubre el `import()` dinámico por sí solo, así que se
   * espera acotadamente mientras quede `<app-skeleton>`; si el formato nunca
   * monta, la espera se agota y falla la aserción del test.
   */
  async function pintar(column: ListColumn, cell: Partial<ColumnCell> = {}): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(Host);
    fixture.componentRef.setInput('formato', column.format ?? 'text');
    fixture.componentRef.setInput('column', column);
    fixture.componentRef.setInput('cell', celda({ column, ...cell }));
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

  /** Texto de la celda con los espacios duros de `Intl` normalizados. */
  function texto(nodo: HTMLElement): string {
    return (nodo.textContent ?? '').replace(/\u00a0/g, ' ');
  }

  /** Celda mínima; cada caso sobreescribe lo que necesita. */
  function celda(parcial: { column: ListColumn } & Partial<ColumnCell>): ColumnCell {
    return {
      row: {},
      fields: [],
      title: 'Una fila',
      canUpdate: false,
      saving: false,
      currency: 'PEN',
      ...parcial,
    };
  }

  it('los 7 formatos de la unión están registrados', () => {
    // `ListColumnFormat` vive en tipos y el manifiesto en runtime: sólo un
    // test reconcilia los dos (mismo tripwire que campos y widgets).
    expect(COLUMN_FORMAT_TYPES.length).toBe(7);
  });

  describe('text', () => {
    const col: ListColumn = { key: 'nombre', label: 'Nombre', format: 'text' };

    it('pinta el valor crudo', async () => {
      const nodo = await pintar(col, { row: { nombre: 'ORD-42' } });
      expect(nodo.textContent).toContain('ORD-42');
    });

    it('null y undefined salen vacíos', async () => {
      expect((await pintar(col, { row: { nombre: null } })).textContent?.trim()).toBe('');
      expect((await pintar(col, { row: {} })).textContent?.trim()).toBe('');
    });

    it('un objeto sale [object Object] (degradación heredada)', async () => {
      const nodo = await pintar(col, { row: { nombre: { a: 1 } } });
      expect(nodo.textContent).toContain('[object Object]');
    });
  });

  describe('number', () => {
    const col: ListColumn = { key: 'stock', label: 'Stock', format: 'number' };

    it('agrupa con separador es-PE', async () => {
      const nodo = await pintar(col, { row: { stock: 1234567.5 } });
      expect(nodo.textContent).toContain('1,234,567.5');
    });

    it('no numérico sale crudo y null sigue saliendo «0»', async () => {
      expect((await pintar(col, { row: { stock: 'varios' } })).textContent).toContain('varios');
      // Quirk heredado de `formatNumber`: `Number(null)` es 0 y por eso la
      // lista ya mostraba «0» en vez de vacío. Se conserva — cambiarlo es
      // otra decisión, no este registro.
      expect((await pintar(col, { row: { stock: null } })).textContent?.trim()).toBe('0');
    });
  });

  describe('currency', () => {
    const col: ListColumn = { key: 'price', label: 'Precio', format: 'currency' };

    it('usa la moneda que entrega la vista', async () => {
      const nodo = await pintar(col, { row: { price: 1234.5 } });
      // `Intl` separa el símbolo con espacio duro (U+00A0): se normaliza para
      // que el aserto no dependa de ese byte.
      expect(texto(nodo)).toContain('S/ 1,234.50');
    });

    it('cambia de moneda con la celda', async () => {
      const nodo = await pintar(col, { row: { price: 1234.5 }, currency: 'USD' });
      expect(texto(nodo)).toContain('USD 1,234.50');
    });
  });

  describe('date', () => {
    const col: ListColumn = { key: 'fecha', label: 'Fecha', format: 'date' };

    it('formato corto es-PE en UTC', async () => {
      const nodo = await pintar(col, { row: { fecha: '2026-12-25' } });
      expect(nodo.textContent).toContain('25/12/2026');
    });

    it('no parseable sale crudo', async () => {
      expect((await pintar(col, { row: { fecha: 'ayer' } })).textContent).toContain('ayer');
    });
  });

  describe('badge', () => {
    const col: ListColumn = { key: 'status', label: 'Estado', format: 'badge' };

    it('clasifica el estado como el display del detalle (D41)', async () => {
      // `warning` se pinta como `accent` (bg-accent/20 + text-accent-text).
      const pendiente = await pintar(col, { row: { status: 'PENDIENTE' } });
      expect(pendiente.querySelector('app-badge')?.className).toContain('bg-accent/20');

      const entregado = await pintar(col, { row: { status: 'ENTREGADO' } });
      expect(entregado.querySelector('app-badge')?.className).toContain('bg-success');

      const cancelado = await pintar(col, { row: { status: 'Cancelado' } });
      expect(cancelado.querySelector('app-badge')?.className).toContain('bg-danger');

      const otro = await pintar(col, { row: { status: 'Vigente' } });
      expect(otro.querySelector('app-badge')?.className).toContain('bg-neutral');
    });

    it('un select pinta la etiqueta de la opción, no el valor crudo', async () => {
      const nodo = await pintar(col, {
        row: { status: 'preparacion' },
        fields: [
          {
            key: 'status',
            label: 'Estado',
            type: 'select',
            options: [
              { value: 'preparacion', label: 'En preparación' },
              { value: 'entregado', label: 'Entregado' },
            ],
          },
        ],
      });
      expect(nodo.textContent).toContain('En preparación');
    });

    it('el vacío sale «Sin dato» en danger', async () => {
      const nodo = await pintar(col, { row: { status: '' } });
      expect(nodo.textContent).toContain('Sin dato');
      expect(nodo.querySelector('app-badge')?.className).toContain('bg-danger');
    });

    it('un booleano usa trueLabel/falseLabel del campo', async () => {
      const nodo = await pintar(col, {
        row: { status: true },
        fields: [{ key: 'status', label: 'Estado', type: 'boolean', trueLabel: 'Vigente' }],
      });
      expect(nodo.textContent).toContain('Vigente');
      expect(nodo.querySelector('app-badge')?.className).toContain('bg-success');
    });
  });

  describe('boolean', () => {
    const col: ListColumn = { key: 'active', label: 'Activo', format: 'boolean' };
    const booleano = { key: 'active', label: 'Activo', type: 'boolean' as const };

    it('con permiso y campo booleano dibuja el interruptor', async () => {
      const nodo = await pintar(col, {
        row: { active: true },
        fields: [booleano],
        canUpdate: true,
      });
      const box = nodo.querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(box, 'debe dibujarse el interruptor').not.toBeNull();
      expect(box?.checked).toBe(true);
      expect(box?.getAttribute('aria-label')).toBe('Activo: Una fila');
    });

    it('sin permiso cae al badge', async () => {
      const nodo = await pintar(col, { row: { active: true }, fields: [booleano] });
      expect(nodo.querySelector('input[type="checkbox"]')).toBeNull();
      expect(nodo.textContent).toContain('Sí');
    });

    it('mientras la fila guarda, el interruptor queda bloqueado', async () => {
      const nodo = await pintar(col, {
        row: { active: false },
        fields: [booleano],
        canUpdate: true,
        saving: true,
      });
      const box = nodo.querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(box?.disabled, 'mientras guarda, la fila está bloqueada').toBe(true);
    });

    it('al alternar escribe por la celda', async () => {
      const toggle = vi.fn();
      const nodo = await pintar(col, {
        row: { active: false },
        fields: [booleano],
        canUpdate: true,
        toggle,
      });
      nodo.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
      expect(toggle).toHaveBeenCalledWith(true);
    });
  });

  describe('thumbnail', () => {
    const col: ListColumn = { key: 'image_url', label: 'Imagen', format: 'thumbnail' };

    it('pinta la imagen con su alt', async () => {
      const nodo = await pintar(col, { row: { image_url: 'https://x.test/a.png' } });
      const img = nodo.querySelector('img');
      expect(img?.getAttribute('src')).toBe('https://x.test/a.png');
      expect(img?.getAttribute('alt')).toBe('');
    });

    it('toma el primer item de images[] con su image_alt', async () => {
      const nodo = await pintar(
        { key: 'images', label: 'Imágenes', format: 'thumbnail' },
        { row: { images: [{ image_url: 'https://x.test/b.png', image_alt: 'Frente' }] } },
      );
      expect(nodo.querySelector('img')?.getAttribute('src')).toBe('https://x.test/b.png');
      expect(nodo.querySelector('img')?.getAttribute('alt')).toBe('Frente');
    });

    it('sin URL pinta el guion', async () => {
      const nodo = await pintar(col, { row: { image_url: '' } });
      expect(nodo.textContent).toContain('—');
      expect(nodo.querySelector('img')).toBeNull();
    });
  });
});
