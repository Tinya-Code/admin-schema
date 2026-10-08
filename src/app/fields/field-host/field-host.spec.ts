import { Component, EnvironmentInjector, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { form } from '@angular/forms/signals';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import type { FieldSchema, ResourceSchema } from '../../core/models/schema.model';
import type { ApiService } from '../../core/services/api.service';
import { seedModel } from '../../pages/form-view/form-model';
import { buildFormSchema } from '../../pages/form-view/form-schema';
import { childTree, type RootTree } from '../field-node';
import { UnknownRender } from '../unknown-render/unknown-render';
import { FieldHost } from './field-host';

/**
 * R1.10 — degradación controlada de un tipo de campo sin renderizador.
 *
 * El `@switch` del host NO tiene `@default`, así que un `type` fuera del
 * catálogo no revienta el template: no dibuja nada. Eso cumple «nunca
 * pantalla rota», pero deja un hueco mudo donde el operador no distingue
 * «me falta un campo» de «lo escribí mal». El aviso existe sólo en dev
 * (`isDevMode`); en producción se omite y queda un `console.warn`.
 *
 * **Por qué el cast:** `FieldSchema.type` es unión, así que `tsc` no deja
 * declarar un tipo desconocido — eso lo garantiza el tripwire de R1.7. Este
 * test simula el estado en runtime que el compilador impide llegar a
 * producción (schema versionado a mano, instancia con un registro viejo,
 * `record` de un repo de schemas externo), que es exactamente lo que la
 * degradación tiene que tolerar.
 */
@Component({
  template: ` <app-field-host [field]="field()" [tree]="tree()" /> `,
  imports: [FieldHost],
})
class Host {
  readonly field = input.required<FieldSchema>();
  readonly tree = input.required<RootTree>();
}

describe('FieldHost — tipo de campo sin renderizador', () => {
  const API = { list: () => of([]) } as unknown as ApiService;

  /** Árbol real, con las mismas reglas que usa `FormView` (para `hidden`). */
  function treeFor(schema: ResourceSchema): RootTree {
    const model = signal(seedModel(schema));
    return form(model, buildFormSchema(schema, API), {
      injector: TestBed.inject(EnvironmentInjector),
    }) as unknown as RootTree;
  }

  function schemaWith(field: Partial<FieldSchema>): ResourceSchema {
    return {
      id: '__unknown__',
      label: 'Prueba',
      labelPlural: 'Pruebas',
      kind: 'collection',
      endpoint: { list: '/admin/__unknown__' },
      keyField: 'marca',
      titleField: 'marca',
      listColumns: [],
      fields: [{ key: 'marca', type: 'text', label: 'Marca' }, { ...field } as FieldSchema],
    } as ResourceSchema;
  }

  async function render(field: Partial<FieldSchema>, schema?: ResourceSchema) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const s = schema ?? schemaWith(field);
    const fixture = TestBed.createComponent(Host);
    fixture.componentRef.setInput('field', field as FieldSchema);
    fixture.componentRef.setInput('tree', treeFor(s));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const desconocido = { key: 'gorro', type: 'sombrero', label: 'Talla' } as unknown as FieldSchema;

  it('un tipo fuera del catálogo dibuja el aviso en vez de dejar un hueco', async () => {
    const fixture = await render(desconocido, schemaWith(desconocido));

    const aviso = fixture.debugElement.query(By.directive(UnknownRender));
    expect(aviso, 'debería renderizar app-unknown-render').not.toBeNull();
    expect(aviso.nativeElement.textContent).toContain('sombrero');
    expect(aviso.nativeElement.textContent).toContain('Talla');

    // Y no intenta dibujar un control que no sabe armar.
    expect(fixture.nativeElement.querySelector('input, textarea, select')).toBeNull();
  });

  it('un tipo del catálogo NO muestra el aviso', async () => {
    const fixture = await render({ key: 'gorro', type: 'text', label: 'Gorro' });

    expect(fixture.debugElement.query(By.directive(UnknownRender))).toBeNull();
    expect(fixture.nativeElement.querySelector('input')).not.toBeNull();
  });

  it('un campo oculto (tipo soportado) cae en el mismo @else pero NO avisa', async () => {
    // La rama `@else` del host cubre DOS motivos: «fuera de catálogo» y
    // «oculto por hiddenOn». Sin el chequeo `unsupported()`, un campo
    // legítimamente oculto expondría un aviso ruidoso.
    //
    // (La recíproca —un tipo desconocido Y oculto— no es alcanzable: al
    // siembrarse `undefined` no tiene nodo, así que tampoco tiene regla de
    // `hidden`; lo cubre el docblock de `unsupported`.)
    const oculto = {
      key: 'gorro',
      type: 'text',
      label: 'Talla',
      hiddenOn: 'always',
    } as FieldSchema;

    const fixture = await render(oculto, schemaWith(oculto));
    expect(fixture.debugElement.query(By.directive(UnknownRender))).toBeNull();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
  });
});
