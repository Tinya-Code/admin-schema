import { Component, computed, inject, input, model, resource } from '@angular/core';
import { LucideX } from '@lucide/angular';
import type { FormValueControl } from '@angular/forms/signals';

import type { MultiselectField, SelectOption } from '../../core/models/schema.model';
import { DataSourceService, dataSourceKey } from '../../core/services/data-source.service';
import { optionsFromRows } from '../../core/utils/source-options';
import { getSchema } from '../../schemas/registry';
import type { RootTree } from '../field-node';

/**
 * Selección múltiple con chips (base.md §5.1). `<select multiple>` no está
 * soportado por `[formField]`, así que es un control propio que cumple el
 * contrato `FormValueControl<string[]>`: el nodo llega desde el host con
 * `[formField]` y el valor se sincroniza por `model()`.
 *
 * Opciones: estáticas (`options`) o una fuente declarada (`source`), con la
 * misma regla XOR que el `select` y el mismo fetcher (F8 · R6.5). `tree`
 * existe para resolver `{campo}` en `source.params` con el registro del
 * formulario — sin él un multiselect con parámetros quedaría con el mismo
 * nombre de opción y otra regla que el select.
 */
@Component({
  selector: 'app-field-multiselect',
  imports: [LucideX],
  template: `
    <div class="space-y-2">
      @if (fallo()) {
        <p class="text-xs text-danger" role="alert">No se pudieron cargar las opciones.</p>
      } @else if (cargando()) {
        <p class="text-xs text-neutral" role="status">Cargando opciones…</p>
      }
      @if (value().length > 0) {
        <div class="flex flex-wrap gap-1.5" data-testid="multiselect-chips">
          @for (item of value(); track item) {
            <span
              class="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"
            >
              {{ labelOf(item) }}
              <button
                type="button"
                class="rounded-full px-0.5 hover:text-danger"
                [attr.aria-label]="'Quitar ' + labelOf(item)"
                [disabled]="disabled()"
                (click)="remove(item)"
              >
                <svg lucideX size="14" />
              </button>
            </span>
          }
        </div>
      }
      <div class="flex flex-wrap gap-1.5">
        @for (option of opciones(); track option.value) {
          @if (!isSelected(option.value)) {
            <button
              type="button"
              class="rounded-full border border-neutral/30 px-2.5 py-1 text-xs hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              [disabled]="disabled() || (option.disabled ?? false)"
              (click)="toggle(option)"
            >
              {{ option.label }}
            </button>
          }
        }
      </div>
    </div>
  `,
})
export class FieldMultiselect implements FormValueControl<string[]> {
  readonly field = input.required<MultiselectField>();

  /** Registro del formulario, sólo para resolver `{campo}` en `source.params`. */
  readonly tree = input<RootTree>();

  /** Sincronizado por el directive `FormField` del host. */
  readonly value = model.required<string[]>();
  readonly disabled = input(false);

  private readonly ds = inject(DataSourceService);

  private readonly registro = computed<Record<string, unknown> | undefined>(() => {
    const source = this.field().source;
    const tree = this.tree();
    if (source === undefined || source.params === undefined || tree === undefined) return undefined;
    return tree().value();
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

  /** Estáticas del schema o filas de la fuente declarada (F8 · R6.5). */
  protected readonly opciones = computed<SelectOption[]>(() => {
    const field = this.field();
    if (field.source === undefined) return field.options ?? [];
    // `value()` del resource TIRA en estado error (contract de Angular):
    // se mira el estado antes de leerlo, o el render rompe en vez de
    // pintar el aviso de fallo.
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

  protected toggle(option: SelectOption): void {
    if (this.disabled()) {
      return;
    }
    this.value.update((current) =>
      current.includes(option.value)
        ? current.filter((item) => item !== option.value)
        : [...current, option.value],
    );
  }

  protected remove(item: string): void {
    if (this.disabled()) {
      return;
    }
    this.value.update((current) => current.filter((value) => value !== item));
  }

  protected isSelected(item: string): boolean {
    return this.value().includes(item);
  }

  protected labelOf(item: string): string {
    return this.opciones().find((option) => option.value === item)?.label ?? item;
  }
}
