/**
 * Contrato HTTP con el backend (doc/baseapi.md §8 «Errores»).
 *
 * El backend responde SIEMPRE HTTP 200; los errores viajan en el body
 * con `{ error: { status, message, errors?: [{ path, message }] } }`.
 * El interceptor (Fase 3) los convierte en `ApiError`.
 */

/** Shape del body de error (doc/baseapi.md §8 «Errores»). */
export interface ApiErrorBody {
  error: {
    status: number;
    message: string;
    /** Ruta del campo afectado cuando el backend la envía (base.md §10). */
    path?: string;
    /**
     * Código de sesión de §4.5 (R2.9): `AUTH_REQUIRED` · `AUTH_INVALID` ·
     * `AUTH_EXPIRED` · `FORBIDDEN` · `RATE_LIMITED`. Aparece SÓLO en esas
     * cinco respuestas — el sobre de error es aditivo (O7 / D10-5).
     */
    code?: string;
  };
}

/** Error de API estandarizado que lanza el interceptor de errores. */
export class ApiError extends Error {
  readonly status: number;
  /** Ruta del campo que provocó el error (ej. `faq[2].answer`), si existe. */
  readonly fieldPath?: string;
  /** Código de sesión de §4.5 si el backend lo envió; `undefined` en el resto. */
  readonly code?: string;

  constructor(status: number, message: string, fieldPath?: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldPath = fieldPath;
    this.code = code;
  }
}

/**
 * `meta.renewedToken` (auth.md §3.2/§3.4): el back lo adjunta a la respuesta
 * cuando la vida del token bajó del umbral de renovación. Es el ÚNICO modo
 * de que el front se entere — el token nuevo no viaja en cabeceras ni en la
 * URL. Devuelve `null` cuando no hay renovación (que es lo normal).
 *
 * Vive acá y no en el `ApiService` porque lo consumen DOS servicios
 * (`ApiService` y `AuthService`) y éste modelo no importa a ninguno de los
 * dos: sin este archivo no hay ciclo de imports.
 */
export function renewedTokenOf(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const meta = (body as { meta?: unknown }).meta;
  if (meta === null || typeof meta !== 'object') return null;
  const token = (meta as { renewedToken?: unknown }).renewedToken;
  return typeof token === 'string' && token !== '' ? token : null;
}
