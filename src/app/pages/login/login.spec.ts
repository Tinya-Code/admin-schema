import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { ApiError } from '@tinya-code/gas-admin-ui';
import { API_URL } from '@tinya-code/gas-admin-ui';
import { AuthService, SESSION_TOKEN_KEY } from '@tinya-code/gas-admin-ui';
import { apiErrorInterceptor } from '@tinya-code/gas-admin-ui';
import { authSchema } from '../../schemas/registry';
import { Login } from '@tinya-code/gas-admin-ui';
import '../../schemas/seed-catalog';

/**
 * Pantalla de login (auth.md §5.1) — R2.11.
 *
 * Se prueba lo que SÓLO la pantalla puede probar: que los campos salen
 * del schema, que no hay casilla «recordarme» (D10-3) y a dónde se va
 * después. El envelope y la tabla de §4.5 ya están cubiertos en
 * `auth.service.spec.ts`.
 */
describe('Login — pantalla declarada por authSchema (R2.11)', () => {
  let http: HttpTestingController;
  let navigateTo: ReturnType<typeof vi.spyOn>;

  async function render() {
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: API_URL, useValue: '/api' },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    fixture.detectChanges();

    http = TestBed.inject(HttpTestingController);
    navigateTo = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    return fixture;
  }

  afterEach(() => {
    http?.verify();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  const inputs = (fixture: { nativeElement: HTMLElement }) =>
    Array.from(fixture.nativeElement.querySelectorAll('input'));

  it('pinta exactamente los campos que declara el schema', async () => {
    const fixture = await render();
    const fields = inputs(fixture);
    expect(fields.map((i) => i.getAttribute('name'))).toEqual(
      authSchema.loginFields.map((f) => f.key),
    );
    expect(fields.map((i) => i.getAttribute('type'))).toEqual(['email', 'password']);
    // Sólo los campos declarados: ni honeypot, ni «recordarme» (D10-3).
    expect(fields).toHaveLength(authSchema.loginFields.length);
    expect(fixture.nativeElement.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('submit vacío no manda la petición y explica el motivo', async () => {
    const fixture = await render();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    http.expectNone('/api');
    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Completa el correo y la contraseña.');
  });

  it('login OK → envelope correcto, sesión abierta y destino declarado', async () => {
    const fixture = await render();
    const [email, password] = inputs(fixture);
    email.value = 'ana@x.com';
    email.dispatchEvent(new Event('input'));
    password.value = 'secreta';
    password.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));

    const req = http.expectOne('/api');
    expect(req.request.body).toEqual({
      token: null,
      method: 'POST',
      path: '/auth/login',
      payload: { email: 'ana@x.com', password: 'secreta' },
    });
    req.flush({ token: 'tok-nuevo', user: { id: 'u_1', role: 'admin' } });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBe('tok-nuevo');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
    expect(navigateTo).toHaveBeenCalledWith(authSchema.redirectAfterLogin);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('si hay una ruta previa guardada, vuelve a ella y no al destino por defecto', async () => {
    const fixture = await render();
    const auth = TestBed.inject(AuthService);
    auth.applyAuthCode('AUTH_EXPIRED'); // deja `returnUrl` y cierra la sesión

    const [email, password] = inputs(fixture);
    email.value = 'ana@x.com';
    email.dispatchEvent(new Event('input'));
    password.value = 'secreta';
    password.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));

    http.expectOne('/api').flush({ token: 'tok', user: { id: 'u_1', role: 'admin' } });
    await fixture.whenStable();

    expect(navigateTo).toHaveBeenCalledWith('/');
    // Consume: un segundo login no vuelve a la misma URL vieja.
    expect(auth.consumeReturnUrl()).toBeNull();
  });

  it('credenciales malas → mensaje del backend y la sesión queda CERRADA', async () => {
    const fixture = await render();
    const [email, password] = inputs(fixture);
    email.value = 'ana@x.com';
    email.dispatchEvent(new Event('input'));
    password.value = 'mala';
    password.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));

    http
      .expectOne('/api')
      .flush({ error: { status: 401, message: 'Credenciales inválidas', code: 'AUTH_INVALID' } });
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Credenciales inválidas');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    // Lo que NO debe pasar es que entre al admin. (Un `AUTH_INVALID`
    // sí dispara `goLogin`; acá no se llega a `/login` porque el router
    // de prueba no tiene esa ruta, pero esa llamada es correcta: §4.5.)
    expect(navigateTo).not.toHaveBeenCalledWith(authSchema.redirectAfterLogin);
  });

  it('un error de red no deja el botón colgado ni inventa un mensaje', async () => {
    const fixture = await render();
    const [email, password] = inputs(fixture);
    email.value = 'ana@x.com';
    email.dispatchEvent(new Event('input'));
    password.value = 'secreta';
    password.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));

    http.expectOne('/api').error(new ErrorEvent('error'));
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
  });
});
