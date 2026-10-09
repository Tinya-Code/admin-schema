import { firstValueFrom } from 'rxjs';
import { LucideShare2 } from '@lucide/angular';

import type { ActionDescriptor } from './action-registry';
import type {
  CopyShareAction,
  NavigateAction,
  ResourceAction,
  TriggerAction,
} from '../core/models/schema.model';
import { buildShareMessage, writeClipboard } from '../core/utils/clipboard';
import { interpolateTemplate } from '../core/utils/template-interpolator';

/**
 * Descriptores de las tres acciones que hoy declara el modelo
 * (R3.10 · `doc/plan-refactor-motor.md` §3.2).
 *
 * Éste es el fichero que **cierra la triplicación de `copy-share`**: la
 * resolución de enlace y de mensaje vivía en `list-view.runAction`,
 * `detail-view.resolveUrl/resolveShareText` y
 * `post-create-modal.resolvedShareUrl/resolvedShareText`. Aquí se resuelve
 * una sola vez (`resolveShare`) y las vistas consumen ese resultado en R3.11.
 *
 * Se registra al importar, desde `action-registry.ts`, con el mismo criterio
 * que el registro de render: sin esperar a DI, porque el registro es la única
 * fuente de verdad en runtime.
 */

/** Enlace y mensaje ya interpolados, listos para copiar o compartir. */
export interface ResolvedShare {
  url: string;
  shareText: string;
}

/**
 * `true` cuando la acción es de las que las vistas presentan como botón de
 * compartir (`detail-view`, `post-create-modal`).
 *
 * Vive acá y no en la vista porque es **el único sitio donde se puede nombrar
 * `'copy-share'`**: fuera de `descriptors.ts` ninguna vista decide por tipo
 * (criterio de R3.11).
 */
export function isShareAction(action: ResourceAction): action is CopyShareAction {
  return action.type === 'copy-share';
}

/**
 * Resuelve `urlTemplate` y el mensaje de compartir contra `vars`
 * (config global + registro).
 *
 * **Única implementación** de esta lógica en el admin. El fallback a
 * `share_message_template` (la plantilla que declara el singleton de
 * configuración) lo aplican los tres puntos por igual: hasta ahora la fila
 * del listado no lo honraba y se quedaba sin saludo.
 */
export function resolveShare(
  action: CopyShareAction,
  vars: Record<string, unknown>,
): ResolvedShare {
  const template =
    action.shareTextTemplate || (vars['share_message_template'] as string | undefined);
  return {
    url: interpolateTemplate(action.urlTemplate, vars),
    shareText: template ? interpolateTemplate(template, vars) : '',
  };
}

/** `copy-share` — copia (o comparte) el mensaje completo del enlace público. */
const copyShare: ActionDescriptor = {
  type: 'copy-share',
  surfaces: ['row', 'detail', 'post-create'],
  // Icono de la fila del listado: la vista sólo decide entre «icono» y
  // «rótulo», nunca por tipo. Se pasa la CLASE, no el nombre: sin
  // `provideLucideIcons` no hay riesgo de `Unable to resolve icon`.
  icon: LucideShare2,
  run: async (ctx, action) => {
    const { url, shareText } = resolveShare(action as CopyShareAction, ctx.vars);
    const message = buildShareMessage(url, shareText);
    const copied = await writeClipboard(message);
    if (copied) {
      ctx.toast.success('Mensaje copiado al portapapeles.');
    } else {
      ctx.toast.info(`Copiar manualmente: ${message}`);
    }
    return { ok: true };
  },
};

/**
 * `navigate` — abre la plantilla resuelta: URL absoluta en otra pestaña,
 * ruta interna en el router. `NavigateAction.type` es opcional, así que el
 * servicio llega acá también con una acción que no declara `type`.
 */
const navigate: ActionDescriptor = {
  type: 'navigate',
  surfaces: ['row', 'detail'],
  run: async (ctx, action) => {
    const url = interpolateTemplate((action as NavigateAction).urlTemplate, ctx.vars);
    if (/^https?:\/\//.test(url)) {
      window.open(url, '_blank', 'noopener');
    } else {
      await ctx.router.navigateByUrl(url);
    }
    return { ok: true };
  },
};

/**
 * `trigger` — dispara una **acción de dominio declarada en el back** (B3).
 *
 * **R3.12:** el destino ya no lo declara el schema (`endpoint` y `method`
 * murieron en este cambio). Se deriva de `resource` + clave del registro +
 * `name` (o `id`), que es exactamente la ruta que el back publica solo en
 * R5.4: `POST /admin/<recurso>/:id/actions/<name>`.
 *
 * ⚠️ **O2:** la ruta lógica viaja en el `path` del envelope, no en la URL —
 * el HTTP sigue siendo el `POST API_URL` de siempre.
 *
 * Siempre pide confirmación: es la única acción de las tres que puede dejar
 * una cola de trabajo hecha.
 */
const trigger: ActionDescriptor = {
  type: 'trigger',
  surfaces: ['row', 'detail'],
  confirm: true,
  run: async (ctx, action) => {
    const declared = action as TriggerAction;
    const rawKey = ctx.record?.[ctx.keyField];
    if (rawKey === null || rawKey === undefined || rawKey === '') {
      throw new Error(
        `La acción «${declared.label}» necesita la clave ${ctx.keyField} del registro.`,
      );
    }
    const name = declared.name ?? declared.id;
    const route = `/admin/${ctx.resource}/${String(rawKey)}/actions/${name}`;
    await firstValueFrom(ctx.api.request('POST', route));
    return { ok: true, reload: true };
  },
};

/** Catálogo — una línea por acción, en el orden en que se registran. */
export const actionDescriptors: readonly ActionDescriptor[] = [copyShare, navigate, trigger];
