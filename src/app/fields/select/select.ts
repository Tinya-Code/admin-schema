import { Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { SelectField, SelectOption } from '../../core/models/schema.model';
import { DataSourceService, dataSourceKey } from '../../core/services/data-source.service';
import { optionsFromRows } from '../../core/utils/source-options';
import { getSchema } from '../../schemas/registry';
import { FieldAria } from '../field-aria';
import { childTree, type RootTree } from '../field-node';

/**
 * Desplegable de un solo valor (base.md §5.1).
 *
 * Sus opciones se declaran de dos formas y **exactamente una** (XOR, D62):
 * `options` estáticas en el schema o `source` — una fuente declarada que
 * pide `DataSourceService` con la misma caché que usan las relaciones y los
 * widgets (F8 · R6.5). Mientras la vuelta no llega se anuncia; sin anuncio
 * un desplegable vacío se confundiría con «esto no tiene opciones».
 */
@Component({
  selector: 'app-field-select',
  imports: [FieldAria, FormField],
  template: `
    @if (fallo()) {
      <p class="mb-1 text-xs text-danger" role="alert">No se pudieron cargar las opciones.</p>
    } @else if (cargando()) {
      <p class="mb-1 text-xs text-neutral" role="status">Cargando opciones…</p>
    }
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

  private readonly ds = inject(DataSourceService);

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  /** Texto escrito en el buscador (sólo se usa si supera el umbral). */
  protected readonly query = signal('');

  /**
   * Registro del formulario, sólo para resolver `{campo}` en `source.params`.
   * Sin parámetros declarados no se lee: el campo no depende del formulario.
   */
  private readonly registro = computed<Record<string, unknown> | undefined>(() => {
    const source = this.field().source;
    if (source === undefined || source.params === undefined) return undefined;
    return this.tree()().value();
  });

  /** `undefined` sin fuente ⇒ `resource` queda idle y jamás llama al loader. */
  private readonly claveFuente = computed(() => {
    const source = this.field().source;
    return source === undefined ? undefined : dataSourceKey(source, this.registro());
  });

  private readonly fuenteResource = resource({
    params: () => this.claveFuente(),
    loader: async () => {
      const source = this.field().source;
      if (source === undefined) return [];
      return this.ds.rows(source, this.registro());
    },
  });

  /**
   * Opciones efectivas: las estáticas del schema o las filas de la fuente
   * declarada, mapeadas con la misma regla que una relación (F8 · R6.5).
   */
  protected readonly options = computed<SelectOption[]>(() => {
    const field = this.field();
    if (field.source === undefined) return field.options ?? [];
    // `value()` del resource TIRA en estado error (contract de Angular):
    // se mira el estado antes de leerlo, o el propio render rompe en vez
    // de pintar el aviso de fallo.
    if (this.fuenteResource.status() === 'error') return [];
    return optionsFromRows(this.fuenteResource.value() ?? [], {
      source: field.source,
      target: getSchema(field.source.resource),
    });
  });

  /** Sólo aplica con `source`: una lista estática no tiene vuelta que esperar. */
  protected readonly cargando = computed(
    () => this.claveFuente() !== undefined && this.fuenteResource.status() === 'loading',
  );

  protected readonly fallo = computed(
    () => this.claveFuente() !== undefined && this.fuenteResource.status() === 'error',
  );

  /** Umbral de la guía §1: 5–7 opciones dropdown simple, más de 7 con búsqueda. */
  protected readonly useSearch = computed(() => this.options().length > 7);

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /**
   * Opciones que coinciden con el término, SIN conservar la elegida: es la
   * base del mensaje «Sin resultados».
   */
  protected readonly matches = computed<SelectOption[]>(() => {
    const all = this.options();
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
    const kept = this.options().find((option) => option.value === selected);
    return kept === undefined ? filtered : [...filtered, kept];
  });
}
