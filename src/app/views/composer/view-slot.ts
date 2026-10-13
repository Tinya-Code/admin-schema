import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  Injector,
  ViewContainerRef,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import type { ResourceSchema, ViewChildNode } from '../../core/models/schema.model';
import { MAX_DEPTH } from '../../core/registry/composition-validator';
import { get } from '../../core/registry/render-registry';
import { ViewNavigationService } from '../../core/view-navigation/view-navigation.service';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { createViewContext, instanceIdFor, syntheticRoute, virtualSchemaFor } from './view-context';
import type { ViewContextData } from './view-context';

/**
 * R9.9 · slice 3 — Slot de instancia embebida.
 *
 * Monta UN hijo de composición resolviéndolo SOLO por `(kind:'view', type)`
 * en el registro (`get`, nunca `resolve` ⇒ el fallback silencioso del
 * registro es inalcanzable, D2) y entregándole un canal ViewContext
 * sintético (D1). Cada slot es una isla: carga/error/estado se aíslan por
 * `instanceId`, y el rechazo de `load()` queda retenido en `error()` para
 * diagnóstico sin tumbar a los hermanos.
 */
@Component({
  selector: 'app-view-slot',
  standalone: true,
  imports: [EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (status() === 'loading') {
      <div role="status" class="p-3 text-sm text-neutral">Cargando…</div>
    } @else if (status() === 'error') {
      <app-empty-state title="No se pudo mostrar esta vista" [message]="mensaje()" />
    } @else {
      <div #host></div>
    }
  `,
})
export class ViewSlot {
  /** Schema del recurso padre (el host le pasa el schema real). */
  readonly schema = input.required<ResourceSchema>();
  /** Nodo declarado (inline con `type` o por `ref`). */
  readonly node = input.required<ViewChildNode>();
  /** instanceId del contenedor padre (raíz ⇒ nombre de la uiView de ruta). */
  readonly parentInstanceId = input.required<string>();
  /** Profundidad del propio slot (hijo de raíz ⇒ 1). */
  readonly depth = input(0);

  /** Estado de ESTE slot — aislado por instancia, jamás compartido con hermanos. */
  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  /** Rechazo original retenido para diagnóstico (el display usa `mensaje()`). */
  readonly error = signal<unknown>(null);
  /** Payload entregado al hijo (público para tests/diagnóstico). */
  readonly payload = signal<ViewContextData | null>(null);

  private readonly nav = inject(ViewNavigationService);
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly ancla = viewChild('host', { read: ViewContainerRef });

  private epoch = 0;
  private pendiente: { tipo: unknown; injector: Injector } | null = null;

  constructor() {
    // Fase 1: montaje/reactivo — cualquier cambio de inputs re-monta el slot.
    effect(() => this.monar());
    // Fase 2: cuando el ancla #host existe (status ready), crear el hijo.
    effect(() => {
      if (this.status() !== 'ready') return;
      const pend = this.pendiente;
      let ancla: ViewContainerRef | undefined;
      try {
        ancla = this.ancla();
      } catch {
        ancla = undefined; // ancla aún no materializada; el effect re-corre al aparecer
      }
      if (!pend || !ancla) return;
      this.pendiente = null;
      ancla.clear();
      ancla.createComponent(pend.tipo as never, { injector: pend.injector });
    });
  }

  private async monar(): Promise<void> {
    const esquema = this.schema();
    const nodo = this.node();
    if (!esquema || !nodo) return;
    const turno = ++this.epoch;
    this.pendiente = null;

    if (this.depth() > MAX_DEPTH) {
      this.error.set(
        new Error(
          `Límite de profundidad de composición excedido (${MAX_DEPTH}) en ${esquema.id}.${nodo.id}`,
        ),
      );
      this.status.set('error');
      return;
    }

    // Referencia por uiView del mismo schema o nodo inline.
    const resuelto = 'ref' in nodo ? esquema.uiViews?.[nodo.ref] : nodo;
    if (resuelto === undefined) {
      const ref = 'ref' in nodo ? nodo.ref : nodo.id;
      this.error.set(new Error(`Referencia '${ref}' inexistente en ${esquema.id}`));
      this.status.set('error');
      return;
    }

    const descriptor = get('view', resuelto.type);
    if (!descriptor) {
      // Sin fallback: error legible, nunca pantalla de reserva (D2).
      this.error.set(
        new Error(`No existe descriptor kind:view type '${resuelto.type}' en ${esquema.id}`),
      );
      this.status.set('error');
      return;
    }

    const instanceId = instanceIdFor(this.parentInstanceId(), nodo.id);
    const select = 'ref' in nodo ? resuelto.select : nodo.select;
    const virtual = virtualSchemaFor(esquema, instanceId, resuelto);
    // D4: el emisor va a `dispatch` (target resuelto, segmentos, guards);
    // sólo un binding `mode:'route'` lleva `emit`, pero el payload declara
    // `select` SIEMPRE para que la hoja aplique la decision table.
    const emit =
      select?.mode === 'route'
        ? (event: Parameters<NonNullable<ViewContextData['emit']>>[0]): void => {
            void this.nav.dispatch(select, event);
          }
        : undefined;
    this.payload.set(
      createViewContext(
        {
          schema: virtual,
          resourceId: esquema.id,
          uiView: instanceId,
          viewType: resuelto.type,
          depth: this.depth(),
          ...(select !== undefined ? { select } : {}),
        },
        emit,
      ),
    );

    this.error.set(null);
    this.status.set('loading');
    const injector = Injector.create({
      providers: [{ provide: ActivatedRoute, useValue: syntheticRoute(this.payload()!) }],
      parent: this.envInjector,
    });

    try {
      const tipo = await descriptor.load();
      if (turno !== this.epoch) return; // inputs cambiaron: descartar
      this.pendiente = { tipo, injector };
      this.status.set('ready');
    } catch (e) {
      if (turno !== this.epoch) return;
      this.error.set(e);
      this.status.set('error');
    }
  }

  /** Mensaje mostrado (el error original queda en `error()`). */
  mensaje(): string {
    const e = this.error();
    return e instanceof Error ? e.message : String(e);
  }
}
