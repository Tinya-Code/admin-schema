import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { API_URL } from '../tokens';
import { ApiService } from './api.service';
import { SESSION_TOKEN_KEY, SESSION_USER_KEY } from './auth.service';

interface Row {
  slug: string;
}

const ENDPOINTS = { list: '/admin/products' };

describe('ApiService — desarrollo del envelope de listado (F7-3)', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    // La sesión se restaura desde `sessionStorage` (R2.12): sembrarla antes
    // de inyectar es lo mismo que hacer login y recargar la pestaña.
    sessionStorage.setItem(SESSION_TOKEN_KEY, 'tok');
    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify({ id: 'u_1', role: 'admin' }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: API_URL, useValue: '/api' },
      ],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  it('pide POST text/plain con el envelope y desenvuelve { items, total }', async () => {
    const pending = firstValueFrom(api.list<Row>(ENDPOINTS));

    const req = http.expectOne('/api');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Content-Type')).toBe('text/plain');
    expect(req.request.body).toEqual({
      token: 'tok',
      method: 'GET',
      path: '/admin/products',
      payload: {},
    });
    req.flush({ items: [{ slug: 'a' }], total: 1 });

    expect(await pending).toEqual([{ slug: 'a' }]);
  });

  it('el sobre estándar R6.4 { items, nextCursor, total } desenvuelve sólo los items', async () => {
    const pending = firstValueFrom(api.list<Row>(ENDPOINTS));
    http
      .expectOne('/api')
      .flush({ items: [{ slug: 'a' }, { slug: 'b' }], nextCursor: 'eyJ2IjoxLCJvIjoyfQ', total: 7 });
    expect(await pending).toEqual([{ slug: 'a' }, { slug: 'b' }]);
  });

  it('nextCursor null (última página) desenvuelve igual: nadie tiene que comprobarlo', async () => {
    const pending = firstValueFrom(api.list<Row>(ENDPOINTS));
    http.expectOne('/api').flush({ items: [{ slug: 'c' }], nextCursor: null, total: 3 });
    expect(await pending).toEqual([{ slug: 'c' }]);
  });

  it('arreglo plano (contrato histórico, sin envelope) pasa tal cual', async () => {
    const pending = firstValueFrom(api.list<Row>(ENDPOINTS));
    http.expectOne('/api').flush([{ slug: 'b' }]);
    expect(await pending).toEqual([{ slug: 'b' }]);
  });

  it('respuesta inesperada ⇒ lista vacía (defensivo, nunca rompe)', async () => {
    const pending = firstValueFrom(api.list<Row>(ENDPOINTS));
    http.expectOne('/api').flush({ otra_clave: true });
    expect(await pending).toEqual([]);
  });

  it('GET con {key} sustituye el segmento y codifica', async () => {
    const pending = firstValueFrom(
      api.get<Row>({ ...ENDPOINTS, get: '/admin/products/{key}' }, 'a b'),
    );
    const req = http.expectOne('/api');
    expect((req.request.body as { path: string }).path).toBe('/admin/products/a%20b');
    req.flush({ slug: 'a b' });
    expect(await pending).toEqual({ slug: 'a b' });
  });
});
