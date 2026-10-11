import { Service, inject } from '@angular/core';

import {
  actionType,
  getAction,
  type ActionContext,
  type ActionRequest,
  type ActionResult,
} from './action-registry';
import type { ResourceAction } from '../core/models/schema.model';
import { ConfigService } from '../core/services/config.service';
import { ErrorMapperService } from '../core/services/error-mapper.service';

/**
 * Ejecuta una acción declarada en el schema (R3.9 · `refactormotor.md`).
 *
 * Sustituye el dispatch por tipo que hoy vive en `list-view` y en las
 * copias de `detail-view` y `post-create-modal` (R3.11). El camino siempre
 * es el mismo:
 *
 *   1. resolver el descriptor (si no existe, **rompe** — nada de «disponible
 *      próximamente», que hoy oculta esquemas mal declarados);
 *   2. pedir confirmación si el descriptor la exige;
 *   3. montar el `ActionContext` (petición + `vars` de interpolación);
 *   4. ejecutar y, si el descriptor lanza, notificar el error y devolver
 *      `{ ok: false }` para que la vista no trate el fallo como éxito.
 */
@Service()
export class ActionService {
  private readonly config = inject(ConfigService);
  private readonly errores = inject(ErrorMapperService);

  async run(action: ResourceAction, request: ActionRequest): Promise<ActionResult> {
    const type = actionType(action);
    const descriptor = getAction(type);
    if (!descriptor) {
      throw new Error(
        `[actions] «${action.label}» no tiene descriptor registrado (type "${type}").`,
      );
    }

    if (descriptor.confirm) {
      const aceptado = await request.toast.confirm({
        title: action.label,
        message: confirmMessage(action),
        confirmLabel: 'Confirmar',
        cancelLabel: 'Cancelar',
      });
      if (!aceptado) {
        return { ok: false };
      }
    }

    // `copy-share` (R8.7) resuelve su mensaje contra la config global
    // (`share_message_template`). Si el load del bootstrap no llegó (arranque
    // sin sesión o red lenta), lo pedimos ahora —con la sesión ya iniciada—
    // ANTES de congelar `vars`: si no, el mensaje copiado degradaría a
    // «sólo la URL» hasta el próximo F5.
    if (descriptor.type === 'copy-share') {
      await this.config.ensureLoaded();
    }

    const ctx: ActionContext = { ...request, vars: this.vars(request.record) };
    try {
      return await descriptor.run(ctx, action);
    } catch (err) {
      request.toast.error(this.errores.messageOf(err));
      return { ok: false };
    }
  }

  /**
   * Config global + registro. Sin registro (`header`, `bulk`) el contexto de
   * interpolación queda vacío: el descriptor no tiene nada que interpolar.
   *
   * Público porque `detail-view` sólo **presenta** una acción (pinta
   * `<app-copy-share>`) en vez de ejecutarla, y aun así necesita el mismo
   * contexto: R3.11 acabó con la tercera copia de esta lógica.
   */
  vars(record: Record<string, unknown> | null): Record<string, unknown> {
    return record ? this.config.buildInterpolationContext(record) : {};
  }
}

function confirmMessage(action: ResourceAction): string {
  return 'confirmMessage' in action && action.confirmMessage ? action.confirmMessage : action.label;
}
