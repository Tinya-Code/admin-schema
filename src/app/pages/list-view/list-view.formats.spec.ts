import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { API_URL } from '../../core/tokens';
import { ApiService } from '../../core/services/api.service';
import type { ResourceSchema } from '../../core/models/schema.model';
import { ListView } from './list-view';

/** Fila suelta, para no depender del shape de un schema concreto. */
type Row = Record<string, unknown>;

/**
 * Los 7 formatos, pintados por la vista (R4.3).
 *
 * `list-view` dejó de tener `@switch`: cada celda monta un
 * `<app-render-host kind="column-format">` y el registro elige el formato.
 * Este test es la prueba de paridad — la tabla sigue mostrando lo mismo — y
 * de cableado — son 7 hosts los que cuelgan de la fila.
 */
describe('ListView — formatos de columna', () => {
  const schema: ResourceSchema = {
    id: 'demo',
    label: 'Demo',
    labelPlural: 'Demos',
    kind: 'collection',
    endpoint: { list: '/admin/demo' },
    keyField: 'id',
    titleField: 'name',
    listColumns: [
      { key: 'name', label: 'Nombre', format: 'text' },
      { key: 'stock', label: 'Stock', format: 'number' },
      { key: 'price', label: 'Precio', format: 'currency' },
      { key: 'created', label: 'Creado', format: 'date' },
      { key: 'status', label: 'Estado', format: 'badge' },
      { key: 'image_url', label: 'Imagen', format: 'thumbnail' },
      { key: 'active', label: 'Activo', format: 'boolean' },
    ],
    fields: [
      { key: 'name', label: 'Nombre', type: 'text' },
      { key: 'stock', label: 'Stock', type: 'number' },
      { key: 'price', label: 'Precio', type: 'currency' },
      { key: 'created', label: 'Creado', type: 'date' },
      { key: 'status', label: 'Estado', type: 'text' },
      { key: 'image_url', label: 'Imagen', type: 'image' },
      { key: 'active', label: 'Activo', type: 'boolean' },
    ],
  };

  /** Elemento raíz tipado del fixture (el `nativeElement` es `any`). */
  interface DomFixture {
    root: HTMLElement;
    fixture: ComponentFixture<ListView>;
  }

  const fila = {
    id: '1',
    name: 'Teclado',
    stock: 1234,
    price: 1234.5,
    created: '2026-12-25',
    status: 'Activo',
    image_url: 'https://x.test/a.png',
    active: true,
  };

  async function create(
    esquema: ResourceSchema = schema,
    filas: Row[] = [fila],
  ): Promise<DomFixture> {
    await TestBed.configureTestingModule({
      imports: [ListView],
      providers: [
        // Convención de `render-host.spec`: los servicios piden la URL.
        { provide: API_URL, useValue: '/api' },
        provideRouter([]),
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        {
          provide: ApiService,
          useValue: { list: vi.fn(() => of(filas)), get: vi.fn(() => of(filas[0])) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ListView);
    fixture.componentRef.setInput('schema', esquema);
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    // El `load()` de cada formato es un `import()` dinámico: se espera
    // acotadamente a que la fila deje de estar en esqueleto.
    for (let intento = 0; intento < 100 && root.querySelector('app-skeleton'); intento++) {
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    fixture.detectChanges();
    return { root, fixture };
  }

  it('las 7 celda salen del registro y no de un @switch de la vista', async () => {
    const { root } = await create();
    const hosts = Array.from(root.querySelectorAll('tbody app-render-host'));
    expect(hosts.length, 'una celda por columna').toBe(7);
    expect(
      hosts.every((host) => host.getAttribute('kind') === 'column-format'),
      'todas resuelven kind column-format',
    ).toBe(true);
  });

  it('la fila pinta cada formato con su paridad', async () => {
    const { root } = await create();
    const celdas = Array.from(root.querySelectorAll<HTMLElement>('tbody tr td')).map((td) =>
      (td.textContent ?? '').replace(/\u00a0/g, ' '),
    );

    // text · number · currency · date · badge · thumbnail · boolean
    expect(celdas[0]).toContain('Teclado');
    expect(celdas[1]).toContain('1,234');
    expect(celdas[2]).toContain('S/ 1,234.50');
    expect(celdas[3]).toContain('25/12/2026');
    expect(celdas[4]).toContain('Activo');
    expect(celdas[5].trim(), 'la celda de imagen no lleva texto').toBe('');
    expect(celdas[6].trim(), 'la celda booleana sólo lleva el interruptor').toBe('');
  });

  it('la miniatura y el interruptor siguen siendo los de siempre', async () => {
    const { root } = await create();
    const img = root.querySelector('tbody td img');
    expect(img?.getAttribute('src')).toBe('https://x.test/a.png');

    const box = root.querySelector<HTMLInputElement>('tbody td input[type="checkbox"]');
    expect(box, 'el interruptor de active sigue apareciendo').not.toBeNull();
    expect(box?.checked).toBe(true);
    expect(box?.getAttribute('aria-label')).toBe('Activo: Teclado');
  });
  describe('ListView — formato por defecto (R4.4)', () => {
    /** Columnas **sin** `format`: el tipo del campo es lo único que manda. */
    const sinFormato: ResourceSchema = {
      id: 'demo-44',
      label: 'Demo',
      labelPlural: 'Demos',
      kind: 'collection',
      endpoint: { list: '/admin/demo-44' },
      keyField: 'id',
      titleField: 'name',
      listColumns: [
        { key: 'name', label: 'Nombre' },
        { key: 'status', label: 'Estado' },
        { key: 'pickup_date', label: 'Retiro' },
        { key: 'active', label: 'Activo' },
        { key: 'photo', label: 'Foto' },
      ],
      fields: [
        { key: 'name', label: 'Nombre', type: 'slug', from: 'name' },
        {
          key: 'status',
          label: 'Estado',
          type: 'select',
          options: [{ value: 'preparacion', label: 'En preparación' }],
        },
        { key: 'pickup_date', label: 'Retiro', type: 'date' },
        { key: 'active', label: 'Activo', type: 'boolean' },
        { key: 'photo', label: 'Foto', type: 'image' },
      ],
    };

    const fila: Row = {
      id: '1',
      name: 'teclado-mecanico',
      status: 'preparacion',
      pickup_date: '2026-12-25',
      active: true,
      photo: 'https://x.test/p.png',
    };

    it('cada columna sin format pinta el formato que le corresponde por tipo', async () => {
      const { root } = await create(sinFormato, [fila]);
      // Las 5 columnas + la celda de acciones que la vista añade al final.
      const celdas = Array.from(root.querySelectorAll<HTMLElement>('tbody tr td')).slice(0, 5);
      expect(celdas).toHaveLength(5);

      // slug → text: sólo el valor, sin adornos.
      expect(celdas[0].textContent).toContain('teclado-mecanico');
      expect(celdas[0].querySelector('app-badge, input, img')).toBeNull();
      // select → badge: el chip con la etiqueta de la opción.
      expect(celdas[1].querySelector('app-badge')).not.toBeNull();
      // date → date: la fecha ya formateada.
      expect(celdas[2].textContent).toContain('25/12/2026');
      // boolean → boolean: el interruptor de R4.3.
      expect(celdas[3].querySelector('input[type="checkbox"]')).not.toBeNull();
      // image → thumbnail: la miniatura.
      expect(celdas[4].querySelector('img')).not.toBeNull();
    });

    it('el texto se ve como texto y el estado como chip con su etiqueta', async () => {
      const { root } = await create(sinFormato, [fila]);
      const celdas = Array.from(root.querySelectorAll<HTMLElement>('tbody tr td')).map((td) =>
        (td.textContent ?? '').replace(/\u00a0/g, ' '),
      );
      expect(celdas[0]).toContain('teclado-mecanico');
      expect(celdas[1]).toContain('En preparación');
      expect(celdas[2]).toContain('25/12/2026');
      expect(root.querySelector('tbody td img')?.getAttribute('src')).toBe('https://x.test/p.png');
      const box = root.querySelector<HTMLInputElement>('tbody td input[type="checkbox"]');
      expect(box?.checked).toBe(true);
    });
  });
});
