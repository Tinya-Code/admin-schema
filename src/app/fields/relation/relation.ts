import { Component, computed, inject, input, resource } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';

import type { RelationField, SelectOption } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { getSchema } from '../../schemas/registry';
import { childTree, type RootTree } from '../field-node';

/**
 * Referencia a otro recurso (base.md §5.2): `<select>` con opciones del
 * listado del recurso destino, cargadas con `resource`.
 *
 * `params` lee el input en la construcción del recurso (antes de que Angular
 * asigne los inputs): `resource` captura esa primera excepción como estado
 * `error` y la reevalúa cuando el input cambia — verificado en
 * `_resource-chunk.mjs` (`extRequest`/`rethrowFatalErrors`, sólo el código
 * 992 se relanza).
 */
@Component({
  selector: 'app-field-relation',
  imports: [FormField],
  template: `
    @switch (optionsResource.status()) {
      @case ('loading') {
        <p class="field-input animate-pulse text-neutral">Cargando opciones…</p>
      }
      @case ('error') {
        <p class="text-sm text-danger" role="alert">No se pudieron cargar las opciones.</p>
      }
      @default {
        <select class="field-input" [id]="state().name()" [formField]="node()">
          @if (!field().required) {
            <option value="">{{ field().placeholder ?? '— Seleccionar —' }}</option>
          }
          @for (option of options(); track option.value) {
            <option [value]="option.value">{{ option.label }}</option>
          }
        </select>
        @if (options().length === 0) {
          <p class="mt-1 text-xs text-neutral">Sin opciones disponibles.</p>
        }
      }
    }
  `,
})
export class FieldRelation {
  readonly field = input.required<RelationField>();
  readonly tree = input.required<RootTree>();

  private readonly api = inject(ApiService);

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  private readonly optionsResource = resource({
    params: () => this.field().resource,
    loader: async ({ params: resourceId }) => {
      const target = getSchema(resourceId);
      if (!target) {
        throw new Error(`Recurso desconocido: ${resourceId}`);
      }
      const rows = await firstValueFrom(this.api.list<Record<string, unknown>>(target.endpoint));
      return Array.isArray(rows) ? rows : [];
    },
  });

  /** Opciones filtradas (`onlyActive`) y tipadas según el schema destino. */
  protected readonly options = computed<SelectOption[]>(() => {
    const rows = this.optionsResource.value() ?? [];
    const field = this.field();
    const target = getSchema(field.resource);
    const valueKey = field.valueField ?? target?.keyField ?? 'id';
    const labelKey = field.labelField ?? target?.titleField ?? valueKey;
    const options: SelectOption[] = [];
    for (const row of rows) {
      if (field.onlyActive && row['active'] === false) {
        continue;
      }
      const value = row[valueKey];
      if (value === undefined || value === null || value === '') {
        continue;
      }
      const label = row[labelKey];
      options.push({
        value: String(value),
        label: typeof label === 'string' && label !== '' ? label : String(value),
      });
    }
    return options;
  });
}
