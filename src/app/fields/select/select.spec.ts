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

  /** Texto visible de cada opción: `<option>` en dropdown, `<label>` en radio. */
  const radioLabels = (fixture: { nativeElement: HTMLElement }): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid="select-radios"] > label')).map(
      (label) => label.textContent?.trim() ?? '',
    );

  const radios = (fixture: { nativeElement: HTMLElement }): HTMLInputElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('input[type="radio"]'));

  const CON_SOURCE: SelectField = {
    type: 'select',
    key: 'category_slug',
    label: 'Categoría',
    source: { resource: 'categories', valueField: 'slug', labelField: 'name' },
  };

  it('2–4 opciones estáticas se pintan como radios (guía §1) sin tocar la red', async () => {
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

    expect(radioLabels(fixture)).toEqual(['— Seleccionar —', 'Pendiente', 'OK']);
    // Opcional ⇒ opción vacía para poder deseleccionar (como el `''` del
    // `<select>` anterior); todos comparten el `name` que setea FormField.
    expect(radios(fixture)).toHaveLength(3);
    const group = fixture.nativeElement.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('Estado');
    // Sin `source` el resource queda idle: no hay vuelta que esperar (D62).
    expect(listSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('un select requerido en modo radio no ofrece la opción vacía', async () => {
    const { fixture } = await create({
      type: 'select',
      key: 'estado',
      label: 'Estado',
      required: true,
      options: [
        { value: 'pendiente', label: 'Pendiente' },
        { value: 'ok', label: 'OK' },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(radioLabels(fixture)).toEqual(['Pendiente', 'OK']);
    expect(radios(fixture)).toHaveLength(2);
  });

  it('con más de 4 opciones sigue siendo dropdown, no radio', async () => {
    const { fixture } = await create({
      type: 'select',
      key: 'estado',
      label: 'Estado',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
        { value: 'd', label: 'D' },
        { value: 'e', label: 'E' },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="select-radios"]')).toBeNull();
    expect(labels(fixture).length).toBe(6); // vacío + 5
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
