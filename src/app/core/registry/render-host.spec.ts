import { Component, EnvironmentInjector, input, signal, type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { form } from '@angular/forms/signals';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import type { FieldSchema, ResourceSchema } from '../models/schema.model';
import type { ApiService } from '../services/api.service';
import { API_URL } from '../tokens';
import { buildFormSchema } from '../../pages/form-view/form-schema';
import { seedModel } from '../../pages/form-view/form-model';
import type { RootTree } from '../../fields/field-node';
import { UnknownRender } from '../../fields/unknown-render/unknown-render';
import { RenderHost, type RenderContext } from './render-host';
import { get, isSupported, resolve } from './render-registry';

/**
 * R3.4 — «hecho cuando: renderiza los 20 tipos».
 *
 * Cada caso comprueba dos cosas distintas y ninguna es cosmética:
 *
 *  1. el registro **resuelve** el `(field, type)` a su componente, y
 *  2. `RenderHost` lo **monta** — se lee `NgComponentOutlet.componentInstance`
 *     en vez de un `By.directive` con la clase, así el test no importa los 20
 *     controles a mano y no re-crea la lista que el registro vino a eliminar.
 *
 * El envoltorio (label, marcas, error) se verifica aparte: un host que
 * montara el control pero perdiera el rótulo seguiría rompiendo el formulario.
 */
@Component({
  template: `<app-render-host [type]="type()" [config]="config()" [ctx]="ctx()" />`,
  imports: [RenderHost],
})
class Host {
  readonly type = input.required<string>();
  readonly config = input.required<FieldSchema>();
  readonly ctx = input.required<RenderContext>();
}

describe('RenderHost — los 21 tipos', () => {
  const API = { list: () => of([]) } as unknown as ApiService;

  const TIPOS = [
    'text',
    'textarea',
    'slug',
    'number',
    'currency',
    'boolean',
    'select',
    'multiselect',
    'url',
    'email',
    'phone',
    'date',
    'time',
    'readonly-text',
    'group',
    'list',
    'string-list',
    'key-value',
    'relation',
    'image',
    'file',
  ] as const;

  /** Campos compuestos y con opciones mínimas para que el schema arranque. */
  function campo(type: (typeof TIPOS)[number]): FieldSchema {
    const base: Record<string, unknown> = { key: 'campo', label: 'Campo' };

    if (type === 'group') {
      base['fields'] = [];
    }
    // `ListField` guarda sus hijos en `itemFields` — no en `fields`.
    if (type === 'list') {
      base['itemFields'] = [];
    }
    if (type === 'select' || type === 'multiselect') {
      base['options'] = [];
    }
    if (type === 'relation') {
      base['relation'] = { resource: 'pedidos' };
    }
    // `slug` deriva su valor de otro campo: `from` es obligatorio y apunta a
    // un hermano real (si no, `childTree` lanza «El formulario no contiene el
    // campo» con `undefined`).
    if (type === 'slug') {
      base['from'] = 'origen';
    }

    return { ...base, type } as unknown as FieldSchema;
  }

  function schemaFor(field: FieldSchema): ResourceSchema {
    const hermanos: FieldSchema[] =
      field.type === 'slug'
        ? [{ key: 'origen', type: 'text', label: 'Origen' } as FieldSchema]
        : [];

    return {
      id: '__render__',
      label: 'Render',
      labelPlural: 'Renders',
      kind: 'collection',
      endpoint: { list: '/admin/__render__' },
      keyField: 'campo',
      titleField: 'campo',
      listColumns: [],
      fields: [...hermanos, field],
    } as ResourceSchema;
  }

  function treeFor(schema: ResourceSchema): RootTree {
    const model = signal(seedModel(schema));
    return form(model, buildFormSchema(schema, API), {
      injector: TestBed.inject(EnvironmentInjector),
    }) as unknown as RootTree;
  }

  /**
   * El árbol se construye SIEMPRE dentro de `render`: `treeFor` inyecta el
   * `EnvironmentInjector` y una inyección temprana deja el `TestBed`
   * instanciado, con lo que el `configureTestingModule` posterior falla.
   */
  async function render(field: FieldSchema) {
    await TestBed.configureTestingModule({
      imports: [Host],
      // `relation` e `image` inyectan servicios que a su vez piden la URL.
      providers: [{ provide: API_URL, useValue: '/api' }],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.componentRef.setInput('type', field.type);
    fixture.componentRef.setInput('config', field);
    fixture.componentRef.setInput('ctx', {
      tree: treeFor(schemaFor(field)),
      serverErrors: {},
      pathPrefix: '',
      exists: false,
      resource: '__render__',
    } satisfies RenderContext);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /**
   * Espera a que el `load()` perezoso monte el control.
   *
   * `whenStable()` no cubre acá: el `import()` del descriptor es una promesa
   * ajena al rastreo de Angular, así que se esperaría en vano y el test
   * fallaría por no haber mirado todavía. Está acotada — si el componente
   * nunca monta, el fallo es del componente, no del test.
   */
  async function controlDe(fixture: ComponentFixture<Host>, esperado: Type<unknown>) {
    for (let intento = 0; intento < 100; intento++) {
      fixture.detectChanges();
      // Se busca por la clase del componente y no por `NgComponentOutlet`:
      // el outlet vive en un `<ng-container>`, que `By.directive` no desciende.
      const nodo = fixture.debugElement.query(By.directive(esperado));
      if (nodo) return nodo;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    return null;
  }

  for (const type of TIPOS) {
    it(`monta el componente de «${type}»`, async () => {
      const field = campo(type);
      const esperado = (await resolve('field', type, UnknownRender)) as Type<unknown>;
      const fixture = await render(field);
      const nodo = await controlDe(fixture, esperado);

      // `By.directive(clase)` ya es la prueba: sólo casa si esa clase renderizó.
      expect(nodo, `el control de «${type}» no llegó a montarse`).not.toBeNull();
    });
  }

  it('el registro sigue siendo la única fuente de verdad: los 20 están', () => {
    for (const type of TIPOS) {
      expect(isSupported('field', type), `falta el descriptor de «${type}»`).toBe(true);
      expect(get('field', type)?.load, `«${type}» sin load()`).toBeTypeOf('function');
    }
  });

  it('un tipo fuera del catálogo degrada a UnknownRender y no revienta', async () => {
    const field = { key: 'gorro', type: 'sombrero', label: 'Talla' } as unknown as FieldSchema;
    const fixture = await render(field);

    const aviso = fixture.debugElement.query(By.directive(UnknownRender));
    expect(aviso, 'debería renderizar app-unknown-render').not.toBeNull();
    expect(aviso.nativeElement.textContent).toContain('sombrero');
    expect(fixture.nativeElement.querySelector('input, textarea, select')).toBeNull();
  });

  it('conserva el envoltorio: label con el nombre del campo', async () => {
    const field = campo('text');
    const fixture = await render(field);

    const label = fixture.nativeElement.querySelector('label');
    expect(label, 'debería dibujar <label>').not.toBeNull();
    expect(label.textContent).toContain('Campo');
    // El id real lo forma Signal Forms (`a.form21.campo`): importa que termine
    // en el key del campo, no el prefijo del formulario.
    expect(label.getAttribute('for')).toMatch(/\.campo$/);
  });
});
