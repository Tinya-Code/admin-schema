import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';

import type { ResourceSchema } from '../../core/models/schema.model';
import { getSchema } from '../../schemas/registry';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { Dashboard } from '../dashboard/dashboard';
import { DetailView } from '../detail-view/detail-view';
import { FormView } from '../form-view/form-view';
import { ListView } from '../list-view/list-view';

type View = 'list' | 'detail';

/**
 * Página del recurso: resuelve el `id` de la ruta contra el registry y
 * despacha según `kind` — colección → list view, singleton → form view,
 * dashboard → panel de sólo lectura — aplicando `permissions` (estado
 * «sin permisos»).
 *
 * Cuando `schema.detail.enabled === true`, intercepta el click de fila del
 * `ListView` y muestra el `DetailView` en lugar de navegar al formulario.
 * «Editar» desde el `DetailView` sí navega al formulario de edición.
 */
@Component({
  selector: 'app-resource-page',
  imports: [Dashboard, DetailView, EmptyState, FormView, ListView],
  template: `
    @if (schema(); as schema) {
      @if (hasNoAccess(schema)) {
        <app-empty-state
          title="Sin permisos"
          message="No tiene permisos para gestionar este recurso."
        />
      } @else {
        @switch (schema.kind) {
          @case ('collection') {
            @switch (currentView()) {
              @case ('detail') {
                @if (selectedRecord(); as rec) {
                  <app-detail-view
                    [schema]="schema"
                    [record]="rec"
                    (back)="switchToList()"
                    (edit)="goEdit($event)"
                    (delete)="switchToList()"
                  />
                }
              }
              @default {
                <header class="mb-6">
                  <h1 class="font-display text-2xl font-semibold">
                    {{ schema.labelPlural }}
                  </h1>
                  <p class="text-sm text-neutral">Colección · {{ schema.fields.length }} campos</p>
                </header>
                <app-list-view [schema]="schema" (viewRecord)="switchToDetail($event)" />
              }
            }
          }
          @case ('dashboard') {
            <app-dashboard [schema]="schema" />
          }
          @default {
            <!-- singleton: formulario directo -->
            <app-form-view />
          }
        }
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
  private readonly router = inject(Router);
  // paramMap emite síncrono (ConvertToParamMap) → requireSync evita `| undefined`.
  private readonly params = toSignal(this.route.paramMap, { requireSync: true });

  readonly schema = computed(() => getSchema(this.params().get('id') ?? ''));

  /** Vista activa: 'list' (por defecto) o 'detail' (al hacer clic en una fila con detail.enabled). */
  readonly currentView = signal<View>('list');
  /** Registro seleccionado para la vista de detalle. */
  readonly selectedRecord = signal<Record<string, unknown> | null>(null);

  constructor() {
    // La ficha es ENLAZABLE: `/:id/:key` (p. ej. el «Ver Ficha» del
    // dashboard) entra directo al detalle. Al navegar — desde una fila o con
    // el botón atrás — la URL es la única fuente de verdad de la vista.
    this.route.paramMap
      .pipe(
        map((params) => params.get('key')),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((key) => this.openFromRoute(key));
  }

  private openFromRoute(key: string | null): void {
    const schema = this.schema();
    if (!schema || schema.kind !== 'collection') return;

    if (key && schema.detail?.enabled) {
      // Si el registro ya está cargado (clic en una fila) se conserva tal
      // cual; si llegamos por URL sólo hay clave, y DetailView trae el resto.
      const current = this.selectedRecord();
      if (!current || String(current[schema.keyField]) !== key) {
        this.selectedRecord.set({ [schema.keyField]: key });
      }
      this.currentView.set('detail');
    } else if (this.currentView() === 'detail') {
      this.selectedRecord.set(null);
      this.currentView.set('list');
    }
  }

  switchToDetail(record: Record<string, unknown>): void {
    const schema = this.schema();
    this.selectedRecord.set(record);
    this.currentView.set('detail');
    const key = schema ? record[schema.keyField] : undefined;
    if (schema && key !== undefined && key !== null && String(key) !== '') {
      void this.router.navigate(['/', schema.id, String(key)]);
    }
  }

  switchToList(): void {
    this.selectedRecord.set(null);
    this.currentView.set('list');
    const schema = this.schema();
    if (schema && this.params().get('key')) {
      void this.router.navigate(['/', schema.id]);
    }
  }

  goEdit(record: Record<string, unknown>): void {
    const schema = this.schema();
    if (!schema) return;
    const key = record[schema.keyField] as string | undefined;
    if (key) {
      void this.router.navigate(['/', schema.id, key, 'edit']);
    }
  }

  /**
   * Colección sin ninguna operación posible u singleton sin `update`: no hay
   * nada que mostrar con sentido (base.md §10 «Sin permisos»).
   *
   * Un dashboard nunca entra aquí: es un panel de sólo lectura, `ResourcePermissions`
   * no tiene `read` y el acceso real a los datos lo decide el endpoint
   * (A4: el cliente es interfaz, no autoridad).
   */
  hasNoAccess(schema: ResourceSchema): boolean {
    const permissions = schema.permissions;
    if (!permissions || schema.kind === 'dashboard') {
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
