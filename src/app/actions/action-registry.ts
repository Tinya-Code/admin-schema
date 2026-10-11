import type { Router } from '@angular/router';

import type { LucideIcon } from '@lucide/angular';

import {
  actionDescriptors,
  isShareAction,
  isTriggerAction,
  resolveShare,
  type ResolvedShare,
} from './descriptors';
import type { ResourceAction } from '../core/models/schema.model';
import type { SessionUser } from '../core/services/auth.service';
import type { ApiService } from '../core/services/api.service';
import type { NotificationService } from '../core/services/notification.service';

/**
 * Registro único de acciones (R3.9 · `refactormotor.md`).
 *
 * Es el gemelo del registro de render (`core/registry/render-registry.ts`):
 * en lugar de «qué componente pinta un tipo de campo», responde «qué
 * comportamiento ejecuta un tipo de acción» y permite **migrar el dispatch
 * if/copiado-pegado de las vistas (R3.11) a datos + un solo `run`**.
 *
 * Como los descriptores son objetos planos de módulo (no los inyecta Angular),
 * todo lo que necesiten llegar por el `ActionContext`: los puertos (`api`,
 * `router`, `toast`) y los datos (`record`, `resource`, `vars`).
 */

/** Superficies donde una acción puede aparecer. */
export type ActionSurface = 'row' | 'detail' | 'header' | 'bulk' | 'post-create';

/**
 * Lo que aporta el llamador al ejecutar una acción: el registro sobre el que
 * corre y los puertos que el descriptor usará para actuar.
 *
 * `record` es `null` en las superficies sin fila (`header`, `bulk`), para que
 * un descriptor pueda distinguir «sin registro» de «registro vacío».
 */
export interface ActionRequest {
  record: Record<string, unknown> | null;
  /** Id del recurso (schema) dueño de la acción. */
  resource: string;
  api: ApiService;
  router: Router;
  toast: NotificationService;
  user: SessionUser | null;
  /**
   * `keyField` del schema. **R3.12 (desviación nº 3 del contrato):** con
   * `record` forma la clave que necesita la ruta lógica de `trigger`
   * (`/admin/<recurso>/<key>/actions/<name>`). Lo aporta la vista, que es
   * quien tiene el schema.
   */
  keyField: string;
}

/**
 * Contexto que recibe el descriptor: la petición del llamador más el contexto
 * de interpolación ya resuelto. `ActionService.run` lo arma, así que ninguna
 * vista repite `buildInterpolationContext(record)`.
 */
export interface ActionContext extends ActionRequest {
  /** `{...configGlobal, ...record, public_base_url}` — listo para las plantillas. */
  vars: Record<string, unknown>;
}

/** Resultado que la vista puede leer para saber si debe recargar. */
export interface ActionResult {
  /** `false` cuando la acción no llegó a ejecutarse; el error ya se notificó. */
  ok: boolean;
  /** `true` cuando tocó datos y la vista debe recargar su listado/detalle. */
  reload?: boolean;
}

export interface ActionDescriptor {
  /** Clave del dispatch: el `type` del schema (`'navigate'` no lo declara). */
  type: string;
  /** Superficies donde esta acción puede aparecer. */
  surfaces: ActionSurface[];
  run: (ctx: ActionContext, action: ResourceAction) => Promise<ActionResult>;
  /** `true` si el descriptor exige confirmación antes de ejecutar. */
  confirm?: boolean;
  /**
   * Icono lucide que representa la acción donde el espacio es reducido
   * (la fila del listado). Sin él, la vista muestra `action.label`.
   */
  icon?: LucideIcon;
}

export { isShareAction, isTriggerAction, resolveShare, type ResolvedShare };

const ACCIONES = new Map<string, ActionDescriptor>();

/** Registra (o reemplaza) un descriptor de acción. */
export function registerAction(descriptor: ActionDescriptor): void {
  ACCIONES.set(descriptor.type, descriptor);
}

export function getAction(type: string): ActionDescriptor | undefined {
  return ACCIONES.get(type);
}

/** Descriptores disponibles en una superficie. */
export function actionsFor(surface: ActionSurface): ActionDescriptor[] {
  return [...ACCIONES.values()].filter((descriptor) => descriptor.surfaces.includes(surface));
}

/**
 * Clave de dispatch de una acción. `NavigateAction.type` es **opcional**
 * (schema.model.ts), así que una acción sin `type` es una navegación.
 */
export function actionType(action: ResourceAction): string {
  return action.type ?? 'navigate';
}

/** Tipos registrados. Sólo para comprobaciones y tests. */
export function actionTypes(): string[] {
  return [...ACCIONES.keys()];
}

// Catálogo a scope de módulo: se registra al importar, sin esperar a DI,
// igual que el registro de render (mismo motivo: `buildFormSchema()` es una
// función pura que consulta sin inyectar nada).
for (const descriptor of actionDescriptors) {
  registerAction(descriptor);
}
