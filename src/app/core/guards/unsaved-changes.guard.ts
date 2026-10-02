import { CanDeactivateFn } from '@angular/router';

/** Componente que expone si se puede salir (base.md §13.9: cambios sin guardar). */
export interface CanLeaveWhenDirty {
  canDeactivate(): boolean | Promise<boolean>;
}

/**
 * Avisa antes de salir con cambios sin guardar. El componente decide:
 * `canDeactivate()` devuelve `true` para salir limpio o una `Promise` que
 * resuelve según la respuesta del usuario (vía `NotificationService.confirm`).
 */
export const unsavedChangesGuard: CanDeactivateFn<unknown> = (component) => {
  const candidate = component as Partial<CanLeaveWhenDirty> | null | undefined;
  return candidate?.canDeactivate?.() ?? true;
};
