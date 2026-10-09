import {
  applyEach,
  disabled,
  hidden,
  readonly as readonlyRule,
  type SchemaFn,
  type SchemaPathTree,
} from '@angular/forms/signals';

import type { FieldSchema, ResourceSchema } from '../../core/models/schema.model';
import type { ApiService } from '../../core/services/api.service';
import {
  FIELD_VALIDATORS,
  registerEmailRule,
  registerUrlRule,
  type FieldPath,
  type ValidatorContext,
} from '../../core/registry/field-validators';
import { isSupported } from '../../core/registry/render-registry';
import { evaluateCondition } from '../../shared/utils/condition-evaluator';

/** Ruta de un hijo bajo un path (raíz, grupo o ítem). */
type ChildPath<V> = FieldPath<V>;
/** Ruta raíz del formulario. */
type RootPath = SchemaPathTree<Record<string, unknown>>;
/** Ruta de un campo lista (para `applyEach`). */
type ListPath<V> = FieldPath<V>;

/**
 * Reglas del formulario desde el schema (base.md §4, §6, §9, §10).
 *
 * Hay DOS clases de reglas y viven en sitios distintos:
 *
 * 1. **Ciclo de vida** — `visibleWhen`, `readonlyOn`, `hiddenOn`, `dependsOn`:
 *   decides si el campo se toca, se ve o se manda. Vive acá, con la
 *   estructura del formulario.
 * 2. **Validadores** — obligatoriedad, longitud, patrón, rangos, únicos…:
 *   vive en `core/registry/field-validators.ts` (F7 + B11), con los MISMOS
 *   nombres que el back. Este módulo sólo RECORRE ese registro por cada
 *   campo: añadir un validador es una entrada allá, no un `case` acá.
 *
 * El schema de Signal Forms recibe el path RAÍZ; las reglas se atan a la ruta
 * dinámica de cada campo. El barrido es **recursivo** — un `group` registra
 * las reglas de sus hijos bajo su propia ruta y un `list` registra las de
 * cada ítem con `applyEach`, de modo que las reglas corran también para los
 * ítems que se agregan después.
 *
 * Solo se generan reglas para los tipos que la UI sabe editar (`isSupported('field', …)`):
 * un campo invisible con `required` bloquearía el guardado para siempre.
 *
 * `api` y `excludeKey` alimentan la validación `unique`: se consulta el
 * listado del recurso y se descarta el propio registro (la clave del registro
 * en edición, tomada de la ruta).
 */
export function buildFormSchema(
  schema: ResourceSchema,
  api: ApiService,
  excludeKey?: string,
): SchemaFn<Record<string, unknown>> {
  return (root) => {
    applyRulesToFields(
      { schema, api, excludeKey, root, container: root, siblings: schema.fields },
      schema.fields,
    );
  };
}

/**
 * Ámbito de registro de reglas.
 *
 * - `root` es siempre la raíz del formulario (referencia para condiciones que
 *   nombran un campo de la raíz, base.md §4: «mismo nivel o registro raíz»).
 * - `container` es el nodo del que cuelgan las rutas hijas: la raíz, un
 *   `group` o un ítem de un `list`.
 * - `siblings` son los campos declarados en `container`: si una condición
 *   nombra a uno de ellos se evalúa contra el contenedor, si no, contra la
 *   raíz.
 */
interface RuleScope {
  schema: ResourceSchema;
  api: ApiService;
  excludeKey: string | undefined;
  root: RootPath;
  container: object;
  siblings: readonly FieldSchema[];
}

function applyRulesToFields(scope: RuleScope, fields: readonly FieldSchema[]): void {
  for (const field of fields) {
    if (!isSupported('field', field.type)) {
      continue;
    }
    applyRulesToField(scope, field, pathAt<unknown>(scope.container, field.key));
  }
}

function applyRulesToField(scope: RuleScope, field: FieldSchema, path: ChildPath<unknown>): void {
  applyLifecycleRules(scope, field, path);

  // Validadores: el registro manda. Cada entrada decide si el campo la pide
  // y ata su regla a ESTA ruta (F7: sin `if` por regla en este módulo).
  const ctx: ValidatorContext = {
    path,
    field,
    schema: scope.schema,
    api: scope.api,
    excludeKey: scope.excludeKey,
  };
  for (const entry of FIELD_VALIDATORS) {
    if (entry.declares(ctx)) {
      entry.register(ctx);
    }
  }

  // Estructura (no es validador): los HIJOS se registran bajo su propia
  // ruta, recursivamente, para que las reglas corran también en los ítems
  // que el usuario agrega después.
  switch (field.type) {
    case 'group': {
      applyRulesToFields({ ...scope, container: path, siblings: field.fields }, field.fields);
      break;
    }
    case 'list': {
      applyEach(path as unknown as ListPath<Record<string, unknown>[]>, (item) =>
        applyRulesToFields(
          { ...scope, container: item as object, siblings: field.itemFields },
          field.itemFields,
        ),
      );
      break;
    }
    case 'string-list': {
      applyEach(path as unknown as ListPath<string[]>, (item) =>
        applyStringItemRules(item as ChildPath<string>, field.itemType),
      );
      break;
    }
    default:
      break;
  }
}

/**
 * ¿Aplica `mode` en ESTE contexto de formulario?
 *
 * Lo comparten `readonlyOn` y `hiddenOn`: `always` vale en todos los modos,
 * `create` sólo en alta y `update` sólo en edición. El modo se detecta por
 * `scope.excludeKey !== undefined`, que es la señal que ya usaba `readonlyOn`
 * (form-view define `mode` a partir de la misma condición).
 */
function modeAppliesTo(mode: 'create' | 'update' | 'always', isEdit: boolean): boolean {
  return mode === 'always' || (mode === 'update' && isEdit) || (mode === 'create' && !isEdit);
}

/**
 * Ciclo de vida del campo: visibilidad, edición y dependencias (base.md §4).
 *
 * Aquí NO hay validadores — la obligatoriedad vive en el registro.
 * `hidden` además excluye el campo de `dirty`, `invalid` y del payload
 * (base.md §10 «Campos ocultos»), y `disabled` lo deja fuera de la
 * validación, así un `required` en el hijo no bloquea el guardado mientras
 * no haya nada que elegir.
 */
function applyLifecycleRules(scope: RuleScope, field: FieldSchema, path: ChildPath<unknown>): void {
  if (field.visibleWhen) {
    const condition = field.visibleWhen;
    hidden(path, {
      when: (ctx) =>
        !evaluateCondition(condition, ctx.valueOf(conditionPath(scope, condition.field))),
    });
  }
  // Selección dependiente (guía §1, plan 6.6): el hijo no se puede tocar
  // hasta que el padre tenga valor.
  //
  // Acá NO sirve `conditionPath`: eso devuelve el contenedor entero porque
  // `evaluateCondition` recibe el objeto de hermanos. Acá se necesita el
  // valor concreto del padre.
  if (field.dependsOn) {
    const parentKey = field.dependsOn;
    const isSibling = scope.siblings.some((candidate) => candidate.key === parentKey);
    const parent = isSibling ? scope.container : scope.root;
    const parentPath = pathAt<unknown>(parent, parentKey);
    disabled(path, ({ valueOf }) => isEmptyValue(valueOf(parentPath)));
  }
  if (field.readonly) {
    readonlyRule(path, { when: () => true });
  }
  if (field.readonlyOn && modeAppliesTo(field.readonlyOn, scope.excludeKey !== undefined)) {
    readonlyRule(path, { when: () => true });
  }
  // Ciclo de vida de la visibilidad — simétrico a `readonlyOn` de arriba.
  // `hidden()` deja el campo fuera de la validación y del payload, así que en
  // alta un campo que LLENA EL BACK no ocupa la sección ni exige nada: sin
  // esto, `ref` y `pin` aparecían vacíos con un "se genera solo al guardar".
  if (field.hiddenOn && modeAppliesTo(field.hiddenOn, scope.excludeKey !== undefined)) {
    hidden(path, { when: () => true });
  }
  if (field.readonlyWhen) {
    const condition = field.readonlyWhen;
    readonlyRule(path, {
      when: (ctx) =>
        evaluateCondition(condition, ctx.valueOf(conditionPath(scope, condition.field))),
    });
  }
}

/** Vacío para el propósito de «el padre todavía no eligió nada». */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  return Array.isArray(value) && value.length === 0;
}

/**
 * Path contra el que se evalúa una condición: el contenedor si nombra a un
 * campo hermano, la raíz si no (base.md §4: «otro campo del mismo nivel o
 * del registro raíz»).
 */
function conditionPath(scope: RuleScope, key: string): RootPath {
  const isSibling = scope.siblings.some((field) => field.key === key);
  const target = isSibling ? scope.container : scope.root;
  return target as RootPath;
}

/** Ítems de `string-list`: validan según el tipo declarado (§9: text/url/email). */
function applyStringItemRules(
  path: ChildPath<string>,
  itemType: 'text' | 'url' | 'email' | undefined,
): void {
  if (itemType === 'email') {
    registerEmailRule(path);
  }
  if (itemType === 'url') {
    registerUrlRule(path);
  }
}

/**
 * Navegación dinámica sobre el árbol de paths.
 *
 * Indexar `SchemaPathTree<Record<string, unknown>>` con una clave dinámica
 * devuelve `SchemaPath<unknown, …> | undefined`: el `| undefined` es solo una
 * consecuencia del index signature, y las reglas con valor concreto (`min`,
 * `minLength`, `email`…) exigen afinar el tipo. Los casts de este módulo
 * viven acá; los del registro, en `field-validators.ts` (solución reportada
 * en plan.md, Fase 10).
 */
function pathAt<V>(parent: object, key: string): ChildPath<V> {
  const path = (parent as unknown as Record<string, unknown>)[key];
  if (path === undefined) {
    throw new Error(`El formulario no contiene la ruta "${key}".`);
  }
  return path as ChildPath<V>;
}
