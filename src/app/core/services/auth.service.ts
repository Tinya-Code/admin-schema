import { HttpClient } from '@angular/common/http';
import { computed, inject, Service, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, map, Observable, of, tap } from 'rxjs';

import type { FieldSchema, ResourceSchema } from '../models/schema.model';
import { renewedTokenOf } from '../models/api.model';
import { API_URL } from '../tokens';

/**
 * Sesión del admin (auth.md §5.2) — **única dueña** del token y del usuario.
 *
 * Qué vive acá y por qué:
 *
 *  - **Señales** `user` / `token` / `isAuthenticated` / `role`: el único
 *    estado que el resto de la app lee (guards, menú, interceptor).
 *  - **`login()` / `logout()` / `restore()`**: los tres endpoints de sesión.
 *    El `AuthService` NO inyecta `ApiService` — sólo `HttpClient` — porque
 *    `ApiService` inyecta a éste para leer el token, y un ciclo de DI en
 *    Angular es un error en tiempo de arranque, no un warning.
 *  - **`applyAuthCode()` (R2.9): EL único intérprete de la tabla de §4.5.**
 *    Ningún otro archivo decide qué pasa ante `AUTH_*` o `FORBIDDEN`.
 *  - **Almacenamiento (R2.12): `sessionStorage`, siempre.** `rememberMe`
 *    no puede usar `localStorage` porque D10-3 lo negó — ver más abajo.
 *
 * La sesión arranca desde el storage y `restore()` la revalida contra
 * `/auth/me` en el initializer: un usuario desactivado mientras la pestaña
 * estaba abierta cae al primer reload, no en mitad de una edición.
 */

/** Usuario tal y como lo sirve `publicUser_` (lista blanca, R2.17). */
export interface SessionUser {
  id?: string;
  email?: string;
  name?: string;
  role?: string;
  active?: boolean;
  last_login_at?: string;
  created_at?: string;
}

/** Los cinco códigos de §4.5. El resto de errores no son de sesión. */
export type AuthErrorCode =
  'AUTH_REQUIRED' | 'AUTH_INVALID' | 'AUTH_EXPIRED' | 'FORBIDDEN' | 'RATE_LIMITED';

/** Ruta de login: fuera del shell para que ningún guard la proteja. */
export const LOGIN_PATH = '/login';

/**
 * Claves del `sessionStorage`. Exportadas porque **la sesión se restaura
 * desde ahí en el constructor**: un test que quiera una sesión arrancando
 * tiene que sembrarlas antes de inyectar el servicio, y el que las use con
 * otro nombre quebraría el restore en silencio.
 */
export const SESSION_TOKEN_KEY = 'admin.session.token';
export const SESSION_USER_KEY = 'admin.session.user';

interface LoginResponse {
  token: string;
  user: SessionUser;
}
interface MeResponse {
  user: SessionUser;
}

@Service()
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);
  private readonly router = inject(Router);

  /**
   * D10-3: **sólo `sessionStorage`.** La opción «recordarme» con
   * `localStorage` quedó denegada en §9.3 — muere con la pestaña ⇒ cero
   * token legible por un XSS futuro. `authSchema.rememberMe` es `false`
   * por la misma razón: declarar `true` sería prometer un storage que
   * este servicio no usa.
   *
   * Nunca en la URL ni en el cuerpo de un GET (§5.4): el token sólo viaja
   * dentro del envelope `{ token, method, path, payload }`.
   */
  private readonly storage: Storage = sessionStorage;

  private readonly _user = signal<SessionUser | null>(null);
  private readonly _token = signal<string | null>(null);
  /** Ruta previa a un `AUTH_EXPIRED`, para volver tras reloguear (§4.5). */
  private readonly _returnUrl = signal<string | null>(null);

  readonly user = this._user.asReadonly();
  readonly token = this._token.asReadonly();
  readonly returnUrl = this._returnUrl.asReadonly();
  /** Sólo hay sesión con token Y usuario: uno sin el otro es estado corrupto. */
  readonly isAuthenticated = computed(() => this._token() !== null && this._user() !== null);
  readonly role = computed(() => this._user()?.role ?? '');

  constructor() {
    const token = this.storage.getItem(SESSION_TOKEN_KEY);
    if (token !== null && token !== '') this._token.set(token);
    const raw = this.storage.getItem(SESSION_USER_KEY);
    if (raw !== null && raw !== '') {
      try {
        this._user.set(JSON.parse(raw) as SessionUser);
      } catch {
        // JSON corrupto ⇒ no hay sesión que restaurar; storage sucio.
        this.storage.removeItem(SESSION_USER_KEY);
        this.storage.removeItem(SESSION_TOKEN_KEY);
        this._token.set(null);
      }
    }
  }

  // ── Sesión ───────────────────────────────────────────────────────────────

  login(email: string, password: string): Observable<SessionUser> {
    return this.post<LoginResponse>('/auth/login', { email, password }).pipe(
      map((res) => {
        this.open(res.token, res.user);
        const renewed = renewedTokenOf(res);
        if (renewed !== null) this.applyRenewedToken(renewed);
        return res.user;
      }),
    );
  }

  /**
   * Revocación best-effort (§9.7): se pide al back que ponga el `sid` en la
   * lista de revocados, pero **la sesión local se ciere haya o no respuesta**.
   * Un logout que «falla» por red y deja al usuario dentro es peor que uno
   * que deja una sesión muerta en el servidor.
   */
  logout(): Observable<void> {
    return this.post<{ loggedOut?: boolean }>('/auth/logout').pipe(
      tap({
        next: () => this.clear(),
        error: () => this.clear(),
      }),
      map(() => undefined),
    );
  }

  /** Revalida la sesión restaurada contra `/auth/me`; sin token ⇒ sin viaje. */
  restore(): Observable<void> {
    if (this._token() === null) return of(undefined);
    return this.post<MeResponse>('/auth/me').pipe(
      tap((res) => {
        this.open(this._token(), res.user);
      }),
      // El interceptor ya interpretó el `AUTH_*` (R2.9) antes de llegar
      // acá: esto sólo evita que un fallo rompa el arranque de la app.
      catchError(() => of(undefined)),
      map(() => undefined),
    );
  }

  /**
   * Renovación deslizante (§3.2): el back manda `meta.renewedToken` cuando
   * la vida del token bajó del umbral. Se persiste el MISMO día que el
   * token original — el `sid` no cambia, sólo se emite una firma nueva.
   */
  applyRenewedToken(token: string): void {
    if (token === '' || this._token() === null) return;
    this._token.set(token);
    this.storage.setItem(SESSION_TOKEN_KEY, token);
  }

  // ── R2.9 · la tabla de §4.5, en un solo sitio ───────────────────────────

  /**
   * ÚNICO intérprete de los códigos de sesión (auth.md §4.5 / §5.2).
   * El interceptor `apiErrorInterceptor` lo llama y nada más: cualquier
   * archivo que decida «si ve AUTH_EXPIRED hago X» está fuera de contrato.
   *
   * | Código          | Qué hace                                    |
   * | --------------- | ------------------------------------------- |
   * | `AUTH_REQUIRED` | limpia sesión y va a login                  |
   * | `AUTH_INVALID`  | limpia sesión y va a login                  |
   * | `AUTH_EXPIRED`  | guarda la ruta previa, limpia, va a login   |
   * | `FORBIDDEN`     | **no** cierra sesión (el usuario sigue dentro) |
   * | `RATE_LIMITED`  | no hace nada: lo espera el formulario       |
   */
  applyAuthCode(code: string | undefined): void {
    switch (code) {
      case 'AUTH_EXPIRED':
        // La ruta previa se guarda ANTES de borrar: después de limpiar no
        // queda desde dónde navegar (y `router.url` ya cambió al llegar).
        this._returnUrl.set(this.currentUrl());
        this.clear();
        this.goLogin();
        break;
      case 'AUTH_REQUIRED':
      case 'AUTH_INVALID':
        // «La sesión terminó» — no hay vuelta atrás que conservar.
        this.clear();
        this.goLogin();
        break;
      case 'FORBIDDEN':
      case 'RATE_LIMITED':
        // Decisión explícita de NO tocar la sesión: §4.5 exige que el
        // usuario vea «sin permiso» o «espera» **siguiendo dentro**.
        break;
      default:
        // No es un código de sesión: nada que interpretar.
        break;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** ¿El rol de la sesión cubre `required`? (mínimo: admin ≥ staff, §4.4) */
  hasRole(required: string): boolean {
    if (required === '' || required === 'session') return this.isAuthenticated();
    const role = this.role();
    if (role === 'admin') return true;
    return role !== '' && role === required;
  }

  /**
   * §5.3 — el ÚNICO criterio de visibilidad del front (menú, rutas y
   * botones). `requires` viene del vocabulario de §4.4: `public` no pide
   * sesión; todo lo demás sí; `roles` estrecha.
   *
   * Es **pura decisión de UI**. El back re-verifica `accessLevel` en cada
   * petición (R2.6), así que filtrar acá no protege nada: sólo evita
   * enseñarle a alguien un botón que le va a devolver 403.
   */
  canAccess(access?: { requires?: string; roles?: string[] }): boolean {
    const requires = access?.requires ?? 'session';
    if (requires === 'public') return true;
    if (!this.isAuthenticated()) return false;

    // §4.4 escribe el requerimiento como `role:admin`; §5.3 como
    // `roles: ['admin']`. Se aceptan las dos formas en lugar de elegir una:
    // son el mismo dato visto desde el nivel de acceso y desde el recurso.
    const role = requires.startsWith('role:') ? requires.slice('role:'.length) : '';
    const required = role === '' ? (access?.roles ?? []) : [role];
    if (required.length === 0) return true;
    return required.some((one) => this.hasRole(one));
  }

  // ── R7.5 · Consumo de políticas en UI (F10) ───────────────────────────────

  /**
   * Evalúa si el usuario puede ejecutar una operación específica según
   * `policies.access.operations` del recurso (B8 · R7.4a).
   *
   * El override por operación tiene prioridad sobre el umbral del grupo.
   * Si no hay override, se usa el umbral `policies.access.read` o
   * `policies.access.write` según la operación.
   *
   * Fallback a `permissions` (legacy) si `policies` no existe: mientras
   * los schemas locales no tengan `policies`, se mantiene compatibilidad.
   *
   * Es **pura decisión de UI**. El back vuelve a verificar en cada petición
   * (24-crud), así que esto sólo evita mostrar botones que darían 403.
   */
  canDoOperation(
    schema: ResourceSchema,
    operation: 'list' | 'get' | 'create' | 'update' | 'remove',
  ): boolean {
    // R7.5: intentar policies primero
    const ops = schema.policies?.access?.operations;
    if (ops && ops[operation]) {
      return this.meetsLevel(ops[operation]);
    }

    // Sin override en policies: usar el umbral del grupo
    if (schema.policies?.access) {
      const isWrite = operation === 'create' || operation === 'update' || operation === 'remove';
      const groupLevel = isWrite ? schema.policies.access.write : schema.policies.access.read;
      return this.meetsLevel(groupLevel ?? 'admin');
    }

    // Fallback a permissions (legacy, R7.5 transición)
    const perms = schema.permissions;
    if (perms) {
      const permMap: Record<string, boolean | undefined> = {
        list: true, // list no tiene en permissions, siempre true si no hay policies
        get: true,
        create: perms.create,
        update: perms.update,
        remove: perms.remove,
      };
      return permMap[operation] !== false;
    }

    // Sin policies ni permissions: UX optimista (§5.3 legacy) — el back es
    // la autoridad y responde 403 si el rol no alcanza.
    return true;
  }

  /**
   * Evalúa si el usuario puede leer un campo según `field.access.read`
   * (B8 · R7.4b).
   *
   * Es **pura decisión de UI**. El back vuelve a filtrar la respuesta en
   * cada petición (24-crud), así que esto sólo evita mostrar datos que el
   * usuario no debería ver.
   */
  canReadField(field: FieldSchema): boolean {
    if (!field.access || !field.access.read) return true; // sin restricción ⇒ visible
    return this.meetsLevel(field.access.read);
  }

  /**
   * Evalúa si el usuario puede escribir un campo según `field.access.write`
   * (B8 · R7.4b).
   *
   * Es **pura decisión de UI**. El back rechaza la escritura con 422 si el
   * usuario no tiene permiso, así que esto sólo pone el campo en
   * solo-lectura en el frontend.
   */
  canWriteField(field: FieldSchema): boolean {
    if (!field.access || !field.access.write) return true; // sin restricción ⇒ editable
    return this.meetsLevel(field.access.write);
  }

  /**
   * Verifica si el rol actual cumple un nivel de acceso dado.
   * Usa la misma jerarquía que `ACCESS_ROLE_RANK` del back (11-auth):
   * admin ≥ staff.
   */
  private meetsLevel(level: string): boolean {
    if (level === 'public') return true;
    if (level === 'session') return this.isAuthenticated();
    if (level.startsWith('role:')) {
      const requiredRole = level.slice('role:'.length);
      return this.hasRole(requiredRole);
    }
    // fallback conservador: nivel desconocido ⇒ sólo admin
    return this.hasRole('admin');
  }

  private open(token: string | null, user: SessionUser | null): void {
    if (token !== null && token !== '') this._token.set(token);
    this._user.set(user);
    if (token !== null && token !== '') this.storage.setItem(SESSION_TOKEN_KEY, token);
    if (user !== null) this.storage.setItem(SESSION_USER_KEY, JSON.stringify(user));
  }

  /**
   * Borra token **y** usuario (§5.4) — en ese orden de importancia: un token
   * sin usuario no autentica, pero un usuario sin token engaña al menú.
   */
  /**
   * Ruta previa guardada por un `AUTH_EXPIRED` (§4.5), **consumida**: se
   * devuelve una sola vez y se borra. Sin el consume, cada login futuro
   * volvería a la misma URL vieja aunque el usuario hubiera llegado al
   * login desde el menú.
   */
  consumeReturnUrl(): string | null {
    const url = this._returnUrl();
    this._returnUrl.set(null);
    return url;
  }

  private clear(): void {
    this._token.set(null);
    this._user.set(null);
    this.storage.removeItem(SESSION_TOKEN_KEY);
    this.storage.removeItem(SESSION_USER_KEY);
  }

  private goLogin(): void {
    if (this.currentUrl().startsWith(LOGIN_PATH)) return;
    // Angular rechaza la promesa cuando no hay ruta que empate (NG04002).
    // Navegar es un efecto, no una operación cuyo resultado alguien espere:
    // el catch evita una rejection sin handler en arranques y en tests.
    void this.router.navigate([LOGIN_PATH]).catch(() => undefined);
  }

  private currentUrl(): string {
    return this.router.url;
  }

  private envelope(path: string, payload: Record<string, unknown> = {}) {
    return { token: this._token(), method: 'POST' as const, path, payload };
  }

  /**
   * Mismo transporte que `ApiService` (R2.8): cuerpo JSON con
   * `Content-Type: text/plain` ⇒ **simple request**, sin preflight CORS.
   * Los tres endpoints de sesión pasan por acá — si alguno se saltara el
   * header, el navegador añadiría `application/json` y la llamada empezaría
   * a pedir permiso al servidor con un OPTIONS.
   */
  private post<T>(path: string, payload: Record<string, unknown> = {}): Observable<T> {
    return this.http.post<T>(this.apiUrl, this.envelope(path, payload), {
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
