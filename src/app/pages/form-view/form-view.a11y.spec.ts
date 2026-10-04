import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../../core/services/api.service';
import { ErrorMapperService } from '../../core/services/error-mapper.service';
import { NotificationService } from '../../core/services/notification.service';
import { UploadService } from '../../core/services/upload.service';
import type { ResourceSchema } from '../../core/models/schema.model';
import { schemas } from '../../schemas/registry';
import { FormView } from './form-view';

/**
 * Fase 3, 9.1 y 9.2 — accesibilidad de campos y de las pestañas.
 *
 * Afirma lo que pide la guía §2 y §8: toda etiqueta resuelve a un nodo
 * existente, todo control con `[id]` expone `aria-invalid` y `aria-required`,
 * y cada token de `aria-describedby` apunta a un nodo que está en el árbol
 * (un id colgado no sirve a ningún lector de pantalla).
 *
 * El helper vive a nivel de módulo porque los dos bloques lo comparten:
 * el primero recorre `products` (10 tipos) pestaña por pestaña — el layout
 * `tabs` sólo monta la sección activa — y el segundo cubre los 20 tipos de
 * `SUPPORTED_FIELD_TYPES` con un schema sintético.
 */
function assertFieldA11y(root: Element, section: string): { controls: number; described: number } {
  const where = (el: Element) =>
    `<${el.tagName.toLowerCase()}` +
    (el.id ? ` id=${el.id}` : '') +
    (el.getAttribute('data-field') ? ` data-field=${el.getAttribute('data-field')}` : '') +
    `> en «${section}»`;

  // 1. Toda etiqueta tiene ancla: un `for` colgado no asocia nada.
  for (const label of root.querySelectorAll('label[for]')) {
    const target = label.getAttribute('for') as string;
    expect(document.getElementById(target), `label[for=${target}] sin elemento`).not.toBeNull();
  }

  // 2. Todo control con id expone su estado.
  const controls = root.querySelectorAll('input[id], select[id], textarea[id], output[id]');
  for (const control of controls) {
    expect(control.hasAttribute('aria-invalid'), `aria-invalid ausente: ${where(control)}`).toBe(
      true,
    );
    expect(control.hasAttribute('aria-required'), `aria-required ausente: ${where(control)}`).toBe(
      true,
    );
    expect(
      control.getAttribute('aria-invalid'),
      `aria-invalid ilegible: ${where(control)}`,
    ).toMatch(/^(true|false)$/);
  }

  // 3. `aria-describedby` sólo apunta a nodos que existen.
  let described = 0;
  for (const control of root.querySelectorAll('[aria-describedby]')) {
    described += 1;
    for (const token of (control.getAttribute('aria-describedby') as string).split(/\s+/)) {
      expect(
        document.getElementById(token),
        `describedby colgado «${token}»: ${where(control)}`,
      ).not.toBeNull();
    }
  }

  return { controls: controls.length, described };
}
describe('FormView — accesibilidad de campos (products)', () => {
  async function createProductsForm({
    relationOptions = true,
  }: { relationOptions?: boolean } = {}) {
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
            // Modo edición con ítems: si no, las pestañas de imágenes, ficha
            // y FAQ renderizan el estado vacío y no habría nada que auditar.
            get: vi.fn(() =>
              of({
                name: 'Producto de prueba',
                slug: 'producto-de-prueba',
                category_slug: 'cat-1',
                sku: 'SKU-1',
                price: 100,
                availability: 'InStock',
                description: 'Descripción',
                images: [{ image_url: 'a.png', image_alt: 'Alt', position: 1 }],
                specs: [{ key: 'Peso', value: '1 kg', position: 1 }],
                faq: [{ question: '¿Pregunta?', answer: 'Respuesta', position: 1 }],
              }),
            ),
            create: vi.fn(() => of({})),
            update: vi.fn(() => of({})),
            remove: vi.fn(() => of({})),
            // Opciones de la relación `category_slug`. Sin ellas cae la rama
            // `error`, que es la que tenía el label del host sin ancla.
            list: relationOptions
              ? vi.fn(() => of([{ slug: 'cat-1', name: 'Categoría', active: true }]))
              : vi.fn(() => throwError(() => new Error('sin opciones'))),
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

  it('asocia etiqueta, estado y texto de ayuda en cada pestaña', async () => {
    const fixture = await createProductsForm();
    const root = fixture.nativeElement as Element;

    const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
    expect(tabs.length).toBeGreaterThan(0);

    let audited = 0;
    let described = 0;
    for (const tab of tabs) {
      (tab as HTMLElement).click();
      fixture.detectChanges();

      const panel = root.querySelector('[role="tabpanel"]');
      expect(panel, `sin panel tras pulsar «${tab.textContent?.trim()}»`).not.toBeNull();
      const result = assertFieldA11y(panel as Element, tab.textContent?.trim() ?? '?');
      audited += result.controls;
      described += result.described;
    }

    // Si la auditoría no llegara a ningún control, estaría pasando por vacío.
    expect(audited, 'sin controles auditados').toBeGreaterThanOrEqual(10);
    // `slug`, `description` y `registro_sanitario` traen `help`: si este
    // contador es 0, la rama de `aria-describedby` no se está ejercitando.
    expect(described, 'ningún control enlaza su texto de ayuda').toBeGreaterThan(0);
  });

  it('asocia el label de la relación aunque falle la carga de sus opciones', async () => {
    const fixture = await createProductsForm({ relationOptions: false });
    const root = fixture.nativeElement as Element;

    let label: Element | undefined;
    for (const tab of root.querySelectorAll('[role="tab"]')) {
      (tab as HTMLElement).click();
      fixture.detectChanges();
      label = Array.from(root.querySelectorAll('label[for]')).find((candidate) =>
        (candidate.getAttribute('for') ?? '').includes('category_slug'),
      );
      if (label) {
        break;
      }
    }

    expect(label, 'category_slug no aparece en ninguna pestaña').toBeDefined();
    const target = label?.getAttribute('for') as string;
    expect(
      document.getElementById(target),
      'la rama error de la relación deja el label sin ancla',
    ).not.toBeNull();
  });

  it('el error de servidor reemplaza al texto de ayuda (§2)', async () => {
    const fixture = await createProductsForm();
    const root = fixture.nativeElement as Element;
    const control = root.querySelector('input[id*="slug"]') as HTMLInputElement | null;
    expect(control, 'input de slug no renderizado en la pestaña activa').not.toBeNull();

    /** Texto del nodo que el control anuncia. */
    const announced = () => {
      const ids = control?.getAttribute('aria-describedby');
      if (!ids) {
        return null;
      }
      return document.getElementById(ids.split(/\s+/)[0])?.textContent?.trim() ?? null;
    };

    // Sin error: el control enlaza su ayuda.
    expect(announced()).toContain('Inmutable tras publicar.');

    // Con error de servidor: el mensaje pasa a ser lo anunciado y la ayuda
    // desaparece del árbol — no deben convivir los dos.
    fixture.componentInstance.serverErrors.set({ fields: { slug: 'Ese slug ya existe' } });
    fixture.detectChanges();

    expect(announced()).toBe('Ese slug ya existe');
    expect(root.textContent).not.toContain('Inmutable tras publicar.');

    // 3.4: el error sigue anunciándose en el momento en que aparece.
    const errorId = control?.getAttribute('aria-describedby')?.split(/\s+/)[0];
    expect(document.getElementById(errorId as string)?.getAttribute('role')).toBe('alert');
  });

  /** Pulsa una tecla sobre la pestaña activa; el evento burbujea al tablist. */
  async function pressActiveTab(fixture: ComponentFixture<FormView>, key: string): Promise<void> {
    const active = (fixture.nativeElement as Element).querySelector(
      '[role="tab"][aria-selected="true"]',
    ) as HTMLElement;
    expect(active, 'sin pestaña activa').not.toBeNull();
    active.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const activeTab = (root: Element): Element | null =>
    root.querySelector('[role="tab"][aria-selected="true"]');

  it('9.2 — las flechas, Home y End cambian de pestaña y llevan el foco', async () => {
    const fixture = await createProductsForm();
    const root = fixture.nativeElement as Element;
    const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
    expect(tabs.length, 'products necesita ≥3 pestañas para esto').toBeGreaterThan(2);

    (tabs[0] as HTMLElement).click();
    fixture.detectChanges();
    expect(activeTab(root)).toBe(tabs[0]);

    // Envuelve en ambas direcciones.
    await pressActiveTab(fixture, 'ArrowLeft');
    expect(activeTab(root), 'ArrowLeft desde la primera debe envolver').toBe(tabs.at(-1));
    expect(document.activeElement, 'el foco sigue a la selección').toBe(tabs.at(-1));

    await pressActiveTab(fixture, 'ArrowRight');
    expect(activeTab(root), 'ArrowRight desde la última debe envolver').toBe(tabs[0]);
    expect(document.activeElement).toBe(tabs[0]);

    await pressActiveTab(fixture, 'End');
    expect(activeTab(root)).toBe(tabs.at(-1));
    expect(document.activeElement).toBe(tabs.at(-1));

    await pressActiveTab(fixture, 'Home');
    expect(activeTab(root)).toBe(tabs[0]);
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('9.2 — sólo la pestaña activa entra en el orden de Tab (roving tabindex)', async () => {
    const fixture = await createProductsForm();
    const root = fixture.nativeElement as Element;
    const tabs = Array.from(root.querySelectorAll('[role="tab"]')) as HTMLElement[];
    const active = activeTab(root) as HTMLElement;

    expect(tabs.length).toBeGreaterThan(1);
    expect(active, 'sin pestaña activa').not.toBeNull();

    // jsdom no mueve el foco con Tab: el orden de tabulación lo gobierna
    // `tabindex`, así que ésta es la aserción que cubre «Tab recorre el
    // formulario en orden visual» — una pestaña activa y el resto fuera.
    const tabbable = tabs.filter((tab) => tab.getAttribute('tabindex') === '0');
    expect(tabbable, 'una sola pestaña debe ser tabulable').toHaveLength(1);
    expect(tabbable[0], 'la tabulable debe ser la activa').toBe(active);

    for (const tab of tabs) {
      expect(tab.getAttribute('tabindex'), `tabindex de «${tab.textContent?.trim()}»`).toBe(
        tab === active ? '0' : '-1',
      );
    }

    // El panel activo viene justo detrás del tablist: desde la pestaña
    // tabulable, el siguiente tabulable es el primer campo de la sección.
    expect(
      Array.from(root.querySelectorAll('[role="tabpanel"]')).length,
      'en modo tabs sólo hay un panel montado',
    ).toBe(1);
  });
});

/**
 * Fase 9.1 — accesibilidad de los 20 tipos de campo.
 *
 * `products` sólo declara 10 tipos; este bloque monta un schema sintético
 * con los 20 que acepta `SUPPORTED_FIELD_TYPES` (incluido `date`, que ningún
 * schema real usa) y comprueba las dos caras del contrato de `field-host`
 * (líneas 138-153): los tipos con control único llevan `<label for>`
 * anclado a su propio nombre, y los compuestos y los `group` no lo llevan
 * a propósito, porque no existe un id al que apuntar.
 *
 * Sin `layout` el componente cae en modo `sections` y monta todos los
 * campos de una vez, sin recorrer pestañas.
 */
describe('FormView — a11y de los 20 tipos de campo (9.1)', () => {
  const OPTIONS = [{ value: 'a', label: 'Opción A' }];

  const ALL_TYPES_SCHEMA: ResourceSchema = {
    id: 'all-types',
    label: 'Todos los tipos',
    labelPlural: 'Todos los tipos',
    kind: 'singleton',
    endpoint: { get: '/admin/all-types', update: '/admin/all-types' },
    keyField: 'key',
    titleField: 'f_text',
    listColumns: [],
    fields: [
      { key: 'f_text', label: 'Texto', type: 'text', help: 'Ayuda de texto.' },
      { key: 'f_textarea', label: 'Área', type: 'textarea' },
      { key: 'f_slug', label: 'Slug', type: 'slug', from: 'f_text', help: 'Ayuda de slug.' },
      { key: 'f_number', label: 'Número', type: 'number' },
      { key: 'f_currency', label: 'Precio', type: 'currency' },
      { key: 'f_boolean', label: 'Booleano', type: 'boolean' },
      { key: 'f_select', label: 'Select', type: 'select', options: OPTIONS },
      { key: 'f_multiselect', label: 'Multi', type: 'multiselect', options: OPTIONS },
      { key: 'f_url', label: 'URL', type: 'url' },
      { key: 'f_email', label: 'Email', type: 'email' },
      { key: 'f_phone', label: 'Teléfono', type: 'phone' },
      { key: 'f_date', label: 'Fecha', type: 'date' },
      { key: 'f_time', label: 'Hora', type: 'time' },
      { key: 'f_readonly', label: 'Sólo lectura', type: 'readonly-text' },
      {
        key: 'f_group',
        label: 'Grupo',
        type: 'group',
        fields: [{ key: 'g_inner', label: 'Interno', type: 'text' }],
      },
      {
        key: 'f_list',
        label: 'Lista',
        type: 'list',
        itemFields: [{ key: 'i_inner', label: 'Item', type: 'text' }],
      },
      { key: 'f_stringlist', label: 'Cadenas', type: 'string-list' },
      { key: 'f_keyvalue', label: 'Clave/valor', type: 'key-value' },
      { key: 'f_relation', label: 'Relación', type: 'relation', resource: 'categories' },
      { key: 'f_image', label: 'Imagen', type: 'image' },
    ],
  };

  /** Valores de entrada: sin ellos los compuestos se renderizan vacíos. */
  const RECORD: Record<string, unknown> = {
    f_text: 'x',
    f_textarea: 'x',
    f_slug: 'x',
    f_number: 1,
    f_currency: 10,
    f_boolean: true,
    f_select: 'a',
    f_multiselect: ['a'],
    f_url: 'https://x.dev',
    f_email: 'a@b.c',
    f_phone: '+54 11 1234-5678',
    f_date: '2026-01-01',
    f_time: '10:00',
    f_readonly: 'x',
    f_group: { g_inner: 'x' },
    f_list: [{ i_inner: 'x', position: 1 }],
    f_stringlist: ['uno'],
    f_keyvalue: [{ key: 'K', value: 'V', position: 1 }],
    f_relation: 'cat-1',
    f_image: 'https://x.dev/a.png',
  };

  /** `field-host.ts` no pinta el `<label for>` propio de estos tipos. */
  const SIN_LABEL_PROPIO = new Set(['group', 'list', 'key-value', 'string-list', 'multiselect']);

  const catalog = schemas as unknown as ResourceSchema[];

  afterEach(() => {
    const index = catalog.findIndex((schema) => schema.id === ALL_TYPES_SCHEMA.id);
    if (index >= 0) {
      catalog.splice(index, 1);
    }
  });

  async function createAllTypesForm() {
    catalog.push(ALL_TYPES_SCHEMA);
    await TestBed.configureTestingModule({
      imports: [FormView],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'all-types' })) },
        },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        {
          provide: ApiService,
          useValue: {
            get: vi.fn(() => of(RECORD)),
            // Opciones de la relación: vacías bastan para pintar el campo.
            list: vi.fn(() => of([])),
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

  it('monta los 20 tipos y cada uno cumple el contrato de a11y', async () => {
    const fixture = await createAllTypesForm();
    const root = fixture.nativeElement as Element;

    // 1. Ningún tipo soportado queda fuera del DOM: `field-host` escribe
    //    `data-field` con el nombre del campo en TODOS los tipos.
    const missing = ALL_TYPES_SCHEMA.fields
      .filter((field) => !root.querySelector(`[data-field$=".${field.key}"]`))
      .map((field) => field.type);
    expect(missing, `tipos sin renderizar: ${missing.join(', ')}`).toEqual([]);

    // 2. Auditoría global: etiquetas ancladas, `aria-invalid` y
    //    `aria-required` en todo control con id, `aria-describedby` resoluble.
    const { controls, described } = assertFieldA11y(root, 'los 20 tipos');
    expect(controls, 'controles auditados').toBeGreaterThanOrEqual(15);
    expect(described, 'ninguna ayuda queda enlazada').toBeGreaterThan(0);

    // 3. Etiqueta propia: obligatoria con control único, ausente a propósito
    //    en compuestos y `group` (no hay id al que apuntar).
    for (const field of ALL_TYPES_SCHEMA.fields) {
      const wrapper = root.querySelector(`[data-field$=".${field.key}"]`);
      const ownName = wrapper?.getAttribute('data-field') ?? '';
      const ownLabel = Array.from(wrapper?.querySelectorAll('label[for]') ?? []).find(
        (label) => label.getAttribute('for') === ownName,
      );

      if (SIN_LABEL_PROPIO.has(field.type)) {
        expect(ownLabel, `«${field.type}» no debería llevar un <label for> propio`).toBeUndefined();
        continue;
      }

      expect(ownLabel, `«${field.type}» (${field.key}) sin <label for>`).toBeDefined();
      expect(
        document.getElementById(ownLabel?.getAttribute('for') ?? ''),
        `el label de «${field.type}» no resuelve a ningún nodo`,
      ).not.toBeNull();
    }
  });
});
