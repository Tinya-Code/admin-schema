import { Component, computed, inject, input, output } from '@angular/core';
import { LucideCheckCircle2 } from '@lucide/angular';

import type {
  CopyShareAction,
  PostCreateSchema,
  ResourceAction,
  ResourceSchema,
} from '../../../core/models/schema.model';
import { isShareAction, resolveShare, type ResolvedShare } from '../../../actions/action-registry';
import { ConfigService } from '../../../core/services/config.service';
import { interpolateTemplate } from '../../../core/utils/template-interpolator';
import { Button } from '../button/button';
import { CopyShare } from '../copy-share/copy-share';
import { Modal } from '../modal/modal';

interface SummaryItem {
  key: string;
  label: string;
  value: string;
}

/**
 * Modal de éxito y resumen tras crear un registro.
 * Permite visualizar datos clave y acciones directas (como CopyShare o compartir por WhatsApp).
 */
@Component({
  selector: 'app-post-create-modal',
  imports: [Modal, Button, CopyShare, LucideCheckCircle2],
  template: `
    <app-modal [open]="true" [title]="title()" (close)="closed.emit()">
      <div class="flex flex-col gap-4">
        <!-- Encabezado con icono de éxito -->
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500"
          >
            <svg lucideCheckCircle2 size="22" />
          </div>
          <div>
            <p class="text-sm text-neutral-light">{{ description() }}</p>
          </div>
        </div>

        <!-- Tarjeta de campos de resumen -->
        @if (summaryItems().length > 0) {
          <div class="rounded-lg border border-neutral/15 bg-surface p-3.5">
            <dl class="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
              @for (item of summaryItems(); track item.key) {
                <div class="flex flex-col">
                  <dt class="text-xs font-medium text-neutral">{{ item.label }}</dt>
                  <dd class="text-sm font-semibold text-neutral-light truncate">
                    {{ item.value }}
                  </dd>
                </div>
              }
            </dl>
          </div>
        }

        <!-- Acciones declaradas (ej. CopyShare) -->
        @if (copyShareAction(); as action) {
          <div class="rounded-lg border border-primary/20 bg-primary/5 p-3.5">
            <p class="mb-2 text-xs font-medium text-primary">Enlace de Seguimiento</p>
            @let share = shareOf(action);
            <app-copy-share
              [url]="share.url"
              [shareText]="share.shareText"
              [label]="action.label"
            />
          </div>
        }

        <!-- Botón de cierre primario -->
        <div class="mt-2 flex justify-end">
          <button app-button type="button" variant="primary" (click)="closed.emit()">
            Continuar
          </button>
        </div>
      </div>
    </app-modal>
  `,
})
export class PostCreateModal {
  readonly schema = input.required<ResourceSchema>();
  readonly config = input.required<PostCreateSchema>();
  readonly record = input.required<Record<string, unknown>>();

  /**
   * Override puntual del contexto de interpolación (tests, o quien quiera
   * forzar un valor). **No** es la vía normal: la config global la aporta
   * `ConfigService`, igual que en `list-view`.
   */
  readonly configValues = input<Record<string, unknown>>({});

  readonly closed = output<void>();

  /**
   * Inyectado y NO opcional a propósito. El bug que motivó esto (D18): con
   * el input `configValues` como única fuente y nadie bindeándolo, la
   * plantilla salía con `{public_base_url}` vacío y el operador copiaba
   * `…aquí: /p/ORD-0001.` — un enlace inpegable.
   *
   * `buildInterpolationContext` mezcla config global + fila y fija
   * `public_base_url` (`config.service.ts:64-73`); `configValues` se aplica
   * encima, sólo como override.
   */
  private readonly configService = inject(ConfigService);

  /** Contexto único con el que se resuelven título, descripción, URL y mensaje. */
  private readonly context = computed(() => ({
    ...this.configService.buildInterpolationContext(this.record()),
    ...this.configValues(),
  }));

  protected readonly title = computed(() => {
    const raw = this.config().title || '¡Registro Creado con Éxito!';
    return interpolateTemplate(raw, this.context());
  });

  protected readonly description = computed(() => {
    const raw =
      this.config().description ||
      'El registro fue creado correctamente y ya se encuentra guardado en el sistema.';
    return interpolateTemplate(raw, this.context());
  });

  protected readonly summaryItems = computed<SummaryItem[]>(() => {
    const fields = this.config().summaryFields || [];
    const rec = this.record();
    const schemaFields = this.schema().fields || [];

    return fields.map((key) => {
      const fieldDef = schemaFields.find((f) => f.key === key);
      const label = fieldDef?.label || key.replace(/_/g, ' ');
      const rawVal = rec[key];
      const value = rawVal === null || rawVal === undefined || rawVal === '' ? '—' : String(rawVal);
      return { key, label, value };
    });
  });

  protected readonly copyShareAction = computed<CopyShareAction | null>(
    () => (this.config().actions || []).find(isShareAction) ?? null,
  );

  /** Enlace y mensaje, resueltos por `resolveShare` (R3.10: una sola copia). */
  protected shareOf(action: CopyShareAction): ResolvedShare {
    return resolveShare(action, this.context());
  }
}
