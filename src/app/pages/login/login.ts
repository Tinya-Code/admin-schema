import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ApiError } from '../../core/models/api.model';
import { AuthService, LOGIN_PATH } from '../../core/services/auth.service';
import { Button } from '../../shared/components/button/button';
import { authSchema } from '../../schemas/registry';

/** Copy de las etiquetas — vive acá, no en el schema: una sola pantalla. */
const LABELS: Record<string, string> = {
  email: 'Correo electrónico',
  password: 'Contraseña',
};

const FIELD_BASE =
  'mt-1 w-full rounded-lg border border-neutral/40 bg-surface px-3 py-2 text-sm text-neutral placeholder:text-neutral/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Login (auth.md §5.1).
 *
 * **Pintada a partir de `authSchema.loginFields`**: si mañana cambian los
 * campos, éste componente no se toca — sólo se mueven claves y etiquetas.
 * No usa `FieldHost` porque el tipo `password` todavía no existe en
 * `FieldSchema` (es pieza nueva de Fase 3, R3.3); el `@switch` de abajo es
 * exactamente el reemplazo que R3.x hará por el registro de render.
 *
 * **No hay casilla «recordarme»**: D10-3 negó `localStorage` (§9.3) y el
 * token muere con la pestaña. Poner un checkbox sería prometer que la
 * sesión sobrevive a cerrar el navegador.
 */
@Component({
  selector: 'app-login',
  imports: [Button],
  template: `
    <main class="flex min-h-[100svh] items-center justify-center bg-surface px-4">
      <div
        class="w-full max-w-sm rounded-xl border border-neutral/20 bg-surface-raised p-8 shadow-sm"
      >
        <h1 class="font-display text-lg font-semibold">Admin</h1>
        <p class="mt-1 text-sm text-neutral">Inicia sesión para continuar</p>

        <form class="mt-6 space-y-4" (submit)="submit($event)" novalidate>
          @for (field of schema.loginFields; track field.key) {
            <div>
              <label [attr.for]="field.key" class="block text-sm font-medium text-neutral">
                {{ label(field.key) }}
              </label>

              @switch (field.type) {
                @case ('email') {
                  <input
                    [attr.id]="field.key"
                    [attr.name]="field.key"
                    type="email"
                    autocomplete="email"
                    inputmode="email"
                    [attr.required]="field.required ? '' : null"
                    [value]="value(field.key)"
                    (input)="setValue(field.key, $any($event.target).value)"
                    class="${FIELD_BASE}"
                  />
                }
                @default {
                  <input
                    [attr.id]="field.key"
                    [attr.name]="field.key"
                    type="password"
                    autocomplete="current-password"
                    [attr.required]="field.required ? '' : null"
                    [value]="value(field.key)"
                    (input)="setValue(field.key, $any($event.target).value)"
                    class="${FIELD_BASE}"
                  />
                }
              }
            </div>
          }

          @if (error(); as message) {
            <p role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {{ message }}
            </p>
          }

          <button app-button type="submit" [loading]="loading()" class="w-full">
            Iniciar sesión
          </button>
        </form>
      </div>
    </main>
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly schema = authSchema;
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);

  /** Valores por clave: el set lo pinta el `@for` del schema. */
  private readonly values = signal<Record<string, string>>({});

  label(key: string): string {
    return LABELS[key] ?? key;
  }

  value(key: string): string {
    return this.values()[key] ?? '';
  }

  setValue(key: string, next: string): void {
    this.values.update((current) => ({ ...current, [key]: next }));
  }

  submit(event: Event): void {
    event.preventDefault();
    if (this.loading()) return;

    const email = this.value('email').trim();
    const password = this.value('password');
    if (email === '' || password === '') {
      this.error.set('Completa el correo y la contraseña.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.auth.login(email, password).subscribe({
      next: () => {
        this.loading.set(false);
        this.goAfterLogin();
      },
      error: (err: unknown) => {
        this.loading.set(false);
        // El mensaje del backend ya viene en español y ya describe el
        // caso («credenciales inválidas»): reformatearlo acá sólo
        // duplicaría la verdad y se perdería si cambia el texto del back.
        this.error.set(
          err instanceof ApiError && err.message !== ''
            ? err.message
            : 'No se pudo iniciar sesión.',
        );
      },
    });
  }

  private goAfterLogin(): void {
    const previous = this.auth.consumeReturnUrl();
    const target =
      previous !== null && previous !== '' && !previous.startsWith(LOGIN_PATH)
        ? previous
        : authSchema.redirectAfterLogin;
    void this.router.navigateByUrl(target).catch(() => undefined);
  }
}
