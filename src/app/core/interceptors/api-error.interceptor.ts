import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { catchError, map, throwError } from 'rxjs';

import { ApiError } from '../models/api.model';
import type { ApiErrorBody } from '../models/api.model';

/**
 * Mensaje humano para un error HTTP real (§2).
 *
 * El backend siempre responde 200 con el error dentro del body —eso ya
 * viene en español—, así que esto sólo cubre lo que el transporte falla:
 * red caída, proxy y 5xx. Sin esto el usuario ve el texto crudo de Angular
 * («Http failure response for http://…»), que es inglés técnico.
 */
function httpMessage(status: number): string {
  switch (status) {
    case 0:
      return 'No se pudo conectar con el servidor. Revisa tu conexión.';
    case 401:
      return 'Tu sesión ha expirado. Vuelve a iniciar sesión.';
    case 403:
      return 'No tienes permisos para realizar esta acción.';
    case 404:
      return 'No se encontró el recurso solicitado.';
    case 409:
      return 'El registro cambió o ya existe. Recarga la página y vuelve a intentarlo.';
    case 413:
      return 'El archivo es demasiado grande.';
    case 422:
      return 'Los datos enviados no son válidos.';
    default:
      if (status >= 500) {
        return 'El servidor tuvo un problema. Vuelve a intentarlo en unos segundos.';
      }
      return status >= 400 ? 'No se pudo completar la operación.' : 'Error inesperado.';
  }
}

function isErrorBody(body: unknown): body is ApiErrorBody {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const error = (body as ApiErrorBody).error;
  return typeof error === 'object' && error !== null && typeof error.message === 'string';
}

/**
 * El backend responde SIEMPRE HTTP 200 y pone los errores en el body
 * (api.md §7), así que se detectan en el canal de **éxito** y se relanzan
 * como `ApiError` (con `fieldPath` cuando el backend envía `path`).
 * Los errores HTTP reales (red caída, proxy) también se normalizan.
 */
export const apiErrorInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    map((event) => {
      if (event instanceof HttpResponse && isErrorBody(event.body)) {
        const { status, message, path } = event.body.error;
        throw new ApiError(status, message, path);
      }
      return event;
    }),
    catchError((err: unknown) => {
      if (err instanceof ApiError) {
        return throwError(() => err);
      }
      if (err instanceof HttpErrorResponse) {
        return throwError(() => new ApiError(err.status, httpMessage(err.status)));
      }
      return throwError(() => err);
    }),
  );
