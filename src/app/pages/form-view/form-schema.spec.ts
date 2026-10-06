import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, signal } from '@angular/core';
import { form } from '@angular/forms/signals';
import { of } from 'rxjs';

import type { ResourceSchema } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { type RootTree, childTree } from '../../fields/field-node';
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
