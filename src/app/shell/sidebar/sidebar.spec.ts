import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { API_URL } from '@tinya-code/gas-admin-ui';
import { SESSION_TOKEN_KEY, SESSION_USER_KEY } from '@tinya-code/gas-admin-ui';
import { allSchemas } from '../../schemas/registry';
import { Sidebar } from '@tinya-code/gas-admin-ui';
import '../../schemas/seed-catalog';

/**
 * El menú se dibuja sólo con sesión (auth.md §5.3): `authGuard` no deja
 * entrar al shell sin ella, así que sembrar la sesión en el arranque es
 * exactamente el estado en que este componente se ejecuta.
 */
describe('Sidebar — menú desde el catálogo estático', () => {
  afterEach(() => sessionStorage.clear());

  async function render(role = 'admin'): Promise<HTMLElement> {
    sessionStorage.setItem(SESSION_TOKEN_KEY, 'tok-semilla');
    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify({ id: 'u_1', role }));

    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter([]), provideHttpClient(), { provide: API_URL, useValue: '/api' }],
    }).compileComponents();

    const fixture = TestBed.createComponent(Sidebar);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const hrefs = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('nav a')).map((a) => a.getAttribute('href'));

  it('lista los recursos del catálogo, en orden, con sus hrefs', async () => {
    const root = await render();
    expect(Array.from(root.querySelectorAll('nav a')).map((a) => a.textContent?.trim())).toEqual([
      'Dashboard',
      'Categorías',
      'Productos',
      'Pedidos',
      'Configuración PickPass',
      'Sitio',
      'Legal',
      'Usuarios', // R7.6: recurso users, sólo audiencia admin
    ]);
    expect(hrefs(root)).toEqual([
      '/dashboard',
      '/categories',
      '/products',
      '/orders',
      '/pickpass',
      '/site',
      '/legal',
      '/users',
    ]);
  });

  /**
   * R2.10 — el filtro por `access` (§5.3).
   *
   * Hoy ningún schema lo declara porque sólo existe `admin` (§9.4), y con
   * `admin` nada se oculta: `hasRole` le da el rango más alto de §4.4. Por
   * eso la prueba usa **doble de sesión `staff`** (rol reservado) y declara
   * en `orders` exactamente lo que se declararía cuando ese rol exista. La
   * declaración se aplica ANTES de renderizar: mutar un objeto plano no
   * empuja ninguna señal, así que hacerlo después no reevaluaría el
   * `computed`.
   */
  it('oculta los recursos cuyo `access` la sesión no cumple', async () => {
    const target = allSchemas().find((schema) => schema.id === 'orders');
    expect(target).toBeDefined();
    const originalAccess = target!.access;
    target!.access = { requires: 'session', roles: ['admin'] };

    try {
      const root = await render('staff');
      expect(hrefs(root)).toContain('/dashboard');
      expect(hrefs(root)).not.toContain('/orders');
      expect(hrefs(root)).toHaveLength(6);
    } finally {
      target!.access = originalAccess;
    }
  });
});
