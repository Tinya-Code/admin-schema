import { Component, computed, inject, input, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, combineLatest, of, switchMap } from 'rxjs';

import { LucideArrowLeft, LucideExternalLink, LucidePencil, LucideTrash2 } from '@lucide/angular';
import type {
  CopyShareAction,
  DetailViewSchema,
  FieldSchema,
  ResourceAction,
  ResourceSchema,
  TriggerAction,
} from '../../core/models/schema.model';
import {
  isShareAction,
  isTriggerAction,
  resolveShare,
  type ResolvedShare,
} from '../../actions/action-registry';
import { ActionService } from '../../actions/action-service';
import { RenderHost } from '../../core/registry/render-host';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { Button } from '../../shared/components/button/button';
import { CopyShare } from '../../shared/components/copy-share/copy-share';
import { getValue } from '../../shared/utils/field-path';

type Row = Record<string, unknown>;

/**
 * Campo ya resuelto contra el registro, **sin formatear**.
 *
 * Antes de R4.2 este objeto traía `value` + `kind` + `badgeKind`, que era
 * como `detail-view` derivaba a mano qué pintar (`image | badge | text`).
 * Hoy sólo aporta agrupación —clave, etiqueta, campo y valor crudo— y el
 * pintado lo decide el registro vía `<app-render-host mode="display">`.
 */
interface FieldValue {
  key: string;
  label: string;
  /** Campo del schema (o un `text` sintético si la clave no existe). */
  field: FieldSchema;
  /** Valor crudo del registro. */
  raw: unknown;
}

interface DetailSection {
  id: string;
  label: string;
  fields: FieldValue[];
}

/**
 * Vista de detalle genérica: muestra los campos de un registro en modo lectura.
 * Incluye cabecera estilizada, timeline interactivo para listas anidadas
 * (como history) y barra de acciones.
 *
 * **R4.2 · F3 (`refactormotor.md`):** dejó de derivar `kind` a mano y de
 * tener plantilla propia de campo. Agrupa (`sections()`, `resolveFieldValue()`,
 * el `<dt>`/`<dd>`, el bloque de historial y `hasLargeContent()`) y el valor
 * lo pinta el registro con `mode="display"` — la misma tabla por tipo que
 * cualquier otra superficie. Lo único que queda por fuera son las secciones
 * que no son campos: cabecera, `copy-share` y acciones.
 */
@Component({
  selector: 'app-detail-view',
  imports: [
    Button,
    CopyShare,
    LucideArrowLeft,
    LucideExternalLink,
    LucidePencil,
    LucideTrash2,
    RenderHost,
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
            @for (campo of headerFields(); track campo.key) {
              @if (!vacio(campo.raw)) {
                <!-- La cabecera siempre mostró los headerFields como chips:
                     el matiz viaja al host, no un @switch por tipo acá. -->
                <app-render-host
                  mode="display"
                  [chip]="true"
                  [type]="campo.field.type"
                  [config]="campo.field"
                  [value]="campo.raw"
                />
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
      @if (copyShareActions().length > 0 || triggerActions().length > 0) {
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
                @let share = shareOf(action);
                <app-copy-share
                  [url]="share.url"
                  [shareText]="share.shareText"
                  [label]="action.label"
                />
              </div>
            }
            @for (action of triggerActions(); track action.id) {
              <button app-button variant="outline" type="button" (click)="runTrigger(action)">
                {{ action.label }}
              </button>
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
                  @for (campo of regularFields(section); track campo.key) {
                    <div class="space-y-1">
                      <dt class="text-xs font-medium text-neutral">{{ campo.label }}</dt>
                      <dd class="text-sm font-medium text-neutral-light break-words">
                        <app-render-host
                          mode="display"
                          [type]="campo.field.type"
                          [config]="campo.field"
                          [value]="campo.raw"
                        />
                      </dd>
                    </div>
                  }
                </dl>
              }

              <!-- Renderizado de listas anidadas (Timeline de eventos / items) -->
              @for (campo of listFields(section); track campo.key) {
                <div class="pt-2">
                  <h3 class="mb-3 text-xs font-semibold text-neutral uppercase">
                    {{ campo.label }}
                  </h3>
                  <app-render-host
                    mode="display"
                    [type]="campo.field.type"
                    [config]="campo.field"
                    [value]="campo.raw"
                  />
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
  private readonly actionService = inject(ActionService);
  private readonly auth = inject(AuthService);
  // R8.8: el trigger (Regenerar PIN) confirma vía toast y dispara la
  // recarga del detalle — el mismo puerto que ya usa list-view.
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  readonly schema = input.required<ResourceSchema>();
  readonly record = input.required<Row>();

  readonly edit = output<Row>();
  readonly back = output<void>();
  readonly delete = output<Row>();

  /**
   * R8.8: contador que fuerza la relectura del registro. Una acción de
   * dominio muta la fila en el back (el PIN regenerado vive en la hoja);
   * sin este tick, `toObservable(this.record)` no emite (la referencia no
   * cambió) y el detalle mostraría el PIN viejo.
   */
  private readonly refreshTick = signal(0);

  /**
   * Obtiene el registro completo desde el endpoint get si existe.
   * Esto asegura que campos pesados o no proyectados en la lista (como fotos, notas o historial)
   * se carguen y muestren completos.
   */
  private readonly fetchedRecord = toSignal(
    combineLatest([toObservable(this.record), toObservable(this.refreshTick)]).pipe(
      switchMap(([rec]) => {
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

  protected readonly headerFields = computed<FieldValue[]>(() => {
    const headerKeys = this.detail().headerFields ?? [];
    return headerKeys
      .map((key) => this.resolveFieldValue(key))
      .filter((f): f is FieldValue => f !== null);
  });

  protected readonly sections = computed<DetailSection[]>(() => {
    const schema = this.schema();
    const detailConfig = this.detail();

    if (detailConfig.sections && detailConfig.sections.length > 0) {
      return detailConfig.sections
        .map((sec) => ({
          id: sec.id,
          label: sec.label,
          fields: sec.fields
            .map((key) => this.resolveFieldValue(key))
            .filter((f): f is FieldValue => f !== null),
        }))
        .filter((sec) => sec.fields.length > 0);
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
      if (value === null) continue; // R7.5: campo oculto por políticas
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
    return actions.filter(isShareAction);
  });

  /** R8.8: acciones de dominio del back (trigger) visibles en el detalle. */
  protected readonly triggerActions = computed<TriggerAction[]>(() => {
    const actions: ResourceAction[] = this.schema().actions ?? this.detail().actions ?? [];
    return actions.filter(isTriggerAction);
  });

  /**
   * R8.8: dispara un `trigger` y, si tocó datos (`reload`), fuerza la
   * relectura del registro. La confirmación (si el descriptor la pide) la
   * resuelve `actionService.run` — este método no decide por tipo.
   */
  protected async runTrigger(action: TriggerAction): Promise<void> {
    if (!this.api) return; // sin API no hay ruta que disparar
    const result = await this.actionService.run(action, {
      record: this.effectiveRecord(),
      resource: this.schema().id,
      api: this.api,
      router: this.router,
      toast: this.notifications,
      user: this.auth.user(),
      keyField: this.schema().keyField,
    });
    if (result.ok && result.reload) {
      this.refreshTick.update((tick) => tick + 1);
    }
  }

  /**
   * Agrupación, no formato: devuelve el campo y el valor crudo. El pintado
   * es cosa del registro (R4.2).
   *
   * R7.5: oculta campos según `field.access.read` (sólo UX; el back
   * vuelve a filtrar la respuesta).
   */
  private resolveFieldValue(key: string): FieldValue | null {
    const schema = this.schema();
    const rec = this.effectiveRecord();
    const field = schema.fields.find((f) => f.key === key);
    const raw = getValue(rec, key);

    // Una clave que ningún schema declara no tiene descriptor: se resuelve
    // como texto crudo, que era exactamente lo que hacía el `default` del
    // `formatValue` viejo.
    const declarado: FieldSchema = field ?? { key, label: key.replace(/_/g, ' '), type: 'text' };

    // R7.5: ocultar si el usuario no tiene permiso de lectura
    if (!this.auth.canReadField(declarado)) {
      return null;
    }

    return {
      key,
      label: field?.label ?? declarado.label,
      field: declarado,
      raw,
    };
  }

  /**
   * Valor vacío con el criterio de siempre (`null`, `undefined`, `''`): ni
   * el chip de la cabecera ni el `—` del cuerpo cambian de criterio.
   */
  protected vacio(valor: unknown): boolean {
    return valor === null || valor === undefined || valor === '';
  }

  /** Un historial sólo es historial si hay valor que recorrer. */
  private esHistorial(campo: FieldValue): boolean {
    return campo.field.type === 'list' && !this.vacio(campo.raw);
  }

  protected regularFields(section: DetailSection): FieldValue[] {
    return section.fields.filter((f) => !this.esHistorial(f));
  }

  protected listFields(section: DetailSection): FieldValue[] {
    return section.fields.filter((f) => this.esHistorial(f));
  }

  protected hasLargeContent(section: DetailSection): boolean {
    return section.fields.some((f) => this.esHistorial(f) || f.key === 'description');
  }

  /** Enlace y mensaje, resueltos por `resolveShare` (R3.10: una sola copia). */
  protected shareOf(action: CopyShareAction): ResolvedShare {
    return resolveShare(action, this.actionService.vars(this.effectiveRecord()));
  }
}
