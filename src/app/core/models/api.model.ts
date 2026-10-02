/**
 * Contrato HTTP con el backend (doc/api.md §6 — Opción A, §7).
 *
 * El backend responde SIEMPRE HTTP 200; los errores viajan en el body
 * con `{ error: { status, message } }`. El interceptor (Fase 3) los
 * convierte en `ApiError`.
 */

/** Shape del body de error (api.md §7). */
export interface ApiErrorBody {
  error: {
    status: number;
    message: string;
    /** Ruta del campo afectado cuando el backend la envía (base.md §10). */
    path?: string;
  };
}

/** Error de API estandarizado que lanza el interceptor de errores. */
export class ApiError extends Error {
  readonly status: number;
  /** Ruta del campo que provocó el error (ej. `faq[2].answer`), si existe. */
  readonly fieldPath?: string;

  constructor(status: number, message: string, fieldPath?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldPath = fieldPath;
  }
}
