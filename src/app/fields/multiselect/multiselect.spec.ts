import { Component, EnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type FieldTree, FormField, form } from '@angular/forms/signals';
import { of } from 'rxjs';
import { vi } from 'vitest';

import type { MultiselectField } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { childTree, type RootTree } from '../field-node';
import { FieldMultiselect } from './multiselect';

const FILAS = [
  { slug: 'bebidas', name: 'Bebidas' },
  { slug: 'pan', name: 'Pan' },
];

/**
 * El anfitrión escrito a mano es obligatorio (D27): `model()` de `value`
 * sólo se inicializa si el binding `[formField]` está en el HTML de una
 * plantilla compilada — igual que en `render-host`.
 */
@Component({
  template: `<app-field-multiselect [field]="field" [formField]="node" [tree]="tree" />`,
  imports: [FieldMultiselect, FormField],
})
class Host {
  field!: MultiselectField;
  node!: FieldTree<string[]>;
  tree!: RootTree;
}

describe('Campo multiselect', () => {
  const listSpy = vi.fn((endpoint?: unknown, payload?: unknown) => of([...FILAS]));

  beforeEach(async () => {
    listSpy.mockReset();
    listSpy.mockImplementation(() => of(FILAS.map((fila) => ({ ...fila }))));
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: ApiService, useValue: { list: listSpy } }],
    }).compileComponents();
  });

  async function create(field: MultiselectField, extra: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(Host);
    const model = signal<Record<string, unknown>>({ [field.key]: [], ...extra });
    const tree = form(model, () => {}, {
      injector: TestBed.inject(EnvironmentInjector),
    }) as unknown as RootTree;
    fixture.componentInstance.field = field;
    fixture.componentInstance.tree = tree;
    fixture.componentInstance.node = childTree<string[]>(tree, field.key);
    fixture.detectChanges();
    return { fixture, model };
  }

  const botones = (fixture: { nativeElement: HTMLElement }): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).map(
      (button) => button.textContent?.trim() ?? '',
    );

  it('con source pide las filas y pinta una opción por fila', async () => {
    const { fixture } = await create({
      type: 'multiselect',
      key: 'tags',
      label: 'Etiquetas',
      source: { resource: 'categories', valueField: 'slug', labelField: 'name' },
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(botones(fixture)).toEqual(['Bebidas', 'Pan']);
  });

  it('las opciones estáticas no piden nada a la red', async () => {
    const { fixture } = await create({
      type: 'multiselect',
      key: 'tags',
      label: 'Etiquetas',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(listSpy).not.toHaveBeenCalled();
    expect(botones(fixture)).toEqual(['A', 'B']);
  });

  it('source.params se resuelven con el registro del formulario (`tree`)', async () => {
    // Sin `tree` el multiselect no podría resolver `{lang}` y mandaría la
    // plantilla cruda: sería la única regla distinta del select (F8).
    const { fixture, model } = await create(
      {
        type: 'multiselect',
        key: 'tags',
        label: 'Etiquetas',
        source: { resource: 'categories', params: { orden: '{lang}' } },
      },
      { lang: 'es' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(listSpy.mock.calls[0][1]).toEqual({ params: { orden: 'es' } });

    model.set({ tags: [], lang: 'en' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(listSpy.mock.calls[1][1]).toEqual({ params: { orden: 'en' } });
  });

  it('un fallo de carga se anuncia y no pinta opciones', async () => {
    listSpy.mockImplementation(() => {
      throw new Error('503');
    });
    const { fixture } = await create({
      type: 'multiselect',
      key: 'tags',
      label: 'Etiquetas',
      source: { resource: 'categories' },
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const aviso = fixture.nativeElement.querySelector('[role="alert"]');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('No se pudieron cargar las opciones.');
    expect(botones(fixture)).toEqual([]);
  });
});
