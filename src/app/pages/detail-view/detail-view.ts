import { Component, computed, inject, input, output } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap } from 'rxjs';

import {
  LucideArrowLeft,
  LucideClock,
  LucideExternalLink,
  LucidePencil,
  LucideTrash2,
} from '@lucide/angular';
import type {
  CopyShareAction,
  DetailViewSchema,
  FieldSchema,
  ListField,
  ResourceAction,
  ResourceSchema,
} from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { ConfigService } from '../../core/services/config.service';
import { interpolateTemplate } from '../../core/utils/template-interpolator';
import { Badge, type BadgeKind } from '../../shared/components/badge/badge';
import { Button } from '../../shared/components/button/button';
import { CopyShare } from '../../shared/components/copy-share/copy-share';
import { getValue } from '../../shared/utils/field-path';

type Row = Record<string, unknown>;

interface FieldValue {
  key: string;
  label: string;
  value: string;
  kind: 'text' | 'badge' | 'image' | 'date' | 'number' | 'boolean' | 'list';
  badgeKind?: BadgeKind;
  rawList?: Record<string, unknown>[];
  listFields?: FieldSchema[];
}

interface DetailSection {
  id: string;
  label: string;
  fields: FieldValue[];
}

const DATE_FORMAT = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'UTC' });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});
const NUMBER_FORMAT = new Intl.NumberFormat('es-PE');

function resolveBadgeKind(val: string): BadgeKind {
  const upper = String(val).toUpperCase();
  if (['PENDIENTE', 'WAITING', 'EN_PROCESO', 'PROCESSING'].includes(upper)) return 'warning';
  if (
    ['ENTREGADO', 'DELIVERED', 'ACTIVA', 'ACTIVE', 'COMPLETADO', 'SUCCESS', 'SI', 'SÍ'].includes(
      upper,
    )
  )
    return 'success';
  if (['CANCELADO', 'CANCELLED', 'REVOCADA', 'REVOKED', 'ERROR', 'NO'].includes(upper))
    return 'danger';
  return 'neutral';
}

function formatValue(
  field: FieldSchema,
  raw: unknown,
): {
  text: string;
  kind: FieldValue['kind'];
  badgeKind?: BadgeKind;
  rawList?: Record<string, unknown>[];
  listFields?: FieldSchema[];
} {
  if (raw === null || raw === undefined || raw === '') {
    return { text: '—', kind: 'text' };
  }
  switch (field.type) {
    case 'date': {
      const d = new Date(String(raw));
      return {
        text: Number.isNaN(d.getTime()) ? String(raw) : DATE_FORMAT.format(d),
        kind: 'date',
      };
    }
    case 'number':
    case 'currency': {
      const n = Number(raw);
      return { text: Number.isFinite(n) ? NUMBER_FORMAT.format(n) : String(raw), kind: 'number' };
    }
    case 'boolean':
      return {
        text: raw ? 'Sí' : 'No',
        kind: 'badge',
        badgeKind: raw ? 'success' : 'neutral',
      };
    case 'select': {
      const selectField = field as { options?: { value: string; label: string }[] } & FieldSchema;
      const found = (selectField.options ?? []).find((o) => o.value === String(raw));
      const text = found ? found.label : String(raw);
      return { text, kind: 'badge', badgeKind: resolveBadgeKind(String(raw)) };
    }
    case 'image':
      return { text: String(raw), kind: 'image' };
    case 'list': {
      const listField = field as ListField;
      const arr = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
      return {
        text: `${arr.length} elementos`,
        kind: 'list',
        rawList: arr,
        listFields: listField.itemFields,
      };
    }
    default:
      return { text: String(raw), kind: 'text' };
  }
}

/**
 * Vista de detalle genérica: muestra los campos de un registro en modo lectura.
 * Incluye cabecera estilizada, soporte de badges semánticos, renderizado de imágenes,
 * timeline interactivo para listas anidadas (como history) y barra de acciones.
 */
@Component({
  selector: 'app-detail-view',
  imports: [
    Badge,
    Button,
    CopyShare,
    LucideArrowLeft,
    LucideClock,
    LucideExternalLink,
    LucidePencil,
    LucideTrash2,
  ],
  template: `
    <div class="space-y-6">
      <!-- ── Cabecera Principal ── -->
      <header
        class="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-neutral/15 bg-surface p-6 shadow-xs"
      >
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-2.5">
            <h1 class="font-display text-2xl font-bold tracking-tight text-neutral-light">
              {{ title() }}
            </h1>
            @for (badge of headerBadges(); track badge.key) {
              @if (badge.value !== '—') {
                <app-badge [label]="badge.value" [kind]="badge.badgeKind ?? 'neutral'" />
              }
            }
          </div>
          <p class="text-sm text-neutral">
            {{ schema().label }} · Identificador:
            <span class="font-mono font-medium text-neutral-light">{{ recordKey() }}</span>
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2.5">
          <button app-button variant="outline" type="button" (click)="back.emit()">
            <svg lucideArrowLeft size="16" />
            Volver
          </button>
          @if (detail().allowEdit !== false) {
            <button app-button variant="primary" type="button" (click)="edit.emit(record())">
              <svg lucidePencil size="16" />
              Editar
            </button>
          }
          @if (detail().allowDelete !== false) {
            <button app-button variant="danger" type="button" (click)="delete.emit(record())">
              <svg lucideTrash2 size="16" />
              Eliminar
            </button>
          }
        </div>
      </header>

      <!-- ── Acciones Destacadas del Registro (si existen) ── -->
      @if (copyShareActions().length > 0) {
        <section
          class="rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 shadow-xs"
        >
          <div class="mb-3 flex items-center gap-2">
            <svg lucideExternalLink size="16" class="text-primary" />
            <h2 class="text-sm font-semibold text-primary">Acciones del Registro</h2>
          </div>
          <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            @for (action of copyShareActions(); track action.id) {
              <div class="flex-1 min-w-[280px]">
                <app-copy-share
                  [url]="resolveUrl(action)"
                  [shareText]="resolveShareText(action)"
                  [label]="action.label"
                />
              </div>
            }
          </div>
        </section>
      }

      <!-- ── Secciones de Datos ── -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        @for (section of sections(); track section.id) {
          <section
            class="rounded-2xl border border-neutral/15 bg-surface shadow-xs overflow-hidden flex flex-col"
            [class.lg:col-span-2]="hasLargeContent(section)"
          >
            <header class="border-b border-neutral/10 bg-neutral/5 px-5 py-3.5">
              <h2 class="text-sm font-semibold tracking-wide text-neutral-light uppercase">
                {{ section.label }}
              </h2>
            </header>

            <div class="p-5 flex-1 space-y-4">
              <!-- Grid para campos regulares -->
              @if (regularFields(section).length > 0) {
                <dl class="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  @for (field of regularFields(section); track field.key) {
                    <div class="space-y-1">
                      <dt class="text-xs font-medium text-neutral">{{ field.label }}</dt>
                      @if (field.kind === 'image' && field.value !== '—') {
                        <dd>
                          <a
                            [href]="field.value"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="group relative inline-block overflow-hidden rounded-xl border border-neutral/20 shadow-xs transition hover:border-primary"
                          >
                            <img
                              [src]="field.value"
                              [alt]="field.label"
                              class="h-28 w-28 object-cover transition duration-300 group-hover:scale-105"
                            />
                            <div
                              class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"
                            >
                              <svg lucideExternalLink size="18" class="text-white" />
                            </div>
                          </a>
                        </dd>
                      } @else if (field.kind === 'badge') {
                        <dd>
                          <app-badge [label]="field.value" [kind]="field.badgeKind ?? 'neutral'" />
                        </dd>
                      } @else {
                        <dd class="text-sm font-medium text-neutral-light break-words">
                          {{ field.value }}
                        </dd>
                      }
                    </div>
                  }
                </dl>
              }

              <!-- Renderizado de listas anidadas (Timeline de eventos / items) -->
              @for (field of listFields(section); track field.key) {
                <div class="pt-2">
                  <h3 class="mb-3 text-xs font-semibold text-neutral uppercase">
                    {{ field.label }}
                  </h3>
                  @if (field.rawList && field.rawList.length > 0) {
                    <div
                      class="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-neutral/20"
                    >
                      @for (item of field.rawList; track $index) {
                        <div class="relative group">
                          <span
                            class="absolute -left-6 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 ring-4 ring-surface"
                          >
                            <span class="h-1.5 w-1.5 rounded-full bg-primary"></span>
                          </span>
                          <div
                            class="rounded-xl border border-neutral/10 bg-neutral/5 p-3.5 transition hover:border-neutral/20"
                          >
                            <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                              @if (item['action']) {
                                <app-badge
                                  [label]="formatActionLabel(item['action'])"
                                  [kind]="resolveActionBadgeKind(item['action'])"
                                />
                              }
                              @if (item['at']) {
                                <span class="text-xs text-neutral flex items-center gap-1">
                                  <svg lucideClock size="12" />
                                  {{ formatDateTime(item['at']) }}
                                </span>
                              }
                            </div>
                            @if (item['detail']) {
                              <p class="text-sm text-neutral-light">{{ item['detail'] }}</p>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  } @else {
                    <p class="text-xs italic text-neutral">No hay registros en el historial.</p>
                  }
                </div>
              }
            </div>
          </section>
        }
      </div>
    </div>
  `,
})
export class DetailView {
  private readonly api = inject(ApiService, { optional: true });
  private readonly configService = inject(ConfigService, { optional: true });

  readonly schema = input.required<ResourceSchema>();
  readonly record = input.required<Row>();

  readonly edit = output<Row>();
  readonly back = output<void>();
  readonly delete = output<Row>();

  /**
   * Obtiene el registro completo desde el endpoint get si existe.
   * Esto asegura que campos pesados o no proyectados en la lista (como fotos, notas o historial)
   * se carguen y muestren completos.
   */
  private readonly fetchedRecord = toSignal(
    toObservable(this.record).pipe(
      switchMap((rec) => {
        const schema = this.schema();
        const key = rec ? String(rec[schema.keyField] ?? '') : '';
        const getEndpoint = schema.endpoint?.get;
        if (!key || !getEndpoint || typeof this.api?.get !== 'function') {
          return of<Row | null>(null);
        }
        return this.api.get<Row>(schema.endpoint, key).pipe(catchError(() => of<Row | null>(null)));
      }),
    ),
    { initialValue: null },
  );

  protected readonly effectiveRecord = computed<Row>(() => {
    const initial = this.record();
    const fetched = this.fetchedRecord();
    if (fetched && typeof fetched === 'object' && Object.keys(fetched).length > 0) {
      return { ...initial, ...fetched };
    }
    return initial;
  });

  protected readonly detail = computed<DetailViewSchema>(
    () => this.schema().detail ?? { enabled: true },
  );

  protected readonly title = computed(() => {
    const rec = this.effectiveRecord();
    const schema = this.schema();
    const raw = rec[schema.titleField];
    return raw !== undefined && raw !== null && raw !== '' ? String(raw) : schema.label;
  });

  protected readonly recordKey = computed(() => {
    const rec = this.effectiveRecord();
    const schema = this.schema();
    return String(rec[schema.keyField] ?? '—');
  });

  protected readonly headerBadges = computed<FieldValue[]>(() => {
    const headerKeys = this.detail().headerFields ?? [];
    return headerKeys.map((key) => this.resolveFieldValue(key));
  });

  protected readonly sections = computed<DetailSection[]>(() => {
    const schema = this.schema();
    const detailConfig = this.detail();

    if (detailConfig.sections && detailConfig.sections.length > 0) {
      return detailConfig.sections.map((sec) => ({
        id: sec.id,
        label: sec.label,
        fields: sec.fields.map((key) => this.resolveFieldValue(key)),
      }));
    }

    const layoutSections = schema.layout?.sections ?? [];
    const sectionMap = new Map<string, DetailSection>();

    for (const layoutSection of layoutSections) {
      sectionMap.set(layoutSection.id, {
        id: layoutSection.id,
        label: layoutSection.label,
        fields: [],
      });
    }

    const unsectioned: DetailSection = { id: '_unsectioned', label: schema.label, fields: [] };

    for (const field of schema.fields) {
      const value = this.resolveFieldValue(field.key);
      if (field.section && sectionMap.has(field.section)) {
        sectionMap.get(field.section)!.fields.push(value);
      } else {
        unsectioned.fields.push(value);
      }
    }

    const result: DetailSection[] = [];
    if (unsectioned.fields.length > 0) result.push(unsectioned);
    for (const sec of sectionMap.values()) {
      if (sec.fields.length > 0) result.push(sec);
    }

    return result;
  });

  protected readonly copyShareActions = computed<CopyShareAction[]>(() => {
    const actions: ResourceAction[] = this.schema().actions ?? this.detail().actions ?? [];
    return actions.filter(
      (a): a is CopyShareAction => (a as CopyShareAction).type === 'copy-share',
    );
  });

  private resolveFieldValue(key: string): FieldValue {
    const schema = this.schema();
    const rec = this.effectiveRecord();
    const field = schema.fields.find((f) => f.key === key);
    const label = field?.label ?? key.replace(/_/g, ' ');
    const raw = getValue(rec, key);
    if (!field) {
      return {
        key,
        label,
        value: raw !== null && raw !== undefined ? String(raw) : '—',
        kind: 'text',
      };
    }
    const formatted = formatValue(field, raw);
    return {
      key,
      label,
      value: formatted.text,
      kind: formatted.kind,
      badgeKind: formatted.badgeKind,
      rawList: formatted.rawList,
      listFields: formatted.listFields,
    };
  }

  protected regularFields(section: DetailSection): FieldValue[] {
    return section.fields.filter((f) => f.kind !== 'list');
  }

  protected listFields(section: DetailSection): FieldValue[] {
    return section.fields.filter((f) => f.kind === 'list');
  }

  protected hasLargeContent(section: DetailSection): boolean {
    return section.fields.some((f) => f.kind === 'list' || f.key === 'description');
  }

  protected resolveUrl(action: CopyShareAction): string {
    const ctx = this.configService
      ? this.configService.buildInterpolationContext(this.effectiveRecord())
      : this.effectiveRecord();
    return interpolateTemplate(action.urlTemplate, ctx);
  }

  protected resolveShareText(action: CopyShareAction): string {
    const ctx = this.configService
      ? this.configService.buildInterpolationContext(this.effectiveRecord())
      : this.effectiveRecord();
    const template =
      action.shareTextTemplate || (ctx['share_message_template'] as string | undefined);
    if (!template) return '';
    return interpolateTemplate(template, ctx);
  }

  protected formatDateTime(val: unknown): string {
    if (!val) return '—';
    const d = new Date(String(val));
    return Number.isNaN(d.getTime()) ? String(val) : DATE_TIME_FORMAT.format(d);
  }

  protected formatActionLabel(val: unknown): string {
    if (!val) return '';
    return String(val).replace(/_/g, ' ');
  }

  protected resolveActionBadgeKind(val: unknown): BadgeKind {
    return resolveBadgeKind(String(val));
  }
}
