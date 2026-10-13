import { convertToParamMap, type ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import type {
  ResourceSchema,
  SelectionBinding,
  UiViewDescriptor,
} from '../../core/models/schema.model';

/**
 * R9.9 · D1 — Canal ViewContext.
 *
 * El shell monta hojas con `loadComponent` SIN bindings de input, así que el
 * único canal que una hoja recibe es `route.data`. Este módulo es la fábrica
 * ÚNICA de ese payload para ambos productores:
 *
 * - Lado embebido (`ViewSlot`, slice 3): `syntheticRoute(payload)` — una
 *   `ActivatedRoute` sintética cuyo `data` emite síncrono, de modo que
 *   `toSignal(route.data, {requireSync:true})` sigue funcionando igual.
 * - Lado ruta (`shell.routes`): `resolve:{viewContext}` devuelve el mismo
 *   payload con el `emit` ligado en contexto de inyección.
 *
 * Cero reescritura en las hojas: leen `schema`/`resourceId`/`uiView` como
 * siempre. Un `emit` ausente significa «sin comportamiento declarado ⇒ el
 * comportamiento local sigue» — nunca es un error.
 */

/** Evento de selección que una hoja emite cuando hay `select` declarado. */
export interface SelectionEvent {
  /** Recurso del registro seleccionado. */
  resource: string;
  /** Clave estable del registro — la ÚNICA identidad que viaja al router. */
  key: string;
  /** Disparador que activó la transición (`on` del binding). */
  action: string;
}

/** Callback de selección entregado a la hoja a través del canal. */
export type SelectionEmitter = (event: SelectionEvent) => void;

/**
 * Payload del canal: las mismas claves planas que una hoja montada por ruta
 * lee en `route.data`. `schema` explícito sólo existe en el lado embebido
 * (schema virtual); montado por ruta la hoja lo resuelve vía `resourceId`.
 */
export interface ViewContextData {
  schema?: ResourceSchema;
  resourceId: string;
  uiView: string;
  viewType: string;
  /**
   * Profundidad de ESTA instancia (raíz ⇒ campo ausente ⇒ 0). El productor
   * embebido (`ViewSlot`) la fija para que un contenedor anidado pase
   * `depth + 1` a sus propios slots y el tope `MAX_DEPTH` se cumpla en
   * runtime aunque el validador no llegue a correr (defensa en profundidad).
   */
  depth?: number;
  /**
   * Binding `select` declarado por la vista (cualquier mode). El `emit`
   * sólo existe para `mode:'route'`; la hoja necesita VER el binding para
   * aplicar la decision table (R9.9.4): ausente ⇒ comportamiento local,
   * `inline` ⇒ selección local, `none` ⇒ no-op explícito.
   */
  select?: SelectionBinding;
  emit?: SelectionEmitter;
}

/** Identidad estable de una instancia embebida: `parentId + '/' + childId`. */
export function instanceIdFor(parentId: string, childId: string): string {
  return `${parentId}/${childId}`;
}

/**
 * Schema virtual por instancia: clona el schema y expone la config del hijo
 * bajo `uiViews[instanceId]`, de modo que la lookup existente
 * `schema.uiViews[route.uiView]` de las hojas resuelve la config del nodo
 * SIN tocar ninguna hoja. No muta el schema original.
 */
export function virtualSchemaFor(
  schema: ResourceSchema,
  instanceId: string,
  view: UiViewDescriptor,
): ResourceSchema {
  return { ...schema, uiViews: { ...schema.uiViews, [instanceId]: view } };
}

/**
 * `ActivatedRoute` sintética para hijos embebidos. `of()` emite síncrono ⇒
 * `toSignal(..., {requireSync:true})` no revienta. El cast es único y
 * documentado (D1): sólo se consume `data`, igual que una ruta real.
 */
export function syntheticRoute(data: ViewContextData): ActivatedRoute {
  // `paramMap` además de `data`: hojas tipo `ResourcePage` (list/detail/
  // dashboard) hacen `toSignal(route.paramMap, {requireSync:true})` y
  // `paramMap.subscribe(...)`. Vacío = embebido sin clave de registro
  // (nunca un detail-key implícito); la clave real viaja en el payload.
  return {
    data: of(data),
    paramMap: of(convertToParamMap({})),
  } as unknown as ActivatedRoute;
}

/** Construye el payload; `emit` sólo se agrega si existe (clave ausente si no). */
export function createViewContext(
  base: Omit<ViewContextData, 'emit'>,
  emit?: SelectionEmitter,
): ViewContextData {
  return emit === undefined ? { ...base } : { ...base, emit };
}
