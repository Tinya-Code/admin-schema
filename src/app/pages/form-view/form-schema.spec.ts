import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, signal } from '@angular/core';
import { form } from '@angular/forms/signals';
import { of } from 'rxjs';

import type { ResourceSchema } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { type RootTree, childTree, groupTree } from '../../fields/field-node';
import { ordersSchema } from '../../schemas/orders.schema';
import { buildFormSchema } from './form-schema';
import { seedModel } from './form-model';

/**
 * Ciclo de vida por MODO del formulario (`hiddenOn` y `readonlyOn`).
 *
 * `form-schema` no tenía ningún test: ni `visibleWhen` ni `readonlyOn` estaban
 * cubiertos, así que la rama que refactoricé a `modeAppliesTo` corría a ciegas.
 * Se prueba sobre el schema real de `orders`, que es donde nació la necesidad.
 *
 * El modo se expresa con `excludeKey`: indefinido = alta, con clave = edición
 * (es la misma señal que lee `applyCommonRules`).
 */
describe('buildFormSchema — ciclo de vida por modo', () => {
  /** Árbol del formulario en el modo dado. `excludeKey` definido = edición. */
  function tree(schema: ResourceSchema, excludeKey?: string): RootTree {
    // `seedModel` es imprescindible: Signal Forms no crea nodos para claves
    // ausentes del modelo, y `childTree` tira "El formulario no contiene el
    // campo" en lugar de devolver un estado por defecto.
    const model = signal(seedModel(schema));
    return form(
      model,
      buildFormSchema(schema, { list: () => of([]) } as unknown as ApiService, excludeKey),
      { injector: TestBed.inject(EnvironmentInjector) },
    ) as unknown as RootTree;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: { list: () => of([]) } }],
    });
  });

  it('hiddenOn: create — oculta en alta y muestra en edición', () => {
    // En alta no existen: los genera el back (transforms `token` y `pin`).
    const enAlta = tree(ordersSchema);
    expect(childTree<unknown>(enAlta, 'ref')().hidden()).toBe(true);
    expect(childTree<unknown>(enAlta, 'pin')().hidden()).toBe(true);

    // En edición sí aparecen: al operador le sirve verlos con su valor.
    const enEdicion = tree(ordersSchema, 'ORD-0001');
    expect(childTree<unknown>(enEdicion, 'ref')().hidden()).toBe(false);
    expect(childTree<unknown>(enEdicion, 'pin')().hidden()).toBe(false);
  });

  it('los campos sin hiddenOn se ven en alta', () => {
    const enAlta = tree(ordersSchema);
    expect(childTree<unknown>(enAlta, 'customer_name')().hidden()).toBe(false);
    expect(childTree<unknown>(enAlta, 'status')().hidden()).toBe(false);
  });

  it('un hiddenOn: update oculta sólo en edición', () => {
    const soloAlta: ResourceSchema = {
      ...ordersSchema,
      fields: [{ type: 'text', key: 'marca', label: 'Marca', hiddenOn: 'update' }],
    };
    expect(childTree<unknown>(tree(soloAlta), 'marca')().hidden()).toBe(false);
    expect(childTree<unknown>(tree(soloAlta, 'X'), 'marca')().hidden()).toBe(true);
  });

  it('un hiddenOn: always oculta en los dos modos', () => {
    const siempre: ResourceSchema = {
      ...ordersSchema,
      fields: [{ type: 'text', key: 'marca', label: 'Marca', hiddenOn: 'always' }],
    };
    expect(childTree<unknown>(tree(siempre), 'marca')().hidden()).toBe(true);
    expect(childTree<unknown>(tree(siempre, 'X'), 'marca')().hidden()).toBe(true);
  });

  it('un hiddenOn: create no se confunde con visibleWhen', () => {
    // `visibleWhen` es condición sobre OTRO campo; `hiddenOn` es modo. La
    // segunda edición (con clave) no puede reactivar un campo por modo.
    const porModo: ResourceSchema = {
      ...ordersSchema,
      fields: [
        { type: 'text', key: 'padre', label: 'Padre' },
        { type: 'text', key: 'hijo', label: 'Hijo', hiddenOn: 'create' },
      ],
    };
    // Alta: el padre tiene valor pero el modo manda.
    expect(childTree<unknown>(tree(porModo), 'hijo')().hidden()).toBe(true);
    // Edición: el padre está vacío y aun así el hijo se ve (no hay visibleWhen).
    expect(childTree<unknown>(tree(porModo, 'X'), 'hijo')().hidden()).toBe(false);
  });
});

/**
 * Validadores del REGISTRO (R4.6 · F7 + B11).
 *
 * `buildFormSchema` ya no decide reglas: recorre `FIELD_VALIDATORS` y cada
 * entrada ata su regla a la ruta del campo. Lo que se prueba acá es el
 * CABLEADO: que las reglas llegan al árbol con el mensaje de siempre, en la
 * ruta correcta (incluida la recursión de `group` y `list`) y que `unique`
 * hoy alcanza a un campo `text` (`products.sku` lo declaraba y se quedaba sin
 * regla).
 */
describe('buildFormSchema — validadores del registro', () => {
  /** Mensajes de un campo, en el orden en que los pinta la UI. */
  function mensajes(delArbol: RootTree, key: string): string[] {
    return childTree<unknown>(delArbol, key)()
      .errors()
      .map((error) => error.message ?? error.kind);
  }

  /** Árbol con el modelo sembrado con `valores` encima de los defaults. */
  function conValores(
    campos: ResourceSchema['fields'],
    valores: Record<string, unknown>,
    api?: ApiService,
  ): RootTree {
    const schema: ResourceSchema = { ...ordersSchema, fields: campos };
    const model = signal({ ...seedModel(schema), ...valores });
    return form(
      model,
      buildFormSchema(schema, api ?? ({ list: () => of([]) } as unknown as ApiService)),
      {
        injector: TestBed.inject(EnvironmentInjector),
      },
    ) as unknown as RootTree;
  }

  it('longitud, patrón y rango llegan con su mensaje', () => {
    const campos: ResourceSchema['fields'] = [
      { type: 'text', key: 'nombre', label: 'Nombre', validators: { minLength: 5, maxLength: 8 } },
      { type: 'number', key: 'cantidad', label: 'Cantidad', min: 1, max: 10 },
      { type: 'date', key: 'fecha', label: 'Fecha', min: '2026-01-01', max: '2026-12-31' },
    ];
    const raiz = conValores(campos, { nombre: 'ab', cantidad: 0, fecha: '2025-06-01' });
    expect(mensajes(raiz, 'nombre')).toEqual(['Debe tener al menos 5 caracteres.']);
    expect(mensajes(raiz, 'cantidad')).toEqual(['Debe ser como mínimo 1.']);
    expect(mensajes(raiz, 'fecha')).toEqual(['La fecha no puede ser anterior a 2026-01-01.']);
  });

  it('límites superiores, patrón y fecha máxima llegan con su mensaje', () => {
    const campos: ResourceSchema['fields'] = [
      { type: 'text', key: 'nombre', label: 'Nombre', validators: { maxLength: 8 } },
      {
        type: 'text',
        key: 'codigo',
        label: 'Código',
        validators: { pattern: '^[A-Z]{3}$' },
        help: '3 mayúsculas',
      },
      { type: 'number', key: 'cantidad', label: 'Cantidad', max: 10 },
      { type: 'date', key: 'fecha', label: 'Fecha', max: '2026-12-31' },
    ];
    const raiz = conValores(campos, {
      nombre: 'abcdefghij',
      codigo: 'abc',
      cantidad: 11,
      fecha: '2027-03-01',
    });
    expect(mensajes(raiz, 'nombre')).toEqual(['Como máximo 8 caracteres.']);
    // El patrón repite la ayuda: el error reemplaza el texto de abajo.
    expect(mensajes(raiz, 'codigo')).toEqual(['Formato esperado: 3 mayúsculas.']);
    expect(mensajes(raiz, 'cantidad')).toEqual(['Debe ser como máximo 10.']);
    expect(mensajes(raiz, 'fecha')).toEqual(['La fecha no puede ser posterior a 2026-12-31.']);
  });

  it('palabras, correo, URL y tope de ítems llegan con su mensaje', () => {
    const campos: ResourceSchema['fields'] = [
      { type: 'textarea', key: 'resumen', label: 'Resumen', minWords: 3, maxWords: 5 },
      { type: 'email', key: 'correo', label: 'Correo' },
      { type: 'url', key: 'web', label: 'Web' },
      { type: 'list', key: 'items', label: 'Items', itemFields: [], max: 2 },
    ];
    const raiz = conValores(campos, {
      resumen: 'uno dos tres cuatro cinco seis',
      correo: 'no-es-correo',
      web: 'ftp://x',
      items: ['a', 'b', 'c'],
    });
    expect(mensajes(raiz, 'resumen')).toEqual(['Como máximo 5 palabras.']);
    expect(mensajes(raiz, 'correo')).toEqual(['Debe ser un correo electrónico válido.']);
    expect(mensajes(raiz, 'web')).toEqual(['Debe ser una URL válida (http o https).']);
    expect(mensajes(raiz, 'items')).toEqual(['Como máximo 2 elementos.']);
  });

  it('required: vacío en un escalar, ítem mínimo en una lista', () => {
    const campos: ResourceSchema['fields'] = [
      { type: 'text', key: 'nombre', label: 'Nombre', required: true },
      { type: 'list', key: 'items', label: 'Items', required: true, itemFields: [] },
    ];
    const raiz = conValores(campos, { items: [] });
    expect(mensajes(raiz, 'nombre')).toEqual(['Campo obligatorio.']);
    // Un `[]` no está «vacío» para el usuario: obligatorio exige un ítem.
    expect(mensajes(raiz, 'items')).toEqual(['Debe tener al menos 1 elemento.']);
  });

  it('un group registra las reglas de sus hijos bajo la ruta del hijo', () => {
    const campos: ResourceSchema['fields'] = [
      {
        type: 'group',
        key: 'datos',
        label: 'Datos',
        fields: [{ type: 'text', key: 'codigo', label: 'Código', required: true }],
      },
    ];
    const raiz = conValores(campos, {});
    const grupo = groupTree(raiz, 'datos');
    expect(
      childTree<unknown>(grupo, 'codigo')()
        .errors()
        .map((e) => e.message),
    ).toEqual(['Campo obligatorio.']);
  });

  it('unique aplica a un campo text y consulta el listado del recurso', async () => {
    const campos: ResourceSchema['fields'] = [
      { type: 'text', key: 'sku', label: 'SKU', validators: { unique: true } },
    ];
    const api = { list: () => of([{ key: 'p1', sku: 'ABC-1' }]) } as unknown as ApiService;
    const raiz = conValores(campos, {}, api);

    const campo = childTree<string>(raiz, 'sku');
    campo().value.set('ABC-1');
    // validateAsync: debounce de 300 ms + el resource del listado.
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(mensajes(raiz, 'sku')).toContain('Este valor ya existe en el registro.');
  });
});
