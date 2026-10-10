import { inject, Service } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { DataSource } from '../models/schema.model';
import { interpolateTemplate } from '../utils/template-interpolator';
import { getSchema } from '../../schemas/registry';
import { ApiService } from './api.service';

/** Fila cruda de un listado: el motor no impone forma a las columnas. */
export type SourceRow = Record<string, unknown>;

/**
 * Cuánto se reutiliza una respuesta pedida igual (F8 · R6.5).
 *
 * Un panel de administración lee mucho y escribe poco: medio minuto de
 * frescura cubre un recorrido por varios formularios sin repetir la misma
 * vuelta. Es una decisión de UX, no de contrato — `invalidate()` la salta
 * cuando el usuario acaba de crear lo que la fuente lista.
 */
const TTL_MS = 30_000;

/** Techo de claves cacheadas: un Map sin límite es una fuga en una sesión larga. */
const MAX_CLAVES = 100;

/**
 * `source.params` con cada `{campo}` resuelto contra `ctx`.
 *
 * - Un valor que se resuelve **vacío se OMITE** en vez de mandar `''`: el
 *   back distingue «parámetro ausente» (fail-closed ⇒ sin filas) de un
 *   `eq ''` que podría cruzarse con filas realmente vacías.
 * - Un parámetro sin marcador `{}` es literal y viaja tal cual.
 */
export function interpolateParams(
  params: Record<string, string> | undefined,
  ctx?: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (params === undefined) return out;
  for (const name of Object.keys(params)) {
    const raw = params[name];
    const value = interpolateTemplate(raw, ctx ?? {});
    if (value !== '') out[name] = value;
  }
  return out;
}

/**
 * Clave de caché de una fuente: `resource|view|params` (F8 · R6.5).
 *
 * Los parámetros van **resueltos** y ordenados, así que dos fuentes que
 * terminan pidiendo lo mismo comparten entrada, y un `{campo}` que cambia
 * es otra entrada. Pura: es también el valor que `resource({ params })` de
 * Angular compara para decidir si vuelve a cargar.
 */
export function dataSourceKey(source: DataSource, ctx?: Record<string, unknown>): string {
  const params = interpolateParams(source.params, ctx);
  const names = Object.keys(params).sort();
  const query = names
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(params[name])}`)
    .join('&');
  return `${source.resource}|${source.view ?? ''}|${query}`;
}

/**
 * Fetcher único de `source` (F8 · R6.5): relations, selects y widgets del
 * panel piden sus filas ACÁ y no cada uno desde su componente.
 *
 * - **Caché por `resource+view+params`** con TTL e invalidación explícita —
 *   es la pieza que evita que seis widgets del panel disparen seis vueltas
 *   iguales a la misma vista.
 * - **Deduplicación de vuelta en vuelo**: dos consumidores que pidan la misma
 *   clave en el mismo ciclo comparten la promesa (no la respuesta, la vuelta).
 * - Un error **no queda cacheado**: se borra la entrada para que la recarga
 *   del consumidor vuelva a intentarlo en vez de devolver siempre la misma
 *   rechazada.
 */
@Service()
export class DataSourceService {
  private readonly api = inject(ApiService);

  private readonly cache = new Map<string, { promise: Promise<SourceRow[]>; at: number }>();

  /**
   * Filas de la fuente declarada.
   *
   * `fresh` salta la caché (recarga tras una escritura); `ctx` sólo se usa
   * para resolver `{campo}` en `params` y no cambia la forma de la respuesta.
   */
  async rows(
    source: DataSource,
    ctx?: Record<string, unknown>,
    fresh = false,
  ): Promise<SourceRow[]> {
    const key = dataSourceKey(source, ctx);
    if (!fresh) {
      const hit = this.cache.get(key);
      if (hit !== undefined && Date.now() - hit.at < TTL_MS) return hit.promise;
    }
    const promise = this.fetch(source, ctx).catch((error: unknown) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, { promise, at: Date.now() });
    if (this.cache.size > MAX_CLAVES) {
      // El Map conserva el orden de inserción: sale la más vieja.
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    return promise;
  }

  /**
   * Vacía las filas ya pedidas. Sin argumento, todas; con un `resourceId`,
   * sólo las de ese recurso (lo que acaba de crear el drawer de relación).
   */
  invalidate(resourceId?: string): void {
    if (resourceId === undefined) {
      this.cache.clear();
      return;
    }
    const prefix = `${resourceId}|`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  private async fetch(source: DataSource, ctx?: Record<string, unknown>): Promise<SourceRow[]> {
    const target = getSchema(source.resource);
    if (!target) {
      // Un id que ni siquiera existe en el registry es error de
      // configuración, no de red: el consumidor lo pinta como «no se
      // pudieron cargar» con este texto.
      throw new Error(`Recurso desconocido: ${source.resource}`);
    }
    const payload: Record<string, unknown> = {};
    if (source.view !== undefined && source.view !== '') payload['view'] = source.view;
    const params = interpolateParams(source.params, ctx);
    if (Object.keys(params).length > 0) payload['params'] = params;
    const rows = await firstValueFrom(this.api.list<SourceRow>(target.endpoint, payload));
    return Array.isArray(rows) ? rows : [];
  }
}
