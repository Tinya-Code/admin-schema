import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable, throwError } from 'rxjs';

import type { ResourceEndpoints } from '../models/schema.model';
import { API_URL } from '../tokens';

/**
 * CRUD genérico sobre el contrato Opción A (api.md §6):
 * una sola URL + `?path=/…`. `PUT`/`DELETE` se envían como `POST` con el
 * campo `method` en el cuerpo (`{ ...payload, method: 'PUT' }`,
 * `{ method: 'DELETE' }`); el backend extrae `method` y usa el resto como
 * payload.
 *
 * Devuelve el JSON plano tal cual, sin transformaciones ocultas
 * (base.md §1, principio 4). Los errores del backend (200 + `{ error: {…} }`)
 * los convierte en `ApiError` el interceptor `apiErrorInterceptor`.
 */
@Service()
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);

  list<T>(endpoint: ResourceEndpoints): Observable<T[]> {
    return this.send<T[]>(endpoint.list, 'GET');
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
    return this.send<T>(this.withKey(endpoint.update, key), 'POST', {
      ...payload,
      method: 'PUT',
    });
  }

  remove(endpoint: ResourceEndpoints, key?: string): Observable<void> {
    return this.send<void>(this.withKey(endpoint.remove, key), 'POST', {
      method: 'DELETE',
    });
  }

  private send<T>(
    path: string | undefined,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
  ): Observable<T> {
    if (!path) {
      return throwError(() => new Error('Operación no disponible para este recurso'));
    }
    const url = `${this.apiUrl}?path=${encodeURIComponent(path)}`;
    return method === 'GET' ? this.http.get<T>(url) : this.http.post<T>(url, body ?? {});
  }

  private withKey(path: string | undefined, key?: string): string | undefined {
    if (!path) {
      return undefined;
    }
    return path.includes('{key}') ? path.replace('{key}', encodeURIComponent(key ?? '')) : path;
  }
}
