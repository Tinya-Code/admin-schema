import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import type { ResourceSchema } from '../../core/models/schema.model';
import { getSchema } from '../../schemas/registry';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { FormView } from '../form-view/form-view';
import { ListView } from '../list-view/list-view';

/**
 * Página del recurso: resuelve el `id` de la ruta contra el registry y
 * despacha según `kind` — colección → list view, singleton → form view —
 * aplicando `permissions` (estado «sin permisos»).
 */
@Component({
  selector: 'app-resource-page',
  imports: [EmptyState, FormView, ListView],
  template: `
    @if (schema(); as schema) {
      @if (hasNoAccess(schema)) {
        <app-empty-state
          title="Sin permisos"
          message="No tenés permisos para gestionar este recurso."
        />
      } @else if (schema.kind === 'collection') {
        <header class="mb-6">
          <h1 class="font-display text-2xl font-semibold">
            {{ schema.labelPlural }}
          </h1>
          <p class="text-sm text-neutral">Colección · {{ schema.fields.length }} campos</p>
        </header>
        <app-list-view [schema]="schema" />
      } @else {
        <app-form-view />
      }
    } @else {
      <app-empty-state
        title="Recurso no encontrado"
        message="No existe un schema con ese id en el registry."
      />
    }
  `,
})
export class ResourcePage {
  private readonly route = inject(ActivatedRoute);
  // paramMap emite síncrono (ConvertToParamMap) → requireSync evita `| undefined`.
  private readonly params = toSignal(this.route.paramMap, { requireSync: true });

  readonly schema = computed(() => getSchema(this.params().get('id') ?? ''));

  /**
   * Colección sin ninguna operación posible u singleton sin `update`: no hay
   * nada que mostrar con sentido (base.md §10 «Sin permisos»).
   */
  hasNoAccess(schema: ResourceSchema): boolean {
    const permissions = schema.permissions;
    if (!permissions) {
      return false;
    }
    if (schema.kind === 'singleton') {
      return permissions.update === false;
    }
    return (
      permissions.create === false && permissions.update === false && permissions.remove === false
    );
  }
}
