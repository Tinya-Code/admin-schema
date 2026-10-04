import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeAll, vi } from 'vitest';

import type { ResourceSchema } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { ErrorMapperService } from '../../core/services/error-mapper.service';
import { NotificationService } from '../../core/services/notification.service';
import { UploadService } from '../../core/services/upload.service';
import { FieldHost } from '../../fields/field-host/field-host';
import { schemas } from '../../schemas/registry';
import { FormView } from './form-view';

/**
 * Regresión: la rama `@else` del layout (secciones colapsables en `<details>`,
 * p. ej. `site`) renderizaba `<app-field-host>` SIN `[resource]` — el campo
 * imagen subía con `resource: ''` y el backend respondía 400
 * «Falta resource (p. ej. products)» (upload-signature.js).
 */
describe('FormView — resource hacia field-host', () => {
  async function createSiteForm() {
    await TestBed.configureTestingModule({
      imports: [FormView],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'site' })) },
        },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        {
          provide: ApiService,
          useValue: {
            get: vi.fn(() => of({})),
            create: vi.fn(() => of({})),
            update: vi.fn(() => of({})),
            remove: vi.fn(() => of({})),
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
        {
          provide: ErrorMapperService,
          useValue: { map: vi.fn(() => ({ fields: {} })), messageOf: vi.fn(() => '') },
        },
        { provide: UploadService, useValue: { uploadWithProgress: vi.fn(() => of()) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(FormView);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('pasa el id del recurso a todos los field-host (rama details incluida)', async () => {
    const fixture = await createSiteForm();

    // La rama problemática es la de secciones colapsables: si no renderiza,
    // el test no estaría cubriendo el fix.
    expect(fixture.nativeElement.querySelector('details')).not.toBeNull();

    const hosts = fixture.debugElement.queryAll(By.directive(FieldHost));
    expect(hosts.length).toBeGreaterThan(0);

    for (const host of hosts) {
      expect(host.componentInstance.resource()).toBe('site');
    }
  });
});

/**
 * Fase 4 — resumen de errores al enviar (§4.11).
 *
 * El backend sólo envía UN `path` por respuesta (`api.md §7`), así que los
 * errores múltiples que justifican un resumen los produce la validación del
 * cliente: `submit()` marca todo el árbol como tocado y muchos campos
 * quedan inválidos a la vez. Por eso un caso cubre errores de cliente (2+) y
 * el otro un único error de servidor.
 */
describe('FormView — resumen de errores', () => {
  // jsdom no implementa scrollIntoView; sin esto `scrollToFirstError` revienta.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  async function createProductsForm(
    options: {
      /** Registro leído en edición; vacío = todos los `required` inválidos. */
      record?: Record<string, unknown>;
      serverFieldPath?: string;
    } = {},
  ) {
    const record = options.record ?? {};

    await TestBed.configureTestingModule({
      imports: [FormView],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'products', key: 'sku-1' })) },
        },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        {
          provide: ApiService,
          useValue: {
            get: vi.fn(() => of(record)),
            create: vi.fn(() => of({})),
            update: vi.fn(() =>
              options.serverFieldPath ? throwError(() => new Error('rechazado')) : of({}),
            ),
            remove: vi.fn(() => of({})),
            list: vi.fn(() => of([])),
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
        {
          provide: ErrorMapperService,
          useValue: {
            map: vi.fn(() =>
              options.serverFieldPath
                ? { fields: { [options.serverFieldPath]: 'Ese valor ya existe' } }
                : { fields: {} },
            ),
            messageOf: vi.fn(() => ''),
          },
        },
        { provide: UploadService, useValue: { uploadWithProgress: vi.fn(() => of()) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(FormView);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /** Pulsa el botón Guardar y espera a que se pinte y corra el setTimeout. */
  async function submit(fixture: ComponentFixture<FormView>): Promise<void> {
    const form = (fixture.nativeElement as Element).querySelector('form');
    expect(form, 'sin formulario').not.toBeNull();
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();
  }

  it('pinta el resumen con enlaces cuando hay 2 o más errores de cliente', async () => {
    const fixture = await createProductsForm();
    await submit(fixture);

    const summary = (fixture.nativeElement as Element).querySelector('[data-error-summary]');
    expect(summary, 'sin resumen con varios errores').not.toBeNull();

    const links = summary?.querySelectorAll('a') ?? [];
    expect(links.length).toBeGreaterThanOrEqual(2);

    // Cada enlace apunta a un campo real y no a un ancla inventada.
    for (const link of links) {
      const target = link.textContent?.trim() ?? '';
      expect(target).not.toBe('');
    }
    expect(summary?.getAttribute('role')).toBe('alert');

    // Con 2+ el foco va al resumen, no al primer campo.
    expect(document.activeElement).toBe(summary);

    // 4.2: activar un enlace de OTRA pestaña cambia de pestaña, pinta y
    // lleva el foco al campo. El detectChanges() inmediato es la versión de
    // test de la pasada de change detection que Angular hace en runtime
    // antes de correr el setTimeout de goToError.
    const otherTab = Array.from(links).find((link) =>
      link.textContent?.trim().startsWith('Descripción —'),
    );
    expect(otherTab, 'sin enlace a Descripción').toBeDefined();
    (otherTab as HTMLAnchorElement).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();

    const active = document.activeElement;
    expect(['INPUT', 'TEXTAREA', 'SELECT']).toContain(active?.tagName ?? '');
    expect(active).not.toBe(summary);
    // Ya no seguimos en la pestaña inicial.
    expect(
      fixture.nativeElement.querySelector('[aria-selected="true"]')?.textContent?.trim(),
    ).toContain('Contenido');
  });

  it('decisión A: sin ⚠ antes del primer envío, con ⚠ después', async () => {
    const fixture = await createProductsForm();
    const root = fixture.nativeElement as Element;

    // Todavía no se envió: las secciones están incompletas pero no se quejan,
    // ni aparece el resumen. Esto es lo que evita el ruido inicial.
    expect(root.textContent ?? '', '⚠ prematuro').not.toContain('⚠');
    expect(root.querySelector('[data-error-summary]')).toBeNull();

    await submit(fixture);

    expect(fixture.nativeElement.textContent ?? '', 'falta el ⚠ tras enviar').toContain('⚠');
  });

  it('con un solo error no pinta resumen y lleva el foco al campo', async () => {
    const fixture = await createProductsForm({
      record: {
        name: 'Producto',
        slug: 'producto',
        sku: 'SKU-1',
        description: 'x'.repeat(120),
        category_slug: 'cat-1',
        price: 10,
        availability: 'InStock',
        images: [{ image_url: 'a.png', image_alt: 'Alt', position: 1 }],
        seo_description: 'x',
        registro_sanitario: 'x',
        faq: [{ question: '¿P?', answer: 'A', position: 1 }],
      },
      serverFieldPath: 'name',
    });
    await submit(fixture);

    const root = fixture.nativeElement as Element;
    expect(root.querySelector('[data-error-summary]'), 'resumen sobra con un error').toBeNull();

    // El foco cae en el control con el mensaje, no en un resumen.
    const active = document.activeElement as HTMLElement | null;
    expect(active?.id).toContain('name');
  });
});

/**
 * Fase 5 — borrador autoguardado (§4.6 / plan 5.4 y 5.5).
 *
 * Regla que el test protege: el borrador SE OFRECE, nunca se restaura solo.
 */
describe('FormView — borrador', () => {
  const KEY = 'draft:products:nuevo';

  beforeEach(() => localStorage.clear());
  afterAll(() => localStorage.clear());

  async function createForm(): Promise<ComponentFixture<FormView>> {
    await TestBed.configureTestingModule({
      imports: [FormView],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'products' })) },
        },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        {
          provide: ApiService,
          useValue: {
            get: vi.fn(() => of({})),
            create: vi.fn(() => of({})),
            update: vi.fn(() => of({})),
            remove: vi.fn(() => of({})),
            list: vi.fn(() => of([])),
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
        {
          provide: ErrorMapperService,
          useValue: { map: vi.fn(() => ({ fields: {} })), messageOf: vi.fn(() => '') },
        },
        { provide: UploadService, useValue: { uploadWithProgress: vi.fn(() => of()) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(FormView);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('ofrece el borrador sin restaurarlo, y sólo lo aplica al clicar', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ savedAt: Date.now() - 60_000, value: { name: 'Nombre borrador' } }),
    );

    const fixture = await createForm();
    const root = fixture.nativeElement as Element;

    // 1. Se ofrece, no se aplica: el campo sigue vacío.
    const banner = root.querySelector('[role="status"]');
    expect(banner, 'sin aviso de borrador').not.toBeNull();
    expect(banner?.textContent ?? '').toContain('borrador guardado');
    expect(banner?.textContent ?? '').toContain('hace 1 min');

    const named = Array.from(root.querySelectorAll('input')).find(
      (input) => (input as HTMLInputElement).value === 'Nombre borrador',
    );
    expect(named, 'se restauró en silencio').toBeUndefined();

    // 2. Clic en Restaurar → ahora sí.
    const restore = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.trim().startsWith('Restaurar'),
    );
    expect(restore, 'sin botón Restaurar').toBeDefined();
    (restore as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(root.querySelector('[role="status"]'), 'el aviso no se cerró').toBeNull();
    const restored = Array.from(root.querySelectorAll('input')).find(
      (input) => (input as HTMLInputElement).value === 'Nombre borrador',
    );
    expect(restored, 'no se restauró el valor').toBeDefined();
  });

  it('escribe el borrador en localStorage tras editar (debounce)', async () => {
    const fixture = await createForm();
    const input = (fixture.nativeElement as Element).querySelector<HTMLInputElement>('input');
    expect(input, 'sin campo de texto').not.toBeNull();

    input!.value = 'Producto tocado';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    // El volcado va con debounce de 800 ms.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const raw = localStorage.getItem(KEY);
    expect(raw, 'el autoguardado no escribió nada').not.toBeNull();
    const draft = JSON.parse(raw ?? '{}') as { value?: { name?: string } };
    expect(draft.value?.name).toBe('Producto tocado');
  });

  it('sin borrador no muestra ningún aviso', async () => {
    const fixture = await createForm();
    expect((fixture.nativeElement as Element).querySelector('[role="status"]')).toBeNull();
  });
});

/**
 * Fase 5 — 5.8: doble envío bloqueado por `saving` y limpieza del borrador
 * tras un guardado exitoso (§5.5).
 */
describe('FormView — guardado', () => {
  const RECORD = {
    name: 'Producto',
    slug: 'producto',
    sku: 'SKU-1',
    description: 'x'.repeat(120),
    category_slug: 'cat-1',
    price: 10,
    availability: 'InStock',
    images: [{ image_url: 'a.png', image_alt: 'Alt', position: 1 }],
    seo_description: 'x',
    registro_sanitario: 'x',
    faq: [{ question: '¿P?', answer: 'A', position: 1 }],
  };
  const KEY = 'draft:products:sku-1';

  beforeEach(() => localStorage.clear());
  afterAll(() => localStorage.clear());

  async function openEdit(
    overrides: {
      /** Implementación de `update` (por defecto: éxito silencioso). */
      update?: () => unknown;
      /** `ErrorMapperService.map` (por defecto: sin errores de campo). */
      map?: () => { fields: Record<string, string>; general?: string };
    } = {},
  ): Promise<{
    fixture: ComponentFixture<FormView>;
    update: ReturnType<typeof vi.fn>;
  }> {
    const update = vi.fn(overrides.update ?? ((): unknown => of({})));
    await TestBed.configureTestingModule({
      imports: [FormView],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'products', key: 'sku-1' })) },
        },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        {
          provide: ApiService,
          useValue: {
            get: vi.fn(() => of(RECORD)),
            create: vi.fn(() => of({})),
            update,
            remove: vi.fn(() => of({})),
            list: vi.fn(() => of([])),
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
        {
          provide: ErrorMapperService,
          useValue: {
            map: vi.fn(
              overrides.map ?? ((): { fields: Record<string, string> } => ({ fields: {} })),
            ),
            messageOf: vi.fn(() => ''),
          },
        },
        { provide: UploadService, useValue: { uploadWithProgress: vi.fn(() => of()) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(FormView);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, update };
  }

  function fireSubmit(fixture: ComponentFixture<FormView>): void {
    const form = (fixture.nativeElement as Element).querySelector('form');
    expect(form, 'sin formulario').not.toBeNull();
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  it('`saving` bloquea el doble envío', async () => {
    const { fixture, update } = await openEdit();

    // Dos submit síncronos seguidos: el segundo debe caer en el guard de
    // `saving()` y no llegar a la API.
    fireSubmit(fixture);
    fireSubmit(fixture);
    await fixture.whenStable();

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('limpia el borrador tras guardar con éxito', async () => {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), value: RECORD }));

    const { fixture, update } = await openEdit();
    expect(localStorage.getItem(KEY), 'no había borrador que limpiar').not.toBeNull();

    fireSubmit(fixture);
    await fixture.whenStable();

    expect(update).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY), 'el borrador sobrevivió al guardado').toBeNull();
  });

  it('un error del servidor conserva lo escrito y lo pinta en el campo (§6)', async () => {
    const update = vi.fn(() => throwError(() => new Error('falló')));
    const { fixture } = await openEdit({
      update,
      map: () => ({ fields: { name: 'Ya existe un registro con este valor' } }),
    });

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[id$=".name"]',
    );
    expect(input, 'campo «Nombre»').not.toBeNull();
    input!.value = 'Nombre nuevo';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    fireSubmit(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(update).toHaveBeenCalledTimes(1);
    // §6: «Error del servidor: mensaje claro, conservar todo lo escrito».
    expect(input!.value, 'el árbol se limpió tras el error').toBe('Nombre nuevo');
    expect(fixture.nativeElement.textContent).toContain('Ya existe un registro con este valor');
  });
});

/**
 * Plan 6.6 — selección dependiente (guía §1, «país → ciudad»).
 *
 * `condition-evaluator.ts` sólo resuelve condiciones booleanas; el reset es
 * un `effect` de form-view. Estos tests cubren las dos mitades: `disabled()`
 * en `form-schema.ts` (hijo ineditable) y el reinicio al cambiar el padre.
 */
describe('FormView — selección dependiente', () => {
  const TEST_SCHEMA: ResourceSchema = {
    id: 'dep-test',
    label: 'Dependencia',
    labelPlural: 'Dependencias',
    kind: 'singleton',
    endpoint: { get: '/admin/dep-test', update: '/admin/dep-test' },
    keyField: 'key',
    titleField: 'name',
    listColumns: [],
    fields: [
      {
        key: 'pais',
        label: 'País',
        type: 'select',
        options: [
          { value: 'ar', label: 'Argentina' },
          { value: 'br', label: 'Brasil' },
        ],
      },
      {
        key: 'ciudad',
        label: 'Ciudad',
        type: 'select',
        dependsOn: 'pais',
        options: [
          { value: 'ba', label: 'Buenos Aires' },
          { value: 'sp', label: 'São Paulo' },
        ],
      },
    ],
  };

  // El catálogo es un array plano: se inyecta el schema de prueba y se saca
  // en el afterEach para no filtrarlo a los demás tests.
  const catalog = schemas as unknown as ResourceSchema[];

  afterEach(() => {
    const index = catalog.findIndex((schema) => schema.id === TEST_SCHEMA.id);
    if (index >= 0) {
      catalog.splice(index, 1);
    }
  });

  async function createDepForm() {
    catalog.push(TEST_SCHEMA);
    await TestBed.configureTestingModule({
      imports: [FormView],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'dep-test' })) },
        },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        {
          provide: ApiService,
          useValue: {
            get: vi.fn(() => of({})),
            update: vi.fn(() => of({})),
            create: vi.fn(() => of({})),
            remove: vi.fn(() => of({})),
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
        {
          provide: ErrorMapperService,
          useValue: { map: vi.fn(() => ({ fields: {} })), messageOf: vi.fn(() => '') },
        },
        { provide: UploadService, useValue: { uploadWithProgress: vi.fn(() => of()) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(FormView);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /**
   * Los ids llevan el prefijo del formulario (`a.form9.pais`), que `form()`
   * genera en runtime: se buscan por sufijo, que es lo que garantiza el
   * `for` del label de todas formas.
   */
  const fieldOf = (fixture: ComponentFixture<FormView>, id: string): HTMLSelectElement =>
    fixture.nativeElement.querySelector(`select[id$=".${id}"]`);

  function pick(element: HTMLSelectElement, value: string): void {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('el hijo queda disabled mientras el padre esté vacío', async () => {
    const fixture = await createDepForm();

    expect(fieldOf(fixture, 'pais')).not.toBeNull();
    expect(fieldOf(fixture, 'ciudad').disabled).toBe(true);
  });

  it('al elegir el padre, el hijo se habilita', async () => {
    const fixture = await createDepForm();

    pick(fieldOf(fixture, 'pais'), 'ar');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fieldOf(fixture, 'ciudad').disabled).toBe(false);
  });

  it('al cambiar el padre, el hijo vuelve a su valor por defecto', async () => {
    const fixture = await createDepForm();

    pick(fieldOf(fixture, 'pais'), 'ar');
    await fixture.whenStable();
    fixture.detectChanges();
    pick(fieldOf(fixture, 'ciudad'), 'ba');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fieldOf(fixture, 'ciudad').value).toBe('ba');

    pick(fieldOf(fixture, 'pais'), 'br');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fieldOf(fixture, 'ciudad').value).toBe('');
  });
});
