import { Component, computed, input, output } from '@angular/core';
import { LucideCheckCircle2 } from '@lucide/angular';

import type {
  CopyShareAction,
  PostCreateSchema,
  ResourceAction,
  ResourceSchema,
} from '../../../core/models/schema.model';
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
            <app-copy-share
              [url]="resolvedShareUrl(action)"
              [shareText]="resolvedShareText(action)"
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
  readonly configValues = input<Record<string, unknown>>({});

  readonly closed = output<void>();

  protected readonly title = computed(() => {
    const raw = this.config().title || '¡Registro Creado con Éxito!';
    return interpolateTemplate(raw, this.record(), this.configValues());
  });

  protected readonly description = computed(() => {
    const raw =
      this.config().description ||
      'El registro fue creado correctamente y ya se encuentra guardado en el sistema.';
    return interpolateTemplate(raw, this.record(), this.configValues());
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

  protected readonly copyShareAction = computed<CopyShareAction | null>(() => {
    const actions = this.config().actions || [];
    const match = actions.find(
      (a): a is CopyShareAction => (a as CopyShareAction).type === 'copy-share',
    );
    return match || null;
  });

  protected resolvedShareUrl(action: CopyShareAction): string {
    return interpolateTemplate(action.urlTemplate, this.record(), this.configValues());
  }

  protected resolvedShareText(action: CopyShareAction): string {
    if (!action.shareTextTemplate) return '';
    return interpolateTemplate(action.shareTextTemplate, this.record(), this.configValues());
  }
}
