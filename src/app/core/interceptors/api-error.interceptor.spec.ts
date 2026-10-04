import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ApiError } from '../models/api.model';
import { apiErrorInterceptor } from './api-error.interceptor';

/**
 * Plan 7.3 — mensajes en lenguaje humano (guía §2).
 *
 * Dos canales distintos: el body del backend (que ya escribe en español) y
 * el transporte (red caída, proxy, 5xx), que sin normalizar deja en pantalla
 * el texto crudo de Angular: «Http failure response for http://…».
 */
describe('apiErrorInterceptor — mensajes humanos', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
  });

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
});
