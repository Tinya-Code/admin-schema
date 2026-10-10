import { Component, computed, inject, input, resource } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap } from 'rxjs';

import type { DataSource, ResourceSchema, WidgetSchema } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { DataSourceService, type SourceRow } from '../../core/services/data-source.service';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { WidgetHost } from '../../widgets/widget-host/widget-host';

/**
 * Panel de métricas — tercer `kind` del registry (refactormotor.md F4).
 *
 * Sólo lectura: no hay CRUD y los datos llegan de un endpoint declarativo
 * (Etapa 2, S4). Los widgets se declaran en `widgets` del schema — no en
 * `fields`, porque un KPI no es un campo (ver `ResourceSchema.widgets`).
 *
 * Dos formas de dato, la que declare cada widget (F8 · R6.5):
 *
 * - **payload**: el `key` del widget es su clave en la respuesta del
 *   endpoint; `source: { kind: 'payload' }` lee la respuesta entera.
 * - **fuente declarada** (`source: { resource, view?, params? }`): el widget
 *   pide sus filas al `DataSourceService` y deja de depender de que un
 *   handler haya armado `data[key]`. Acá se piden TODAS juntas, así que un
 *   panel con seis fuentes iguales hace una vuelta, no seis (la caché del
 *   servicio es compartida con relations y selects).
 */
@Component({
  selector: 'app-dashboard',
  imports: [EmptyState, WidgetHost],
  template: `
    <header class="mb-6">
      <h1 class="font-display text-2xl font-semibold">{{ schema().labelPlural }}</h1>
      <p class="text-sm text-neutral">Dashboard · {{ widgets().length }} widgets</p>
    </header>

    @if (falloFuentes()) {
      <!-- Degradación visible (F9): sin este aviso el fallo de una fuente
           se confundiría con «el panel no tiene datos». -->
      <p class="mb-4 text-sm text-danger" role="alert">
        No se pudieron cargar los datos de algunos widgets.
      </p>
    }

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
  private readonly ds = inject(DataSourceService);

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

  // ── Fuentes declaradas (F8 · R6.5) ──────────────────────────────────────

  /**
   * Claves de los widgets con fuente declarada, en una cadena: es el
   * `params` del `resource` y sólo cambia cuando cambia el panel. `''`
   * (ninguna fuente) ⇒ `undefined` ⇒ el resource queda idle y no pide nada.
   */
  private readonly clavesFuente = computed(() =>
    this.widgets()
      .map((widget) => (esFuente(widget.source) ? widget.key : ''))
      .filter((key) => key !== '')
      .join('|'),
  );

  /**
   * Filas de todos los widgets con `source`, pedidas de una sola vez.
   *
   * Cada fila queda bajo `widget.key`, que es el mismo contrato de lectura
   * que tiene el payload: `datum()` devuelve filas cuando hay fuente y la
   * clave de siempre cuando no, y el descriptor del widget traduce la forma
   * que necesita.
   */
  private readonly fuentes = resource({
    params: () => (this.clavesFuente() === '' ? undefined : this.clavesFuente()),
    loader: async () => {
      const filas: Record<string, SourceRow[]> = {};
      for (const widget of this.widgets()) {
        if (!esFuente(widget.source)) continue;
        filas[widget.key] = await this.ds.rows(widget.source);
      }
      return filas;
    },
  });

  /** ¿Alguna fuente del panel falló? (`status()` no tira; `value()` sí.) */
  protected readonly falloFuentes = computed(() => this.fuentes.status() === 'error');

  /** `null` explícito cuando la clave no vino: el widget muestra su vacío. */
  protected datum(widget: WidgetSchema): unknown {
    // Fuente declarada: el dato son SUS filas, no una clave del payload.
    if (esFuente(widget.source)) {
      // `value()` del resource TIRA en estado error (contract de Angular):
      // se mira el estado antes de leerlo. En carga devuelve `null` igual
      // que el camino de payload, que también arranca vacío.
      return this.fuentes.status() === 'error'
        ? null
        : (this.fuentes.value()?.[widget.key] ?? null);
    }
    const allData = this.effectiveData();
    // `source` lo declara el schema: el orquestador no sabe qué tipo es
    // ni qué claves compone cada widget.
    return widget.source?.kind === 'payload' ? allData : (allData[widget.key] ?? null);
  }
}

/** ¿Este widget declara una fuente (`{ resource, … }`) y no el payload? */
function esFuente(source: WidgetSchema['source']): source is DataSource {
  return source !== undefined && source !== null && 'resource' in source;
}
