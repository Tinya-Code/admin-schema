import { Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap } from 'rxjs';

import type { ResourceSchema, WidgetSchema } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { WidgetHost } from '../../widgets/widget-host/widget-host';

/**
 * Panel de métricas — tercer `kind` del registry (motor-plan T4).
 *
 * Sólo lectura: no hay CRUD y los datos llegan de un endpoint declarativo
 * (Etapa 2, S4). Los widgets se declaran en `widgets` del schema — no en
 * `fields`, porque un KPI no es un campo (ver `ResourceSchema.widgets`).
 *
 * El `key` de cada widget es la clave de su dato en la respuesta: el
 * orquestador busca `data[key]` y se lo pasa a `widget-host`.
 */
@Component({
  selector: 'app-dashboard',
  imports: [EmptyState, WidgetHost],
  template: `
    <header class="mb-6">
      <h1 class="font-display text-2xl font-semibold">{{ schema().labelPlural }}</h1>
      <p class="text-sm text-neutral">Dashboard · {{ widgets().length }} widgets</p>
    </header>

    @if (widgets().length === 0) {
      <app-empty-state
        title="Sin widgets declarados"
        message="Los widgets se declaran en la propiedad widgets del schema del dashboard."
      />
    } @else {
      <div class="grid grid-cols-12 gap-4">
        @for (widget of widgets(); track widget.key) {
          <app-widget-host [widget]="widget" [data]="datum(widget)" />
        }
      </div>
    }
  `,
})
export class Dashboard {
  private readonly api = inject(ApiService, { optional: true });

  /** Descriptor del dashboard (lo resuelve `ResourcePage` contra el registry). */
  readonly schema = input.required<ResourceSchema>();

  /**
   * Respuesta del endpoint de métricas indexada por `key` de widget.
   * Si se pasa explícitamente (como en tests con fixtures), se usa directamente;
   * de lo contrario se obtienen los datos de forma reactiva desde el endpoint `get`.
   */
  readonly data = input<Record<string, unknown> | null>(null);

  private readonly fetchedData = toSignal(
    toObservable(this.schema).pipe(
      switchMap((schema) => {
        const getEndpoint = schema.endpoint?.get;
        if (!getEndpoint || !this.api) return of<Record<string, unknown>>({});
        return this.api
          .request<Record<string, unknown>>('GET', getEndpoint)
          .pipe(catchError(() => of<Record<string, unknown>>({})));
      }),
    ),
    { initialValue: {} as Record<string, unknown> },
  );

  protected readonly effectiveData = computed<Record<string, unknown>>(() => {
    const override = this.data();
    if (override !== null && override !== undefined) return override;
    return this.fetchedData() ?? {};
  });

  protected readonly widgets = computed(() => this.schema().widgets ?? []);

  /** `null` explícito cuando la clave no vino: el widget muestra su vacío. */
  protected datum(widget: WidgetSchema): unknown {
    const allData = this.effectiveData();
    // `source` lo declara el schema: el orquestador no sabe qué tipo es
    // ni qué claves compone cada widget.
    return (widget.source ?? 'key') === 'payload' ? allData : (allData[widget.key] ?? null);
  }
}
