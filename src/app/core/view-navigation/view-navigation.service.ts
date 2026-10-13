import { Injectable, inject } from '@angular/core';
import { Router, type ActivatedRouteSnapshot } from '@angular/router';

import type { NavigationTarget, SelectionBinding } from '../models/schema.model';
import { getSchema } from '../../schemas/registry';
import type { SelectionEvent } from '../../views/composer/view-context';

/**
 * R9.9 · D4 — Servicio de navegación declarativa.
 *
 * Un leaf (hoja) sólo NAVEGA cuando hay `select` declarado; el motor vive
 * aquí, no en cada hoja. El flujo completo es:
 *
 * `ctx.emit/leaf → dispatch → buildSegments(pattern, {key}) →
 * router.navigate(matriz de comandos) → roleGuard`
 *
 * Invariantes:
 *
 * - **key-only**: la ÚNICA identidad que viaja es `event.key`. Los comandos
 *   son una matriz de segmentos (nunca concat de strings) ⇒ el Router
 *   codifica la clave (una clave `A/B` queda `A%2FB` en la URL) y ningún
 *   dato del registro llega a la URL.
 * - **Fail closed**: sin binding, con acción distinta a la declarada o con
 *   `mode` distinto de `route`, NO hay navegación — simplemente no ocurre.
 * - **Fail loud**: un target que el registry no declara lanza ruido antes de
 *   navegar (el validador pre-render ya lo garantiza; esto es defensa en
 *   profundidad).
 * - **Guards reales**: `router.navigate` ⇒ `roleGuard` corre igual que en
 *   cualquier navegación declarada. Si el guard bloquea, no se registra
 *   origen (no hay «atrás» que una sesión sin permiso deba volver a ver).
 */

/**
 * Patrón de segmentos de la ruta destino (`['orders', ':key']`). Usa la
 * MISMA fuente que el validador (`getSchema`) para que lo validado en build
 * sea exactamente lo navegado en runtime. Inexistente ⇒ `undefined` (la
 * defensa en profundidad: el validador pre-render garantiza que esto no
 * ocurre en schemas válidos).
 */
export function targetRoutePattern(target: NavigationTarget): string[] | undefined {
  const destino = getSchema(target.resource);
  const vista = destino?.uiViews?.[target.view];
  if (!destino || !vista) return undefined;
  const relativa = vista.path ?? '';
  return [destino.id, ...(relativa === '' ? [] : relativa.split('/'))];
}

/**
 * Segmentos de la ruta destino con la clave sustituida. La clave es SIEMPRE
 * un segmento completo (no se parte en `/`); un param distinto de `:key` no
 * tiene fuente declarada ⇒ falla ruido, no navega a medias.
 */
export function buildSegments(pattern: readonly string[], key: string): string[] {
  const commands: string[] = [];
  for (const segmento of pattern) {
    if (segmento.startsWith(':')) {
      const nombre = segmento.slice(1);
      if (nombre !== 'key') {
        throw new Error(`Destino ':${nombre}' sin fuente declarada en SelectionEvent`);
      }
      commands.push(key);
    } else {
      commands.push(segmento);
    }
  }
  return commands;
}

@Injectable({ providedIn: 'root' })
export class ViewNavigationService {
  private readonly router = inject(Router);

  /** URL desde la que se navegó la última selección válida (origen del «atrás»). */
  private origen: string | undefined;

  /**
   * Transición declarada de un leaf. Inerte si no hay binding, si la acción
   * no es la declarada o si el modo no es `route`; falla ruido si el target
   * no existe en el registry.
   *
   * @returns `true` si el Router completó la navegación (guards aceptados).
   */
  async dispatch(binding: SelectionBinding | undefined, event: SelectionEvent): Promise<boolean> {
    if (binding === undefined) return false; // sin declaración ⇒ inerte
    if (binding.on !== event.action) return false; // fuera del scope declarado
    if (binding.mode !== 'route') return false; // comportamiento local del leaf

    const pattern = targetRoutePattern(binding.target);
    if (pattern === undefined) {
      throw new Error(
        `Destino '${binding.target.resource}/${binding.target.view}' no existe en el registry`,
      );
    }

    const urlOrigen = this.router.url;
    const ok = await this.router.navigate(['/', ...buildSegments(pattern, event.key)]);
    if (ok) this.origen = urlOrigen;
    return ok;
  }

  /**
   * Forma de volver (D4). Orden: `returnPath` declarado por el leaf ⇒
   * origen registrado por `dispatch` ⇒ raíz del recurso declarado en la ruta
   * actual (entrada directa a la URL: no hay origen en memoria). Fallback
   * final: la raíz de la aplicación.
   */
  async back(returnPath?: string): Promise<boolean> {
    if (returnPath !== undefined) return this.router.navigate([returnPath]);

    if (this.origen !== undefined) {
      const destino = this.origen;
      this.origen = undefined;
      return this.router.navigateByUrl(destino);
    }

    const recurso = this.recursoActual();
    return recurso === undefined
      ? this.router.navigate(['/'])
      : this.router.navigate(['/', recurso]);
  }

  /** Primer `resourceId` declarado en el árbol de rutas activo. */
  private recursoActual(): string | undefined {
    let nodo: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    while (nodo !== null) {
      const id = nodo.data?.['resourceId'];
      if (id !== undefined) return String(id);
      nodo = nodo.firstChild;
    }
    return undefined;
  }
}
