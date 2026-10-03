import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ApiService } from '../core/services/api.service';
import { REMOTE_SCHEMA_RESPONSE } from '../schemas/__fixtures__/remote-schema';
import { getSchema, setRemoteSchema } from '../schemas/registry';
import { parseSchemaResponse } from '../schemas/schema-merge';
import { FormView } from './form-view/form-view';
import { ListView } from './list-view/list-view';

/**
 * Evidencia F7-4: `_prueba` NO existe en `src/app/schemas/*.schema.ts` — su
 * schema llega exclusivamente del fixture congelado de `/admin/schema`. Si
 * estos dos tests renderizan, la UI quedó 100% dirigida por el esquema.
 */
describe('Recurso sólo-remoto `_prueba`: listado y formulario', () => {
  const apiStub = {
    list: () => of([{ slug: 'hola-mundo', name: 'Prueba 1', active: true }]),
    get: () => of({}),
    create: () => of({}),
    update: () => of({}),
    remove: () => of(undefined),
    request: () => of([]),
  };

  beforeAll(() => {
    setRemoteSchema(parseSchemaResponse(REMOTE_SCHEMA_RESPONSE));
  });

  afterAll(() => setRemoteSchema(null));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ListView, FormView],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: apiStub },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: '_prueba' })) },
        },
      ],
    }).compileComponents();
  });

  it('el listado se dibuja con las columnas sintetizadas del shape.pick', async () => {
    const schema = getSchema('_prueba');
    expect(schema).toBeDefined();

    const fixture = TestBed.createComponent(ListView);
    fixture.componentRef.setInput('schema', schema!);
    await fixture.whenStable();
    fixture.detectChanges();

    const headers = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('thead th'),
    ).map((th) => th.textContent?.trim());
    // listColumns = operations.list.shape.pick, humanizados; sin declaración
    // de permisos ⇒ hay acciones; sin ordering ⇒ sin columna de orden
    expect(headers).toEqual(['Slug', 'Name', 'Active', 'Acciones']);

    // label singular sintetizado en el CTA de alta
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Crear Prueba');
    // la fila del stub aparece
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('hola-mundo');
  });

  it('el formulario se dibuja con los campos sintetizados (sin layout)', async () => {
    const fixture = TestBed.createComponent(FormView);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // modo create (sin `key` en la ruta) ⇒ listo sin leer registro
    expect(el.querySelector('h1')?.textContent).toContain('Nueva Prueba');
    const labels = Array.from(el.querySelectorAll('label'))
      .map((label) => label.textContent?.trim() ?? '')
      // el FieldHost agrega `*` a los requeridos (`_prueba` los declara)
      .map((label) => label.replace(/\s*\*$/, ''));
    expect(labels).toEqual(expect.arrayContaining(['Slug', 'Name', 'Active']));
    // sin layout ⇒ secciones vacías, campos todos visibles
    expect(el.querySelector('app-empty-state')).toBeNull();
    expect(el.querySelector('form')).not.toBeNull();
  });
});
