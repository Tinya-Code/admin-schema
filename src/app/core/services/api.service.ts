import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, Observable, tap, throwError } from 'rxjs';

import { renewedTokenOf } from '../models/api.model';
import type { ResourceEndpoints } from '../models/schema.model';
import { API_URL } from '../tokens';
import { AuthService } from './auth.service';

/** Métodos que entiende el envelope del backend (baseapi §2.3). */
export type EnvelopeMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * CRUD genérico sobre el contrato v2 (baseapi §2.3): TODA llamada a la API
 * es un `POST` a `API_URL` con cuerpo `text/plain` y el JSON
 * `{ token, method, path, payload }`. `method: 'GET'` también para lecturas;
 * el token viaja en el cuerpo (nunca en cabeceras: criterio 11 de §17).
 *
 * `text/plain` en lugar de `application/json` evita el preflight CORS
 * (simple request) — criterio 11: sin cabeceras custom.
 *
 * **R2.8 — convención sobre el snippet.** `auth.md` §5.2 llama a las claves
 * `{ route, op, token, payload }`, pero el backend (`parseEnvelope_`) lee
 * `path` y `method`: el snippet es un esquema a medias, no un contrato.
 * Mismo precedente que en R2.5 — **la convención del código gana**. Cambiar
 * el nombre ahora rompería el único transporte que existe.
 *
 * **R2.12 — el token sale de `AuthService`, no de configuración.** El
 * `ADMIN_TOKEN` (D21-C) se retiró: no hay credencial fija, hay sesión.
 *
 * Devuelve el JSON plano tal cual, sin transformaciones ocultas
 * (base.md §1, principio 4). Los errores del backend (200 + `{ error: {…} }`)
 * los convierte en `ApiError` el interceptor `apiErrorInterceptor`, que es
 * también quien pasa los `AUTH_*` a `AuthService.applyAuthCode` (R2.9).
 */
@Service()
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);
  private readonly auth = inject(AuthService);

  /**
   * Listado. El backend envuelve la respuesta cuando la operación declara
   * `shape.envelope: 'list'` (F5) ⇒ `{ items, nextCursor, total }` (R6.4);
   * la UI consume `T[]` en todos lados (F7-3) y este es el ÚNICO punto que
   * habla de listas, así que el desenvolvimiento vive acá. `nextCursor` es
   * el token de la página siguiente y `null` en la última — éste servicio
   * lo descarta hoy porque la lista no pagina todavía (backlog-ui-ux).
   * Un listado sin envelope (arreglo plano, el contrato histórico) pasa
   * tal cual.
   *
   * `payload` sólo lo usa una fuente declarada (F8 · R6.5): `{ view, params }`
   * pide el listado filtrado por una vista y sus parámetros. Sin él, la
   * llamada es la de siempre — la lectura llana del recurso.
   */
  list<T>(endpoint: ResourceEndpoints, payload?: Record<string, unknown>): Observable<T[]> {
    return this.send<unknown>(endpoint.list, 'GET', payload).pipe(map((raw) => unwrapList<T>(raw)));
  }

  /** `key` solo aplica a colecciones (`{key}` en la plantilla); los singleton no la llevan. */
  get<T>(endpoint: ResourceEndpoints, key?: string): Observable<T> {
    return this.send<T>(this.withKey(endpoint.get, key), 'GET');
  }

  create<T>(endpoint: ResourceEndpoints, payload: Record<string, unknown>): Observable<T> {
    return this.send<T>(endpoint.create, 'POST', payload);
  }

  update<T>(
    endpoint: ResourceEndpoints,
    key: string | undefined,
    payload: Record<string, unknown>,
  ): Observable<T> {
    return this.send<T>(this.withKey(endpoint.update, key), 'PUT', payload);
  }

  remove(endpoint: ResourceEndpoints, key?: string): Observable<void> {
    return this.send<void>(this.withKey(endpoint.remove, key), 'DELETE');
  }

  /**
   * Operación genérica sobre una ruta ya resuelta: reorder de colección
   * (`PUT /admin/x` con `{ reorder: … }`), `/admin/schema`,
   * `/admin/upload-signature`, etc.
   */
  request<T>(
    method: EnvelopeMethod,
    path: string | undefined,
    payload?: Record<string, unknown>,
  ): Observable<T> {
    return this.send<T>(path, method, payload);
  }

  private send<T>(
    path: string | undefined,
    method: EnvelopeMethod,
    payload?: Record<string, unknown>,
  ): Observable<T> {
    if (!path) {
      return throwError(() => new Error('Operación no disponible para este recurso'));
    }
    // Token de la SESIÓN, leído en cada petición (R2.8): no hay credencial
    // fija que inyectar en el arranque.
    const body = { token: this.auth.token(), method, path, payload: payload ?? {} };
    return this.http.post<T>(this.apiUrl, body, { headers: { 'Content-Type': 'text/plain' } }).pipe(
      // Renovación deslizante (§3.2): si el back adjuntó `meta.renewedToken`
      // se adopta YA, con lo que la siguiente petición ya va firmada nueva.
      tap((res) => {
        const renewed = renewedTokenOf(res);
        if (renewed !== null) this.auth.applyRenewedToken(renewed);
      }),
    );
  }

  private withKey(path: string | undefined, key?: string): string | undefined {
    if (!path) {
      return undefined;
    }
    return path.includes('{key}') ? path.replace('{key}', encodeURIComponent(key ?? '')) : path;
  }
}

/** `{ items, nextCursor, total }` (F5/R6.4) → `T[]`; arreglo plano → tal cual; otro ⇒ []. */
function unwrapList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) {
    return raw as T[];
  }
  if (raw !== null && typeof raw === 'object') {
    const items = (raw as { items?: unknown }).items;
    if (Array.isArray(items)) {
      return items as T[];
    }
  }
  return [];
}
