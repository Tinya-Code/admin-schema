import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ApiError } from '../models/api.model';
import { API_URL } from '../tokens';
import { AuthService, SESSION_TOKEN_KEY, SESSION_USER_KEY } from '../services/auth.service';
import { apiErrorInterceptor } from './api-error.interceptor';

/**
 * Emite `body` en el canal de éxito (el backend responde 200 con el error
 * dentro) y devuelve el `ApiError` que el interceptor lanzó.
 * A nivel de módulo: lo usan el describe de mensajes y el de R2.9.
 */
function errorFromBody(body: object): ApiError {
  const http = TestBed.inject(HttpClient);
  const mock = TestBed.inject(HttpTestingController);
  let lanzado: unknown;
  http.get('/recursos').subscribe({
    error: (e: unknown) => {
      lanzado = e;
    },
  });
  mock.expectOne('/recursos').flush(body);
  mock.verify();
  return lanzado as ApiError;
}

/**
 * Plan 7.3 — mensajes en lenguaje humano (guía §2).
 *
 * Dos canales distintos: el body del backend (que ya escribe en español) y
 * el transporte (red caída, proxy, 5xx), que sin normalizar deja en pantalla
 * el texto crudo de Angular: «Http failure response for http://…».
 *
 * **R2.9** — desde que el interceptor entrega los `AUTH_*` a
 * `AuthService.applyAuthCode`, necesita poder inyectarlo: por eso acá hay
 * router y `API_URL`, que son las dependencias de ese servicio.
 */
describe('apiErrorInterceptor — mensajes humanos', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: API_URL, useValue: '/api' },
      ],
    });
  });

  afterEach(() => sessionStorage.clear());

  function failWith(status: number, body?: unknown): string {
    const http = TestBed.inject(HttpClient);
    const mock = TestBed.inject(HttpTestingController);
    let message = '';
    http.get('/recursos').subscribe({
      error: (error: unknown) => {
        message = error instanceof ApiError ? error.message : String(error);
      },
    });
    const request = mock.expectOne('/recursos');
    if (status === 0) {
      // Red caída: el backend no llegó a responder.
      request.error(new ErrorEvent('error'));
    } else {
      // `flush` con status fuera de 2xx materializa un `HttpErrorResponse`.
      request.flush(body ?? '', { status, statusText: 'ERR' });
    }
    mock.verify();
    return message;
  }

  it('un 5xx se explica en español, no con el texto crudo de Angular', () => {
    expect(failWith(500)).toBe(
      'El servidor tuvo un problema. Vuelve a intentarlo en unos segundos.',
    );
  });

  it('la red caída (status 0) dice que no hubo conexión', () => {
    expect(failWith(0)).toBe('No se pudo conectar con el servidor. Revisa tu conexión.');
  });

  it('un 403 habla de permisos', () => {
    expect(failWith(403)).toBe('No tienes permisos para realizar esta acción.');
  });

  it('conserva el mensaje del backend cuando viene en el body (canal de éxito)', () => {
    expect(
      failWith(200, {
        error: { status: 422, message: 'Ya existe un registro con este valor', path: 'name' },
      }),
    ).toBe('Ya existe un registro con este valor');
  });

  /**
   * D42 — el422 manda sus rutas en `error.errors[]`, NO en `path`: sin
   * modelar esa lista el form veía «Errores de validación» y no pintaba
   * ningún campo (base.md §5, guía §10).
   */
  it('conserva errors[] completo (path, message, code) en el ApiError', () => {
    const error = errorFromBody({
      error: {
        status: 422,
        message: 'Errores de validación',
        errors: [
          {
            path: 'sku',
            message: 'Debe tener al menos 5 caracteres.',
            code: 'VALIDATION_MIN_LENGTH',
          },
          { path: 'faq[2].answer', message: 'Campo obligatorio.', code: 'VALIDATION_REQUIRED' },
        ],
      },
    });
    expect(error.status).toBe(422);
    expect(error.message).toBe('Errores de validación');
    expect(error.issues).toEqual([
      { path: 'sku', message: 'Debe tener al menos 5 caracteres.', code: 'VALIDATION_MIN_LENGTH' },
      { path: 'faq[2].answer', message: 'Campo obligatorio.', code: 'VALIDATION_REQUIRED' },
    ]);
    // Sin `path` en el sobre no hay fieldPath: las rutas vienen en los issues.
    expect(error.fieldPath).toBeUndefined();
  });
});

/**
 * R2.9 — éste es el ÚNICO puente entre el sobre de error y la tabla de
 * §4.5. Si el interceptor dejara de llamar a `applyAuthCode`, el front se
 * quedaría en una pantalla caducada sin reloguear: por eso el puente se
 * prueba acá y las cinco filas de la tabla, en `auth.service.spec.ts`.
 */
describe('apiErrorInterceptor — entrega de los códigos de sesión (R2.9)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem(SESSION_TOKEN_KEY, 'tok-vigente');
    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify({ id: 'u_1', role: 'admin' }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: API_URL, useValue: '/api' },
      ],
    });
  });

  afterEach(() => sessionStorage.clear());

  it('conserva el `code` en el ApiError que recibe el llamador', () => {
    const error = errorFromBody({
      error: { status: 401, message: 'No autorizado', code: 'AUTH_EXPIRED' },
    });
    expect(error.code).toBe('AUTH_EXPIRED');
    expect(error.status).toBe(401);
  });

  it('un error SIN código de sesión no toca la sesión', () => {
    errorFromBody({ error: { status: 422, message: 'Datos no válidos', path: 'name' } });
    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBe('tok-vigente');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
  });

  it('FORBIDDEN deja al usuario DENTRO de la sesión (§4.5)', () => {
    errorFromBody({ error: { status: 403, message: 'Prohibido', code: 'FORBIDDEN' } });
    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBe('tok-vigente');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
  });

  it('AUTH_INVALID borra token y usuario ANTES de nada más (§5.4)', () => {
    errorFromBody({ error: { status: 401, message: 'No autorizado', code: 'AUTH_INVALID' } });
    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_USER_KEY)).toBeNull();
    const auth = TestBed.inject(AuthService);
    expect(auth.token()).toBeNull();
    expect(auth.user()).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
  });
});
