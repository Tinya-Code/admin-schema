import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, UrlTree, provideRouter } from '@angular/router';

import { API_URL } from '../tokens';
import { SESSION_TOKEN_KEY, SESSION_USER_KEY } from '../services/auth.service';
import { authGuard, roleGuard } from './auth.guard';

/**
 * R2.10 — guards de sesión (auth.md §5.3).
 *
 * No son una barrera (el back re-verifica desde R2.6): son el filtro de
 * pantalla. Por eso aquí sólo se comprueba HACIA DÓNDE mandan, no qué
 * protegen.
 */
describe('authGuard / roleGuard — filtro de pantalla (R2.10)', () => {
  afterEach(() => sessionStorage.clear());

  /** `role === null` ⇒ sin sesión: no se siembra nada en el storage. */
  function setup(role: string | null = 'admin') {
    sessionStorage.clear();
    if (role !== null) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, 'tok');
      sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify({ id: 'u_1', role }));
    }

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideRouter([]), { provide: API_URL, useValue: '/api' }],
    });
    return { authGuard, roleGuard, router: TestBed.inject(Router) };
  }

  /** `route` mínimo con un solo parámetro de ruta. */
  function routeWithId(id: string | null): ActivatedRouteSnapshot {
    return {
      paramMap: {
        get: (key: string) => (key === 'id' ? id : null),
      },
    } as unknown as ActivatedRouteSnapshot;
  }

  const isUrlTree = (r: unknown): r is UrlTree => r instanceof UrlTree;

  /**
   * El router invoca un guard DENTRO de un contexto de inyección; una llamada
   * directa desde el spec no lo tiene, y `inject(AuthService)` revienta.
   * `runInInjectionContext` reproducía el contexto real del router.
   */
  function run(guard: typeof authGuard, route: ActivatedRouteSnapshot): boolean | UrlTree {
    const result = TestBed.runInInjectionContext(() => guard(route, {} as never));
    // Los dos guards son síncronos: `MaybeAsync` sólo es ruido de tipos acá.
    return result as boolean | UrlTree;
  }

  it('con sesión deja pasar', () => {
    const { authGuard: guard } = setup();
    expect(run(guard, {} as ActivatedRouteSnapshot)).toBe(true);
  });

  it('sin sesión manda a /login', () => {
    const { authGuard: guard, router } = setup(null);
    const result = run(guard, {} as ActivatedRouteSnapshot);
    expect(isUrlTree(result)).toBe(true);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('sin sesión, un `:id` también manda a /login (redundancia barata)', () => {
    const { roleGuard: guard, router } = setup(null);
    const result = run(guard, routeWithId('orders'));
    expect(isUrlTree(result)).toBe(true);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('un `:id` desconocido deja que responda el back (no inventamos política)', () => {
    const { roleGuard: guard } = setup();
    expect(run(guard, routeWithId('no-existe'))).toBe(true);
  });

  it('una ruta sin `:id` no decide nada', () => {
    const { roleGuard: guard } = setup();
    expect(run(guard, routeWithId(null))).toBe(true);
  });

  it('un recurso sin `access` declarado se ve con sesión', () => {
    const { roleGuard: guard } = setup('staff');
    expect(run(guard, routeWithId('dashboard'))).toBe(true);
  });
});
