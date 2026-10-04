import { Component, computed, input, signal } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { SelectField, SelectOption } from '../../core/models/schema.model';
import { FieldAria } from '../field-aria';
import { childTree, type RootTree } from '../field-node';

/** Desplegable de un solo valor (base.md §5.1). */
@Component({
  selector: 'app-field-select',
  imports: [FieldAria, FormField],
  template: `
    @if (useSearch()) {
      <!-- Guía §1: más de 7 opciones → dropdown con búsqueda. Se filtra el
           select nativo en vez de construir un combobox: el teclado, el
           anuncio de la opción activa y el valor elegido siguen siendo los
           del navegador. -->
      <input
        type="search"
        class="mb-1 w-full rounded-lg border border-neutral/30 bg-surface px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        placeholder="Buscar…"
        aria-label="Buscar entre las opciones"
        [attr.aria-controls]="state().name()"
        [value]="query()"
        (input)="onQuery($event)"
      />
    }
    <select class="field-input" [id]="state().name()" [formField]="node()">
      @if (!field().required) {
        <option value="">{{ field().placeholder ?? '— Seleccionar —' }}</option>
      }
      @for (option of visibleOptions(); track option.value) {
        <option [value]="option.value" [disabled]="option.disabled ?? false">
          {{ option.label }}
        </option>
      }
    </select>
    @if (noMatches()) {
      <p class="mt-1 text-xs text-neutral" role="status">Sin resultados para «{{ query() }}».</p>
    }
  `,
})
export class FieldSelect {
  readonly field = input.required<SelectField>();
  readonly tree = input.required<RootTree>();

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  /** Texto escrito en el buscador (sólo se usa si supera el umbral). */
  protected readonly query = signal('');

  /** Umbral de la guía §1: 5–7 opciones dropdown simple, más de 7 con búsqueda. */
  protected readonly useSearch = computed(() => this.field().options.length > 7);

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /**
   * Opciones que coinciden con el término, SIN conservar la elegida: es la
   * base del mensaje «Sin resultados».
   */
  protected readonly matches = computed<SelectOption[]>(() => {
    const all = this.field().options;
    const term = this.query().trim().toLowerCase();
    if (term === '') {
      return all;
    }
    return all.filter((option) => option.label.toLowerCase().includes(term));
  });

  /** El buscador está activo y no encontró nada nuevo (el elegido no cuenta). */
  protected readonly noMatches = computed(
    () => this.useSearch() && this.query().trim() !== '' && this.matches().length === 0,
  );

  /**
   * Opciones que se dibujan. Con búsqueda activa se acotan por etiqueta, pero
   * la opción elegida se conserva siempre aunque no coincida con el término:
   * si desapareciera del DOM, el select dejaría de mostrar el valor actual
   * (guía §1: «valor seleccionado siempre visible»).
   */
  protected readonly visibleOptions = computed<SelectOption[]>(() => {
    const filtered = this.matches();
    if (this.query().trim() === '') {
      return filtered;
    }
    const selected = String(this.state().value() ?? '');
    if (filtered.some((option) => option.value === selected)) {
      return filtered;
    }
    const kept = this.field().options.find((option) => option.value === selected);
    return kept === undefined ? filtered : [...filtered, kept];
  });
}
