/**
 * Acceso dinámico a los subárboles de un formulario cuyo modelo es
 * `Record<string, unknown>` (decisión Fase 10: el tipado del modelo como
 * Record permite indexar con cualquier clave, pero el acceso se centraliza
 * aquí porque devuelve `undefined` en el tipo).
 *
 * Fase 11: los contenedores (`group`, `list`) se resuelven igual, más los
 * índices de las listas (`itemTree`).
 */

import type { FieldTree } from '@angular/forms/signals';

import type { FieldSchema } from '../core/models/schema.model';

/** Árbol de un formulario con modelo dinámico. */
export type RootTree = FieldTree<Record<string, unknown>>;

/**
 * Contexto que el `ng-template` del `list` recibe por `ngTemplateOutlet`
 * para renderizar los campos de un ítem. El template vive en el despachador
 * (`field-host`) porque es el único que puede instanciar `app-field-host`;
 * el list lo instancia una vez por ítem con este contexto.
 */
export interface ListChildContext {
  fields: readonly FieldSchema[];
  tree: RootTree;
  /** Prefijo de ruta de los errores del backend para este nivel (`faq[2].`). */
  prefix: string;
  errors: Record<string, string>;
  exists: boolean;
  /** `itemDisplay: 'row'` → los campos van en flujo compacto, no en grilla. */
  row: boolean;
  /** Clase `sm:col-span-*` de un campo (literal: Tailwind v4 es JIT). */
  colSpan: (width?: number) => string;
}

/** Subárbol del hijo directo bajo `key`. Lanza un error claro si el modelo no
 * contiene la clave (los modelos se siembran con los `default` del schema
 * antes de llamar a `form()`).
 */
export function childTree<T>(parent: RootTree, key: string): FieldTree<T> {
  const child = (parent as unknown as Record<string, FieldTree<T> | undefined>)[key];
  if (child === undefined) {
    throw new Error(`El formulario no contiene el campo "${key}".`);
  }
  return child;
}

/** Subárbol de un campo `list`/`group` cuyo valor es un objeto. */
export function groupTree(parent: RootTree, key: string): RootTree {
  return childTree<Record<string, unknown>>(parent, key);
}

/** Subárbol de un campo `list` (los ítems se acceden por índice). */
export function listTree<T>(parent: RootTree, key: string): FieldTree<T[]> {
  return childTree<T[]>(parent, key);
}

/**
 * Ítem de una lista como árbol navegable.
 *
 * **Los nodos de ítem se atan a la identidad del elemento**, no al índice:
 * tras un cambio del arreglo el nodo viejo queda huérfano y leerlo lanza
 * `NG01904 «Orphan field»`. Por eso este helper se llama SIEMPRE fresco, en
 * cada render/computed — nunca se cachea un nodo entre mutaciones.
 *
 * El `as unknown` es porque `FieldTree<Item, number>` no es assignable a
 * `RootTree` (le falta el index signature de `string`), pero se navega igual.
 */
export function itemTree<T>(items: FieldTree<T[]>, index: number): RootTree {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`La lista no contiene el índice ${index}.`);
  }
  return item as unknown as RootTree;
}

/**
 * Ítem escalar de un `string-list` como nodo (`FieldTree<string>`), listo
 * para `[formField]`. Mismo criterio de frescura que `itemTree`.
 */
export function stringItemTree(items: FieldTree<string[]>, index: number): FieldTree<string> {
  const item = items[index] as FieldTree<string> | undefined;
  if (item === undefined) {
    throw new Error(`La lista no contiene el índice ${index}.`);
  }
  return item;
}
