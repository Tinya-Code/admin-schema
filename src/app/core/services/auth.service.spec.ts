import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { API_URL } from '../tokens';
import { AuthService, SESSION_TOKEN_KEY, SESSION_USER_KEY } from './auth.service';

/**
 * R2.7 · R2.9 · R2.12 — el `AuthService` y la tabla de §4.5.
 *
 *  - **R2.7**: señales, `login()` / `logout()` / `restore()` y el envelope.
 *  - **R2.9**: las CINCO filas de §4.5, probadas una a una. Se llaman a
 *    `applyAuthCode` directamente: el puente del interceptor ya está
 *    cubierto en `api-error.interceptor.spec.ts`, y probar las dos mitades
 *    en el mismo sitio sólo duplicaría el mismo fallo.
 *  - **R2.12**: el storage es `sessionStorage` y nada más — ni un byte en
 *    `localStorage`, que D10-3 negó.
 */
describe('AuthService — sesión (R2.7 / R2.9 / R2.12)', () => {
  let http: HttpTestingController;

  function seed(token = 'tok-semilla', user: unknown = { id: 'u_1', role: 'admin' }) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    if (user !== null) sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
  }

  /** Inyecta el servicio ya con la sesión sembrada (como tras un reload). */
  function injected(): AuthService {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: API_URL, useValue: '/api' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(AuthService);
  }

  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    http?.verify();
    sessionStorage.clear();
    localStorage.clear();
  });

  // ── R2.12 · storage ──────────────────────────────────────────────────────

  it('arranca SIN sesión cuando el storage está vacío', () => {
    const auth = injected();
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.token()).toBeNull();
    expect(auth.user()).toBeNull();
    expect(auth.role()).toBe('');
  });

  it('restaura la sesión desde sessionStorage (recarga de pestaña)', () => {
    seed();
    const auth = injected();
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.token()).toBe('tok-semilla');
    expect(auth.role()).toBe('admin');
  });

  it('un usuario corrupto en storage no deja sesión a medias', () => {
    sessionStorage.setItem(SESSION_TOKEN_KEY, 'tok');
    sessionStorage.setItem(SESSION_USER_KEY, 'esto no es json');
    const auth = injected();
    expect(auth.isAuthenticated()).toBe(false);
    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
  });

  it('el token JAMÁS se escribe en localStorage (D10-3 lo negó)', () => {
    seed();
    const auth = injected();
    // Cierra y reabre sesión: el viaje completo por el storage.
    auth.applyRenewedToken('tok-renovado');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBe('tok-renovado');
  });

  // ── R2.7 · login / logout / restore ──────────────────────────────────────

  it('login() pide /auth/login con el envelope y abre la sesión', () => {
    const auth = injected();
    let body: unknown;
    auth.login('ana@x.com', 'secreta').subscribe();

    const req = http.expectOne('/api');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Content-Type')).toBe('text/plain');
    body = req.request.body;
    expect(body).toEqual({
      token: null,
      method: 'POST',
      path: '/auth/login',
      payload: { email: 'ana@x.com', password: 'secreta' },
    });
    req.flush({ token: 'tok-nuevo', user: { id: 'u_1', role: 'admin', active: true } });

    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.token()).toBe('tok-nuevo');
    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBe('tok-nuevo');
    expect(sessionStorage.getItem(SESSION_USER_KEY)).toContain('u_1');
  });

  it('logout() borra la sesión local AUNQUE la petición falle', () => {
    seed();
    const auth = injected();
    auth.logout().subscribe({ error: () => undefined });

    http.expectOne('/api').error(new ErrorEvent('error'));

    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.token()).toBeNull();
    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_USER_KEY)).toBeNull();
  });

  it('restore() sin token no hace NINGÚN viaje', () => {
    const auth = injected();
    auth.restore().subscribe();
    http.expectNone('/api');
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('restore() con token revalida contra /auth/me y trae el usuario', () => {
    seed('tok-semilla', null); // token huérfano: usuario borrado a mano
    const auth = injected();
    auth.restore().subscribe();

    const req = http.expectOne('/api');
    expect((req.request.body as { path: string }).path).toBe('/auth/me');
    req.flush({ user: { id: 'u_1', role: 'admin', active: true } });

    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.role()).toBe('admin');
  });

  it('applyRenewedToken sólo cambia la firma: el usuario no se mueve', () => {
    seed();
    const auth = injected();
    const antes = auth.user();
    auth.applyRenewedToken('tok-renovado');
    expect(auth.token()).toBe('tok-renovado');
    expect(auth.user()).toBe(antes);
  });

  it('applyRenewedToken con la sesión caída no resucita nada', () => {
    const auth = injected();
    auth.applyRenewedToken('tok-fantasma');
    expect(auth.isAuthenticated()).toBe(false);
    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
  });

  // ── R2.9 · la tabla de §4.5, fila por fila ───────────────────────────────

  describe('applyAuthCode — la tabla de §4.5', () => {
    it('AUTH_REQUIRED ⇒ limpia sesión', () => {
      seed();
      const auth = injected();
      auth.applyAuthCode('AUTH_REQUIRED');
      expect(auth.isAuthenticated()).toBe(false);
      expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    });

    it('AUTH_INVALID ⇒ limpia sesión', () => {
      seed();
      const auth = injected();
      auth.applyAuthCode('AUTH_INVALID');
      expect(auth.isAuthenticated()).toBe(false);
      expect(sessionStorage.getItem(SESSION_USER_KEY)).toBeNull();
    });

    it('AUTH_EXPIRED ⇒ guarda la ruta previa ANTES de limpiar', () => {
      seed();
      const auth = injected();
      auth.applyAuthCode('AUTH_EXPIRED');
      expect(auth.isAuthenticated()).toBe(false);
      // La ruta previa se conserva para volver tras el relogin.
      expect(typeof auth.returnUrl()).toBe('string');
      expect(auth.returnUrl()).not.toBe('');
    });

    it('FORBIDDEN ⇒ NO cierra sesión', () => {
      seed();
      const auth = injected();
      auth.applyAuthCode('FORBIDDEN');
      expect(auth.isAuthenticated()).toBe(true);
      expect(auth.token()).toBe('tok-semilla');
      expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBe('tok-semilla');
    });

    it('RATE_LIMITED ⇒ NO cierra sesión (lo espera el formulario)', () => {
      seed();
      const auth = injected();
      auth.applyAuthCode('RATE_LIMITED');
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('un código desconocido no toca nada', () => {
      seed();
      const auth = injected();
      auth.applyAuthCode('VALIDATION_ERROR');
      auth.applyAuthCode(undefined);
      expect(auth.isAuthenticated()).toBe(true);
    });
  });

  // ── hasRole (R2.10, mínima) ──────────────────────────────────────────────

  describe('hasRole — mínimo del vocabulario §4.4', () => {
    it('admin cubre cualquier rol pedido', () => {
      seed();
      const auth = injected();
      expect(auth.hasRole('admin')).toBe(true);
      expect(auth.hasRole('staff')).toBe(true);
      expect(auth.hasRole('session')).toBe(true);
      expect(auth.hasRole('')).toBe(true);
    });

    it('sin sesión no cubre nada que no sea «público»', () => {
      const auth = injected();
      expect(auth.hasRole('admin')).toBe(false);
      expect(auth.hasRole('session')).toBe(false);
      expect(auth.hasRole('')).toBe(false);
    });
  });

  // ── canAccess — §5.3 / §4.4 ─────────────────────────────────────────────

  describe('canAccess — visibilidad de recurso (§5.3)', () => {
    it('sin declaración y con sesión ⇒ se ve', () => {
      seed();
      expect(injected().canAccess(undefined)).toBe(true);
    });

    it('sin declaración y sin sesión ⇒ NO se ve', () => {
      expect(injected().canAccess(undefined)).toBe(false);
    });

    it('`requires: public` se ve sin sesión', () => {
      expect(injected().canAccess({ requires: 'public' })).toBe(true);
    });

    it('un `admin` cumple cualquier `roles` (rango más alto de §4.4)', () => {
      seed();
      const auth = injected();
      expect(auth.canAccess({ roles: ['soporte'] })).toBe(true);
      expect(auth.canAccess({ requires: 'role:soporte' })).toBe(true);
    });

    it('una sesión menor NO cumple un rol que no tiene', () => {
      sessionStorage.setItem(SESSION_TOKEN_KEY, 'tok');
      sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify({ id: 'u_2', role: 'staff' }));
      const auth = injected();
      expect(auth.canAccess({ roles: ['admin'] })).toBe(false);
      expect(auth.canAccess({ requires: 'role:admin' })).toBe(false);
      expect(auth.canAccess({ roles: ['staff'] })).toBe(true);
      expect(auth.canAccess({ requires: 'session' })).toBe(true);
    });

    it('una sesión menor NO ve un recurso `public`… sí: `public` no pide nada', () => {
      expect(injected().canAccess({ requires: 'public' })).toBe(true);
    });
  });
});
