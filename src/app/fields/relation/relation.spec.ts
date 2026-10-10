import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, signal } from '@angular/core';
import { form } from '@angular/forms/signals';
import { of } from 'rxjs';
import { vi } from 'vitest';

import type { RelationField } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { DataSourceService } from '../../core/services/data-source.service';
import { RelationDrawerService } from '../../core/services/relation-drawer.service';
import { type RootTree } from '../field-node';
import { FieldRelation } from './relation';

/** Fila mínima de `categories` (keyField `slug`, titleField `name`). */
function rows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    slug: `cat-${index}`,
    name: `Categoría ${index}`,
    active: index !== 3,
    description: `Descripción ${index}`,
  }));
}

describe('Campo relación', () => {
  const listSpy = vi.fn((...args: unknown[]) => of(rows(9)));

  beforeEach(async () => {
    listSpy.mockClear();
    listSpy.mockImplementation(() => of(rows(9)));
    await TestBed.configureTestingModule({
      imports: [FieldRelation],
      providers: [{ provide: ApiService, useValue: { list: listSpy } }],
    }).compileComponents();
  });

  async function create(field: RelationField, value = '', extra: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(FieldRelation);
    // Un objeto literal no sirve: `childTree` espera un FieldTree real
    // (el nodo es invocable y devuelve el estado del campo).
    const model = signal<Record<string, unknown>>({ category_slug: value, ...extra });
    // `form()` inyecta en el arranque: fuera de un contexto hay que pasarle
    // el injector, igual que hace form-view.
    const tree = form(model, () => {}, {
      injector: TestBed.inject(EnvironmentInjector),
    }) as unknown as RootTree;
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('tree', tree);
    fixture.detectChanges();
    return { fixture, tree, model };
  }

  const categoryField = (): RelationField => ({
    key: 'category_slug',
    label: 'Categoría',
    type: 'relation',
    source: { resource: 'categories' },
  });

  const findButton = (fixture: { nativeElement: HTMLElement }, text: string): HTMLButtonElement => {
    const found = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      b.textContent?.includes(text),
    );
    if (found === undefined) throw new Error(`No se encontró el botón «${text}»`);
    return found;
  };

  const options = (fixture: { nativeElement: HTMLElement }): HTMLOptionElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('option'));

  it('mientras cargan las opciones muestra el skeleton en un nodo labelable', async () => {
    const { fixture } = await create(categoryField());

    const loading = fixture.nativeElement.querySelector('output[aria-busy="true"]');
    expect(loading).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-skeleton')).not.toBeNull();
    expect(loading!.textContent).toContain('Cargando opciones…');
  });

  it('tras cargar, el select trae las opciones del recurso destino', async () => {
    const { fixture } = await create(categoryField());
    await fixture.whenStable();
    fixture.detectChanges();

    // 9 filas + la opción vacía (el campo no es required)
    expect(options(fixture)).toHaveLength(10);
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(options(fixture)[1].textContent?.trim()).toBe('Categoría 0');
    expect(fixture.nativeElement.querySelector('output[aria-busy]')).toBeNull();
  });

  it('secondaryField agrega el dato al lado de la etiqueta', async () => {
    const { fixture } = await create({ ...categoryField(), secondaryField: 'description' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(options(fixture)[1].textContent?.trim()).toBe('Categoría 0 · Descripción 0');
  });

  it('source.params se resuelven del formulario y la fuente recarga al cambiar', async () => {
    // F8 · R6.5: `{lang}` se interpola contra el registro y el resultado
    // entra en la clave de caché — mismo recurso, otra petición.
    const field: RelationField = {
      ...categoryField(),
      source: { resource: 'categories', params: { orden: '{lang}' } },
    };
    const { fixture, model } = await create(field, '', { lang: 'es' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy.mock.calls[0][1]).toEqual({ params: { orden: 'es' } });

    model.set({ category_slug: '', lang: 'en' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(listSpy.mock.calls[1][1]).toEqual({ params: { orden: 'en' } });
    expect(options(fixture)).toHaveLength(10); // sigue habiendo opciones tras la recarga
  });

  it('con más de 7 opciones aparece el buscador y con menos no', async () => {
    const { fixture: withSearch } = await create(categoryField());
    await withSearch.whenStable();
    withSearch.detectChanges();
    expect(withSearch.nativeElement.querySelector('input[type="search"]')).not.toBeNull();

    // El servicio cachea por clave de fuente (30 s): sin invalidar, el segundo
    // formulario heredaría las 9 filas del primero y el umbral no se vería.
    TestBed.inject(DataSourceService).invalidate();
    listSpy.mockImplementation(() => of(rows(4)));
    const { fixture: withoutSearch } = await create(categoryField());
    await withoutSearch.whenStable();
    withoutSearch.detectChanges();
    expect(withoutSearch.nativeElement.querySelector('input[type="search"]')).toBeNull();
  });

  it('filtra y anuncia «Sin resultados» sin borrar la opción elegida', async () => {
    const { fixture } = await create({ ...categoryField(), required: true }, 'cat-1');
    await fixture.whenStable();
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    expect(search).not.toBeNull();

    search.value = 'zzz-no-existe';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    const status = fixture.nativeElement.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Sin resultados para «zzz-no-existe»');
    // Sigue visible aunque la etiqueta no coincida con el término
    expect(options(fixture).map((option) => option.value)).toEqual(['cat-1']);
  });

  describe('botón «Crear nuevo» (plan 6.4)', () => {
    it('pide el panel con el recurso de la relación', async () => {
      const { fixture } = await create(categoryField());
      await fixture.whenStable();
      fixture.detectChanges();
      const drawer = TestBed.inject(RelationDrawerService);

      expect(drawer.request()).toBeNull();

      findButton(fixture, 'Crear nuevo').click();

      expect(drawer.request()?.resource).toBe('categories');
    });

    it('al confirmarse la creación, preselecciona la clave nueva', async () => {
      const { fixture, tree } = await create(categoryField());
      await fixture.whenStable();
      fixture.detectChanges();
      const drawer = TestBed.inject(RelationDrawerService);

      findButton(fixture, 'Crear nuevo').click();
      const requestsBefore = listSpy.mock.calls.length;
      drawer.request()!.onCreated('cat-nueva');

      expect(tree().value()).toEqual({ category_slug: 'cat-nueva' });
      // pide recargar las opciones para que la clave tenga dónde engancharse
      // (`reload()` de la resource encola la petición, no corre en el tick)
      await fixture.whenStable();
      expect(listSpy.mock.calls.length).toBeGreaterThan(requestsBefore);
    });
  });
});
