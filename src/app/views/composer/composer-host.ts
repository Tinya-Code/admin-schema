import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import type { ResourceSchema, UiViewTabs, ViewChildNode } from '../../core/models/schema.model';
import { validateComposition } from '../../core/registry/composition-validator';
import { getSchema } from '../../schemas/registry';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { evaluateCondition } from '../../shared/utils/condition-evaluator';
import { ViewSlot } from './view-slot';

/**
 * R9.9 · slice 3 — Host genérico de composición (`uiView` tipo `tabs`).
 *
 * Un SOLO componente recursivo renderiza cualquier composición declarada:
 * resuelve cada hijo por `(kind:'view', type)` dentro del `ViewSlot` (D2,
 * sin `switch` de dominio y sin importar hojas), monta la validación del
 * schema ANTES del primer render (fail-loud) y maneja el tablist accesible
 * con roving tabindex (R9.9.5).
 *
 * Decisiones R9.9.5:
 * - Retención: un hijo `retain:true` visitado queda MONTADO pero oculto
 *   (`hidden`); sin `retain` se destruye al cambiar de pestaña.
 * - Pestaña activa LOCAL por componente: no hay estado compartido entre
 *   instancias de tabs anidadas (documentado en los docs de slice 5).
 * - `visibleWhen` se evalúa sin record (el contenedor no es un formulario):
 *   contra registro vacío, TODAS las condiciones deben pasar (AND).
 *   Si la pestaña activa queda oculta, la selección cae visiblemente a la
 *   primera visible — nunca se pierde en silencio.
 */
@Component({
  selector: 'app-composer-host',
  standalone: true,
  imports: [ViewSlot, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error() !== null) {
      <app-empty-state title="Composición no disponible" [message]="error()!" />
    } @else if (visibles().length === 0) {
      <app-empty-state
        title="Sin secciones disponibles"
        message="La vista no declara secciones visibles."
      />
    } @else {
      <div
        role="tablist"
        class="flex flex-wrap gap-1 border-b border-neutral/20 px-1"
        [attr.aria-label]="etiqueta()"
        (keydown)="onKeydown($event)"
      >
        @for (h of visibles(); track h.id) {
          <button
            type="button"
            role="tab"
            [id]="'tab-' + h.id"
            [attr.aria-selected]="h.id === activo()"
            [attr.aria-controls]="montado(h.id) ? 'panel-' + h.id : null"
            [attr.tabindex]="h.id === activo() ? 0 : -1"
            [class]="claseTab(h.id)"
            (click)="seleccionar(h.id, true)"
          >
            {{ h.label }}
          </button>
        }
      </div>

      @for (h of montados(); track h.id) {
        <div
          role="tabpanel"
          [id]="'panel-' + h.id"
          [attr.aria-labelledby]="'tab-' + h.id"
          [class.hidden]="h.id !== activo()"
          class="py-3 focus:outline-none"
          tabindex="0"
        >
          <app-view-slot
            [schema]="schema()!"
            [node]="h"
            [parentInstanceId]="uiViewName()"
            [depth]="profundidad() + 1"
          />
        </div>
      }
    }
  `,
})
export class ComposerHost {
  private readonly route = inject(ActivatedRoute);
  private readonly routeData = toSignal(this.route.data, { requireSync: true });

  /** Schema: explícito en `data` (fixtures/ruta embebida) o vía `resourceId`. */
  readonly schema = computed<ResourceSchema | undefined>(() => {
    const data = this.routeData();
    const explicit = data['schema'];
    if (explicit !== undefined) return explicit as ResourceSchema;
    const resourceId = data['resourceId'];
    return typeof resourceId === 'string' ? getSchema(resourceId) : undefined;
  });

  /** instanceId de ESTE contenedor (raíz ⇒ nombre de la uiView de ruta). */
  readonly uiViewName = computed(() => {
    const v = this.routeData()['uiView'];
    return typeof v === 'string' ? v : '';
  });

  /** Profundidad de ESTE contenedor (raíz ⇒ 0; embebido ⇒ payload.depth). */
  readonly profundidad = computed(() => {
    const d = this.routeData()['depth'];
    return typeof d === 'number' ? d : 0;
  });

  /** Config `tabs` declarada para esta instancia. */
  readonly vista = computed<UiViewTabs | undefined>(() => {
    const schema = this.schema();
    const nombre = this.uiViewName();
    if (schema === undefined || nombre === '') return undefined;
    const vista = schema.uiViews?.[nombre];
    // `'config' in` descarta UiViewBase; el literal descarta calendar/kanban.
    return vista !== undefined && 'config' in vista && vista.type === 'tabs' ? vista : undefined;
  });

  /** Error determinista de configuración (schema/vista ausente o no-tabs). */
  private readonly errorConfig = computed<string | null>(() => {
    const data = this.routeData();
    const schema = this.schema();
    const nombre = this.uiViewName();
    if (schema === undefined) {
      return `Schema no encontrado para '${String(data['resourceId'] ?? '')}'`;
    }
    if (nombre === '') return 'Ruta de composición sin uiView declarada';
    const vista = schema.uiViews?.[nombre];
    if (vista === undefined) return `Vista '${nombre}' no declarada en ${schema.id}`;
    if (vista.type !== 'tabs') {
      return `Configuración inválida: ${schema.id}.${nombre} declara '${vista.type}', no es una vista tabs`;
    }
    return null;
  });

  /** Error de validación D2 (se recalcula una sola vez, en el constructor). */
  private readonly errorValidacion = signal<string | null>(null);

  /** Error mostrado: validación del schema primero, luego configuración. */
  readonly error = computed<string | null>(() => this.errorValidacion() ?? this.errorConfig());

  /** Todos los hijos declarados (orden de declaración). */
  private readonly hijos = computed<readonly ViewChildNode[]>(
    () => this.vista()?.config.children ?? [],
  );

  /** Hijos visibles: TODAS sus condiciones `visibleWhen` pasan sin record. */
  readonly visibles = computed<readonly ViewChildNode[]>(() =>
    this.hijos().filter(
      (h) =>
        h.visibleWhen === undefined ||
        h.visibleWhen.every((cond) => evaluateCondition(cond, {}, {})),
    ),
  );

  /** Selección del usuario (intención; vacío ⇒ usar `initial`/primera). */
  private readonly seleccion = signal('');

  /**
   * Pestaña activa EFECTIVA: derivada pura de la selección y de las
   * visibles — si la selección dejó de existir (u oculta), cae a `initial`
   * o a la primera visible de forma SINCRÓNICA y visible (R9.9.5: nunca
   * perder la vista elegida en silencio). Estado LOCAL por instancia.
   */
  readonly activo = computed<string>(() => {
    const vis = this.visibles();
    if (vis.length === 0) return '';
    const sel = this.seleccion();
    if (vis.some((h) => h.id === sel)) return sel;
    const inicial = this.vista()?.config.initial;
    return inicial !== undefined && vis.some((h) => h.id === inicial) ? inicial : vis[0].id;
  });

  /** Ids ya seleccionados alguna vez (sustento de la retención). */
  private readonly visitados = signal<ReadonlySet<string>>(new Set());

  /** Paneles en DOM: activo + retenidos visitados que siguen visibles. */
  readonly montados = computed<readonly ViewChildNode[]>(() => {
    const visibles = new Set(this.visibles().map((h) => h.id));
    const activo = this.activo();
    const visitados = this.visitados();
    return this.hijos().filter(
      (h) => visibles.has(h.id) && (h.id === activo || (h.retain === true && visitados.has(h.id))),
    );
  });

  constructor() {
    // D2 — validar TODO el schema antes del primer render (fail-loud).
    const schema = this.schema();
    if (schema !== undefined) {
      try {
        validateComposition(schema);
      } catch (e) {
        this.errorValidacion.set(e instanceof Error ? e.message : String(e));
      }
    }
    // La pestaña activa al montar cuenta como visitada: al cambiar de
    // pestaña, un hijo `retain:true` que estaba activo conserva su panel.
    const inicial = this.activo();
    if (inicial !== '') this.visitados.set(new Set([inicial]));
  }

  /** Selecciona una pestaña y, opcionalmente, mueve el foco a su botón. */
  seleccionar(id: string, conFoco: boolean): void {
    this.seleccion.set(id);
    this.visitados.update((v) => new Set(v).add(id));
    if (conFoco) {
      setTimeout(() => document.getElementById(`tab-${id}`)?.focus(), 0);
    }
  }

  /** Navegación por teclado del tablist: flechas con wrap, Home/End. */
  onKeydown(event: KeyboardEvent): void {
    const vis = this.visibles();
    if (vis.length === 0) return;
    const i = vis.findIndex((h) => h.id === this.activo());
    let next = -1;
    if (event.key === 'ArrowRight') next = (i + 1) % vis.length;
    else if (event.key === 'ArrowLeft') next = (i - 1 + vis.length) % vis.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = vis.length - 1;
    if (next < 0) return;
    event.preventDefault();
    this.seleccionar(vis[next].id, true);
  }

  /** El panel de este hijo está montado (⇒ existe su `aria-controls`). */
  montado(id: string): boolean {
    return this.montados().some((h) => h.id === id);
  }

  /** Clases del botón de pestaña: activo resaltado con token `primary`. */
  claseTab(id: string): string {
    const base =
      'rounded-t-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary';
    return id === this.activo()
      ? `${base} bg-primary/10 font-medium text-primary`
      : `${base} text-neutral hover:text-primary`;
  }

  /** Etiqueta a11y del tablist (la del recurso). */
  etiqueta(): string {
    return this.schema()?.labelPlural ?? 'Secciones';
  }
}
