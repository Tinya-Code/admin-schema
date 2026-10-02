import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, signal, type TemplateRef } from '@angular/core';

import type { GroupField } from '../../core/models/schema.model';
import { childTree, type RootTree } from '../field-node';

/**
 * Grupo de campos (base.md §5.4).
 *
 * **Sin importar FieldHost**: los hijos los renderiza el despachador pasando
 * un `ng-template` (`content`) que este componente instancia con
 * `ngTemplateOutlet` en cada variante de chrome. Un import mutuo
 * `field-host ↔ group` rompe en runtime con `Cannot read properties of
 * undefined (reading 'ɵcmp')` y `ng build` NO lo detecta.
 *
 * **Por qué no `<ng-content>`**: con un `<ng-content>` por rama de display,
 * el compilador asigna slot secuencial a cada uno (`generateProjectionDefs`)
 * y el contenido del host cae sólo en el último slot — las ramas
 * `collapsible`/`inline` quedaban vacías. Un solo destino (`TemplateRef`)
 * evita los slots de proyección por completo.
 *
 * Presentaciones:
 * - `card` (por defecto): tarjeta con título.
 * - `collapsible`: `<details>` que se auto-abre si el grupo tiene problemas.
 * - `inline`: sólo la grilla, sin chrome.
 */
@Component({
  selector: 'app-field-group',
  imports: [NgTemplateOutlet],
  template: `
    @if (display() === 'collapsible') {
      <details
        class="rounded-xl border border-neutral/20 bg-white"
        [open]="open() || hasProblem()"
        (toggle)="onToggle($event)"
      >
        <summary
          class="flex cursor-pointer items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold hover:bg-neutral/5"
        >
          <span>
            {{ field().label }}
            @if (field().required) {
              <span class="text-danger" aria-hidden="true">*</span>
            }
          </span>
          @if (hasProblem()) {
            <span class="text-xs font-medium text-danger">Revisar</span>
          }
        </summary>
        <div class="px-4 pb-4">
          <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-12">
            <ng-container [ngTemplateOutlet]="content()" />
          </div>
        </div>
      </details>
    } @else if (display() === 'inline') {
      <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-12">
        <ng-container [ngTemplateOutlet]="content()" />
      </div>
    } @else {
      <section class="rounded-xl border border-neutral/20 bg-white p-4">
        <h2 class="mb-3 text-sm font-semibold">
          {{ field().label }}
          @if (field().required) {
            <span class="text-danger" aria-hidden="true">*</span>
          }
          @if (hasProblem()) {
            <span class="ml-2 text-xs font-medium text-danger">Revisar</span>
          }
        </h2>
        <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-12">
          <ng-container [ngTemplateOutlet]="content()" />
        </div>
      </section>
    }
  `,
})
export class FieldGroup {
  readonly field = input.required<GroupField>();
  readonly tree = input.required<RootTree>();
  /** Errores del backend: detecta rutas anidadas (`address.street`). */
  readonly serverErrors = input<Record<string, string>>({});
  /** Prefijo de ruta del grupo en el registro raíz (`address.`). */
  readonly pathPrefix = input('');
  /** Hijos: `ng-template` declarado en el case de grupo del FieldHost. */
  readonly content = input.required<TemplateRef<unknown>>();

  protected readonly display = computed(() => this.field().display ?? 'card');

  /** Estado del subárbol: `invalid()`/`touched()` agregan a los hijos. */
  private readonly state = computed(() =>
    childTree<Record<string, unknown>>(this.tree(), this.field().key)(),
  );

  protected readonly hasProblem = computed(
    () => (this.state().invalid() && this.state().touched()) || this.hasServerError(),
  );

  /** El usuario abrió/cerró el `<details>` a mano (se persiste en el binding). */
  protected readonly open = signal(false);

  protected onToggle(event: Event): void {
    this.open.set((event.currentTarget as HTMLDetailsElement).open);
  }

  private hasServerError(): boolean {
    const prefix = `${this.pathPrefix()}${this.field().key}.`;
    return Object.keys(this.serverErrors()).some((path) => path.startsWith(prefix));
  }
}
