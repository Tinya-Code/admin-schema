import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { catchError, map, throwError } from 'rxjs';

import { ApiError } from '../models/api.model';
import type { ApiErrorBody } from '../models/api.model';

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
        return throwError(() => new ApiError(err.status, err.message));
      }
      return throwError(() => err);
    }),
  );
