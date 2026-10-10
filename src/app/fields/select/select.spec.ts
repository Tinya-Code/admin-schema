import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, signal } from '@angular/core';
import { form } from '@angular/forms/signals';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import type { SelectField } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import type { RootTree } from '../field-node';
import { FieldSelect } from './select';

/** Filas mínimas de `categories` (keyField `slug`, titleField `name`). */
const FILAS = [
  { slug: 'bebidas', name: 'Bebidas' },
  { slug: 'pan', name: 'Pan' },
];

describe('Campo select', () => {
  const listSpy = vi.fn();

  beforeEach(async () => {
    listSpy.mockReset();
    listSpy.mockImplementation(() => of(FILAS.map((fila) => ({ ...fila }))));
    await TestBed.configureTestingModule({
      imports: [FieldSelect],
      providers: [{ provide: ApiService, useValue: { list: listSpy } }],
    }).compileComponents();
  });

  async function create(field: SelectField) {
    const fixture = TestBed.createComponent(FieldSelect);
    // La semilla lleva la clave del campo: `childTree` exige que exista en
    // el árbol (igual que en el formulario real, donde está en el schema).
    const model = signal<Record<string, unknown>>({ [field.key]: '' });
    // `form()` inyecta en el arranque: fuera de un contexto hay que pasarle
    // el injector, igual que hace form-view.
    const tree = form(model, () => {}, {
      injector: TestBed.inject(EnvironmentInjector),
    }) as unknown as RootTree;
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('tree', tree);
    fixture.detectChanges();
    return { fixture };
  }

  const labels = (fixture: { nativeElement: HTMLElement }): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('option')).map(
      (option) => option.textContent?.trim() ?? '',
    );

  const CON_SOURCE: SelectField = {
    type: 'select',
    key: 'category_slug',
    label: 'Categoría',
    source: { resource: 'categories', valueField: 'slug', labelField: 'name' },
  };

  it('las opciones estáticas se pintan sin pedir nada a la red', async () => {
    const { fixture } = await create({
      type: 'select',
      key: 'estado',
      label: 'Estado',
      options: [
        { value: 'pendiente', label: 'Pendiente' },
        { value: 'ok', label: 'OK' },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(labels(fixture)).toEqual(['— Seleccionar —', 'Pendiente', 'OK']);
    // Sin `source` el resource queda idle: no hay vuelta que esperar (D62).
    expect(listSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('con source pide las filas y las mapea con la regla de la relación', async () => {
    const { fixture } = await create(CON_SOURCE);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(labels(fixture)).toEqual(['— Seleccionar —', 'Bebidas', 'Pan']);
  });

  it('mientras la vuelta no llega se anuncia la carga (no un dropdown vacío)', async () => {
    const { fixture } = await create(CON_SOURCE);
    const aviso = fixture.nativeElement.querySelector('[role="status"]');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('Cargando opciones…');
  });

  it('un fallo de carga se anuncia con role=alert y no inventa opciones', async () => {
    listSpy.mockImplementation(() => throwError(() => new Error('503')));
    const { fixture } = await create(CON_SOURCE);
    await fixture.whenStable();
    fixture.detectChanges();

    const aviso = fixture.nativeElement.querySelector('[role="alert"]');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('No se pudieron cargar las opciones.');
    expect(labels(fixture)).toEqual(['— Seleccionar —']);
  });
});
