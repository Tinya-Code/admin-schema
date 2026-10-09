import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  LucideChevronDown,
  LucideChevronUp,
  LucideDynamicIcon,
  LucideEye,
  LucideGripVertical,
  LucidePencil,
  LucidePlus,
  LucideRotateCw,
  LucideTrash2,
  LucideZap,
} from '@lucide/angular';
import type { LucideIcon } from '@lucide/angular';
import { actionType, getAction } from '../../actions/action-registry';
import { ActionService } from '../../actions/action-service';
import { ApiError } from '../../core/models/api.model';
import type {
  FieldSchema,
  ListColumn,
  ListColumnFormat,
  ListFilter,
  ResourceAction,
  ResourceSchema,
  SelectOption,
} from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { DrawerForm } from '../drawer-form/drawer-form';
import { RenderHost } from '../../core/registry/render-host';
import { getSchema } from '../../schemas/registry';
import { Button } from '../../shared/components/button/button';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { getValue } from '../../shared/utils/field-path';
import { formatoDeColumna } from '../../columns/column-defaults';
import type { ColumnCell } from '../../columns/column-cell';

type Row = Record<string, unknown>;
type Status = 'loading' | 'ready' | 'error';

const BOOLEAN_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'Todos' },
  { value: 'yes', label: 'Sí' },
  { value: 'no', label: 'No' },
];

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Listado genérico de una colección (base.md §10 «Listado»): tabla desde
 * `listColumns` con los 7 formatos **resueltos por el registro** (R4.3),
 * búsqueda/filtros **en el cliente** (el
 * contrato de api.md no define parámetros de consulta: el endpoint admin
 * devuelve todos los registros), interruptor `active`, acciones de fila y
 * estados universales (skeleton, vacío, error con reintento).
 */
@Component({
  selector: 'app-list-view',
  imports: [
    Button,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    DrawerForm,
    EmptyState,
    LucideChevronDown,
    LucideChevronUp,
    LucideEye,
    LucideGripVertical,
    LucidePencil,
    LucidePlus,
    LucideRotateCw,
    LucideDynamicIcon,
    LucideTrash2,
    LucideZap,
    RenderHost,
    Skeleton,
  ],
  template: `
    <section class="space-y-4" aria-label="Listado" [attr.aria-busy]="status() === 'loading'">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div class="flex flex-wrap items-end gap-3">
          @if (schema().search?.length) {
            <label class="flex flex-col gap-1 text-xs font-medium text-neutral">
              Buscar
              <input
                type="search"
                class="w-56 rounded-lg border border-neutral/30 bg-surface px-3 py-2 text-sm"
                placeholder="Buscar…"
                [value]="query()"
                (input)="setQuery(inputValue($event))"
              />
            </label>
          }
          @for (filter of schema().filters ?? []; track filter.key) {
            <label class="flex flex-col gap-1 text-xs font-medium text-neutral">
              {{ filter.label }}
              @if (filter.type === 'text') {
                <input
                  type="search"
                  class="w-44 rounded-lg border border-neutral/30 bg-surface px-3 py-2 text-sm"
                  [value]="filterValues()[filter.key] ?? ''"
                  (input)="setFilter(filter.key, inputValue($event))"
                />
              } @else {
                <select
                  class="w-44 rounded-lg border border-neutral/30 bg-surface px-3 py-2 text-sm"
                  [value]="filterValues()[filter.key] ?? ''"
                  (change)="setFilter(filter.key, selectValue($event))"
                >
                  @for (option of filterOptions(filter); track option.value) {
                    <option [value]="option.value">{{ option.label }}</option>
                  }
                </select>
              }
            </label>
          }
        </div>
        @if (canCreate()) {
          <button app-button type="button" (click)="goCreate()">
            <svg lucidePlus size="16" />
            Crear {{ schema().label }}
          </button>
        }
      </div>

      @switch (status()) {
        @case ('loading') {
          <app-skeleton [lines]="6" [height]="44" />
        }
        @case ('error') {
          <app-empty-state
            title="No se pudo cargar el listado"
            message="Revisa tu conexión e intenta de nuevo."
          >
            <button app-button variant="outline" type="button" (click)="retry()">
              <svg lucideRotateCw size="16" />
              Reintentar
            </button>
          </app-empty-state>
        }
        @case ('ready') {
          @if (visibleRows().length === 0) {
            <app-empty-state
              [title]="rows().length === 0 ? 'Sin registros' : 'Sin resultados'"
              [message]="
                rows().length === 0
                  ? 'Todavía no hay registros en este recurso.'
                  : 'Ningún registro coincide con la búsqueda o los filtros.'
              "
            >
              @if (rows().length > 0) {
                <button app-button variant="outline" type="button" (click)="clearFilters()">
                  Limpiar filtros
                </button>
              } @else if (canCreate()) {
                <button app-button type="button" (click)="goCreate()">
                  <svg lucidePlus size="16" />
                  Crear el primero
                </button>
              }
            </app-empty-state>
          } @else {
            <div class="overflow-x-auto rounded-xl border border-neutral/20 bg-surface">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-neutral/20 text-left text-xs uppercase text-neutral">
                    @if (canReorder()) {
                      <th scope="col" class="w-16 px-2 py-3 font-medium">
                        <span class="sr-only">Orden</span>
                      </th>
                    }
                    @for (column of schema().listColumns; track column.key) {
                      <th scope="col" class="px-4 py-3 font-medium">
                        {{ column.label }}
                      </th>
                    }
                    @if (hasRowActions()) {
                      <th scope="col" class="px-4 py-3 text-right font-medium">Acciones</th>
                    }
                  </tr>
                </thead>
                <tbody
                  cdkDropList
                  [cdkDropListData]="visibleRows()"
                  [cdkDropListDisabled]="dropDisabled()"
                  (cdkDropListDropped)="onDrop($event)"
                >
                  @for (row of visibleRows(); track keyOf(row); let i = $index) {
                    <tr
                      class="border-b border-neutral/10 last:border-0 hover:bg-neutral/5 transition-colors"
                      [class.cursor-pointer]="isRowClickable()"
                      cdkDrag
                      [cdkDragDisabled]="dropDisabled()"
                      (click)="onRowClick(row)"
                    >
                      @if (canReorder()) {
                        <td class="px-2 py-2.5 align-middle" (click)="$event.stopPropagation()">
                          <div class="flex items-center gap-1">
                            <button
                              type="button"
                              class="cursor-grab text-neutral hover:text-primary"
                              cdkDragHandle
                              [attr.aria-label]="'Reordenar ' + titleOf(row)"
                              title="Arrastrar para reordenar"
                            >
                              <svg lucideGripVertical size="16" />
                            </button>
                            <span class="flex flex-col leading-none">
                              <button
                                type="button"
                                class="px-1 text-xs text-neutral hover:text-primary disabled:opacity-30"
                                [disabled]="i === 0 || reordering()"
                                [attr.aria-label]="'Subir ' + titleOf(row)"
                                (click)="moveBy(keyOf(row), -1)"
                              >
                                <svg lucideChevronUp size="16" />
                              </button>
                              <button
                                type="button"
                                class="px-1 text-xs text-neutral hover:text-primary disabled:opacity-30"
                                [disabled]="i === visibleRows().length - 1 || reordering()"
                                [attr.aria-label]="'Bajar ' + titleOf(row)"
                                (click)="moveBy(keyOf(row), 1)"
                              >
                                <svg lucideChevronDown size="16" />
                              </button>
                            </span>
                          </div>
                        </td>
                      }
                      @for (column of schema().listColumns; track column.key) {
                        <td class="px-4 py-2.5 align-middle">
                          <!-- Los 7 formatos salen del registro (R4.3):
                               la vista sólo elige cuál y entrega la celda. -->
                          <app-render-host
                            kind="column-format"
                            [type]="formatOf(column)"
                            [config]="column"
                            [data]="cellOf(row, column)"
                          />
                        </td>
                      }
                      @if (hasRowActions()) {
                        <td class="px-4 py-2.5" (click)="$event.stopPropagation()">
                          <div class="flex items-center justify-end gap-1">
                            @if (schema().detail?.enabled) {
                              <button
                                app-button
                                variant="ghost"
                                type="button"
                                (click)="goView(row)"
                                title="Ver ficha de detalle"
                                class="h-8 px-2.5 text-xs text-neutral-light hover:text-primary hover:bg-primary/10"
                              >
                                <svg lucideEye size="15" />
                                <span>Ver</span>
                              </button>
                            }
                            @for (action of schema().actions ?? []; track action.id) {
                              <button
                                app-button
                                variant="ghost"
                                type="button"
                                [title]="action.label"
                                [attr.aria-label]="action.label"
                                (click)="runAction(action, row)"
                                class="h-8 px-2 text-xs text-neutral hover:text-primary hover:bg-primary/10"
                              >
                                @let actionIcon = iconOf(action);
                                @if (actionIcon) {
                                  <svg [lucideIcon]="actionIcon" size="15" />
                                } @else {
                                  {{ action.label }}
                                }
                              </button>
                            }
                            @if (canQuickEdit()) {
                              <button
                                app-button
                                variant="ghost"
                                type="button"
                                (click)="quickEditRow.set(row)"
                                title="Edición rápida"
                                class="h-8 px-2 text-xs text-neutral hover:text-primary hover:bg-neutral/10"
                              >
                                <svg lucideZap size="15" />
                                <span>Edición rápida</span>
                              </button>
                            }
                            @if (canUpdate()) {
                              <button
                                app-button
                                variant="ghost"
                                type="button"
                                (click)="goEdit(row)"
                                title="Editar registro"
                                class="h-8 px-2.5 text-xs text-primary hover:bg-primary/10"
                              >
                                <svg lucidePencil size="15" />
                                <span>Editar</span>
                              </button>
                            }
                            @if (canRemove()) {
                              <button
                                app-button
                                variant="ghost"
                                type="button"
                                (click)="removeRow(row)"
                                title="Eliminar registro"
                                class="h-8 px-2 text-xs text-danger hover:bg-danger/10"
                              >
                                <svg lucideTrash2 size="15" />
                                <span>Eliminar</span>
                              </button>
                            }
                          </div>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      }

      @if (quickEditRow(); as row) {
        <app-drawer-form
          [open]="true"
          [schema]="schema()"
          mode="edit"
          [recordKey]="keyOf(row)"
          [fields]="quickEditFields()"
          title="Edición rápida"
          size="sm"
          (close)="quickEditRow.set(null)"
          (saved)="quickEditSaved()"
        />
      }
    </section>
  `,
})
export class ListView {
  readonly schema = input.required<ResourceSchema>();

  /** Emitido al pulsar «Editar» cuando `schema.detail.enabled === true`. */
  readonly viewRecord = output<Row>();

  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly notifications = inject(NotificationService);
  private readonly actionService = inject(ActionService);

  readonly status = signal<Status>('loading');
  readonly rows = signal<Row[]>([]);
  readonly query = signal('');
  readonly filterValues = signal<Record<string, string>>({});
  /** Clave del registro cuyo interruptor `active` está guardando. */
  readonly savingKey = signal<string | null>(null);
  /** Fila que se está editando en el drawer (plan 6.5); `null` = cerrado. */
  readonly quickEditRow = signal<Row | null>(null);

  /** Evita que una respuesta lenta pise el recurso ya cambiado. */
  private loadEpoch = 0;

  constructor() {
    effect(() => {
      const schema = this.schema();
      this.query.set('');
      this.filterValues.set({});
      void this.load(schema);
    });
  }

  /** Búsqueda + filtros + orden `positionField` ascendente (cliente). */
  readonly visibleRows = computed(() => {
    const schema = this.schema();
    let rows = this.rows();

    const query = this.query().trim().toLowerCase();
    if (query !== '' && schema.search?.length) {
      rows = rows.filter((row) =>
        schema.search!.some((key) =>
          String(getValue(row, key) ?? '')
            .toLowerCase()
            .includes(query),
        ),
      );
    }

    for (const filter of schema.filters ?? []) {
      const value = this.filterValues()[filter.key] ?? '';
      if (value === '') {
        continue;
      }
      rows = rows.filter((row) => {
        const cell = getValue(row, filter.key);
        if (filter.type === 'boolean') {
          return (cell === true || cell === 'true') === (value === 'yes');
        }
        if (filter.type === 'select') {
          return String(cell ?? '') === value;
        }
        return String(cell ?? '')
          .toLowerCase()
          .includes(value.toLowerCase());
      });
    }

    const positionField = schema.positionField;
    if (positionField) {
      const positionOf = (row: Row): number => {
        const position = Number(getValue(row, positionField));
        return Number.isFinite(position) ? position : Number.POSITIVE_INFINITY;
      };
      rows = [...rows].sort((a, b) => positionOf(a) - positionOf(b));
    }

    return rows;
  });

  readonly currencyCode = computed(() => {
    // Moneda del singleton `site` (campo `currency`); Fase 12 podrá usar el
    // valor real cargado del backend.
    const field = getSchema('site')?.fields.find((f) => f.key === 'currency');
    return field?.type === 'text' && field.default ? field.default : 'USD';
  });

  private readonly permissions = computed(() => this.schema().permissions);
  readonly canCreate = computed(() => this.permissions()?.create !== false);
  readonly canUpdate = computed(() => this.permissions()?.update !== false);
  readonly canRemove = computed(() => this.permissions()?.remove !== false);

  /** El atajo existe sólo si el schema lo declara y hay permiso de editar. */
  readonly canQuickEdit = computed(
    () => this.canUpdate() && (this.schema().quickEdit?.length ?? 0) > 0,
  );

  /** Subconjunto de campos del drawer, en el orden declarado en el schema. */
  readonly quickEditFields = computed<readonly FieldSchema[]>(() => {
    const keys = this.schema().quickEdit ?? [];
    const byKey = new Map(this.schema().fields.map((field) => [field.key, field]));
    return keys
      .map((key) => byKey.get(key))
      .filter((field): field is FieldSchema => field !== undefined);
  });

  readonly hasRowActions = computed(
    () => this.canUpdate() || this.canRemove() || (this.schema().actions?.length ?? 0) > 0,
  );

  // ── Reordenamiento (base.md §8) ──

  /** Mientras persiste un movimiento: bloquea drag y botones. */
  readonly reordering = signal(false);

  /** Sin búsqueda ni filtros aplicados (base.md §10). */
  private readonly hasActiveFilters = computed(() => {
    if (this.query().trim() !== '') {
      return true;
    }
    return Object.values(this.filterValues()).some((value) => value !== '');
  });

  /**
   * Reordenable sólo si el schema lo declara, el permiso lo permite y no hay
   * filtros activos: con filtros filtrados, el índice visual no corresponde a
   * la posición real.
   */
  readonly canReorder = computed(() => {
    const schema = this.schema();
    return (
      schema.sortable === true &&
      schema.positionField !== undefined &&
      schema.permissions?.reorder !== false &&
      !this.hasActiveFilters()
    );
  });

  readonly dropDisabled = computed(() => !this.canReorder() || this.reordering());

  // ── Acciones de datos ──

  setQuery(value: string): void {
    this.query.set(value);
  }

  setFilter(key: string, value: string): void {
    this.filterValues.update((values) => ({ ...values, [key]: value }));
  }

  clearFilters(): void {
    this.query.set('');
    this.filterValues.set({});
  }

  retry(): void {
    void this.load(this.schema());
  }

  isRowClickable(): boolean {
    return Boolean(this.schema().detail?.enabled || this.canUpdate());
  }

  goView(row: Row): void {
    this.viewRecord.emit(row);
  }

  onRowClick(row: Row): void {
    if (this.schema().detail?.enabled) {
      this.goView(row);
    } else if (this.canUpdate()) {
      this.goEdit(row);
    }
  }

  goCreate(): void {
    void this.router.navigate(['/', this.schema().id, 'new']);
  }

  goEdit(row: Row): void {
    if (this.schema().detail?.enabled === true) {
      this.viewRecord.emit(row);
      return;
    }
    void this.router.navigate(['/', this.schema().id, this.keyOf(row), 'edit']);
  }

  /** Cerró con guardado: se recarga la fila (la respuesta puede venir achatada). */
  quickEditSaved(): void {
    this.quickEditRow.set(null);
    void this.load(this.schema());
  }

  async toggleActive(row: Row, checked: boolean): Promise<void> {
    const schema = this.schema();
    const key = this.keyOf(row);
    this.savingKey.set(key);
    try {
      await firstValueFrom(this.api.update(schema.endpoint, key, { ...row, active: checked }));
      this.rows.update((rows) =>
        rows.map((candidate) =>
          this.keyOf(candidate) === key ? { ...candidate, active: checked } : candidate,
        ),
      );
    } catch (err) {
      // El cambio no se guardó: la re-renderización revierte el interruptor.
      this.notifications.error(errorMessage(err, 'No se pudo actualizar el registro.'));
    } finally {
      this.savingKey.set(null);
    }
  }

  /** Drop del CDK: `currentIndex` ya es el índice en la lista sin el elemento. */
  onDrop(event: CdkDragDrop<Row[]>): void {
    if (event.previousContainer !== event.container || event.previousIndex === event.currentIndex) {
      return;
    }
    const row = this.visibleRows()[event.previousIndex];
    if (row !== undefined) {
      void this.moveRow(this.keyOf(row), event.currentIndex);
    }
  }

  /** Botones subir/bajar (accesibilidad y móvil, base.md §13.10). */
  moveBy(key: string, delta: -1 | 1): void {
    const index = this.visibleRows().findIndex((row) => this.keyOf(row) === key);
    if (index < 0) {
      return;
    }
    void this.moveRow(key, index + delta);
  }

  /**
   * Un movimiento → UNA intención al backend (baseapi §2.3 y §9):
   * `{ reorder: { key, after | toStart | toEnd } }`, nunca posiciones
   * calculadas. El índice objetivo es la posición FINAL del registro (el
   * `currentIndex` del CDK ya es el índice de inserción en la lista sin el
   * elemento, idéntico al índice final; subir/bajar suma/resta 1). El
   * backend re-balancea, recalcula `position` y devuelve el listado fresco:
   * sin escrituras optimistas — si falla, no cambió nada. `gap-sorting`
   * quedó sólo para los campos con listas locales.
   */
  private async moveRow(key: string, targetIndex: number): Promise<void> {
    const schema = this.schema();
    const path = schema.endpoint.list;
    if (!path || !schema.positionField || this.reordering()) {
      return;
    }
    const rows = this.visibleRows();
    const from = rows.findIndex((row) => this.keyOf(row) === key);
    if (from < 0) {
      return;
    }

    // Índice final deseado, acotado a la lista SIN el elemento movido.
    const without = rows.filter((row) => this.keyOf(row) !== key);
    const target = Math.min(Math.max(targetIndex, 0), without.length);
    if (target === from) {
      return;
    }

    const reorder: Record<string, unknown> =
      target === 0
        ? { key, toStart: true }
        : target >= without.length
          ? { key, toEnd: true }
          : { key, after: this.keyOf(without[target - 1]) };

    this.reordering.set(true);
    try {
      const fresh = await firstValueFrom(this.api.request<Row[]>('PUT', path, { reorder }));
      if (Array.isArray(fresh)) {
        this.rows.set(fresh);
      }
      this.notifications.success('Orden actualizado.');
    } catch (err) {
      this.notifications.error(errorMessage(err, 'No se pudo guardar el orden.'));
    } finally {
      this.reordering.set(false);
    }
  }

  async removeRow(row: Row): Promise<void> {
    const schema = this.schema();
    const key = this.keyOf(row);
    const accepted = await this.notifications.confirm({
      title: `Eliminar «${this.titleOf(row)}»`,
      message: 'Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
    });
    if (!accepted) {
      return;
    }
    try {
      await firstValueFrom(this.api.remove(schema.endpoint, key));
      this.notifications.success('Registro eliminado.');
      this.rows.update((rows) => rows.filter((candidate) => this.keyOf(candidate) !== key));
    } catch (err) {
      this.notifications.error(errorMessage(err, 'No se pudo eliminar el registro.'));
    }
  }

  /**
   * Ejecuta una acción del schema. El comportamiento vive en el registro de
   * acciones (R3.9–R3.11): la vista sólo aporta el registro y los puertos.
   */
  async runAction(action: ResourceAction, row: Row): Promise<void> {
    await this.actionService.run(action, {
      record: row,
      resource: this.schema().id,
      api: this.api,
      router: this.router,
      toast: this.notifications,
      user: this.auth.user(),
      keyField: this.schema().keyField,
    });
  }

  /** Icono que el descriptor declara para la acción; sin él, el rótulo. */
  protected iconOf(action: ResourceAction): LucideIcon | undefined {
    return getAction(actionType(action))?.icon;
  }

  // ── Helpers de celda (uso en template) ──

  keyOf(row: Row): string {
    return String(row[this.schema().keyField] ?? '');
  }

  titleOf(row: Row): string {
    return String(row[this.schema().titleField] ?? '');
  }

  /**
   * Formato efectivo de la columna (R4.4 · «declarada, no implícita»).
   *
   * `column.format` sólo sobreescribe; si no, manda la tabla de
   * `column-defaults` según el `type` del campo — nunca el `?? 'text'`
   * implícito que había.
   */
  formatOf(column: ListColumn): ListColumnFormat {
    return formatoDeColumna(column, this.schema().fields);
  }

  /**
   * Contexto de la celda que recibe el formato (R4.3 · `extras.data`).
   *
   * Concentra aquí lo que sólo la vista sabe — permisos, moneda, guardado y
   * la escritura de la fila — para que «añadir un formato» no la toque.
   */
  cellOf(row: Row, column: ListColumn): ColumnCell {
    return {
      row,
      column,
      fields: this.schema().fields,
      title: this.titleOf(row),
      canUpdate: this.canUpdate(),
      saving: this.savingKey() === this.keyOf(row),
      currency: this.currencyCode(),
      toggle: (checked: boolean) => void this.toggleActive(row, checked),
    };
  }

  filterOptions(filter: ListFilter): SelectOption[] {
    if (filter.type === 'boolean') {
      return BOOLEAN_FILTER_OPTIONS;
    }
    if (filter.type === 'select') {
      return [{ value: '', label: 'Todos' }, ...(filter.options ?? [])];
    }
    return [];
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  private async load(schema: ResourceSchema): Promise<void> {
    const epoch = ++this.loadEpoch;
    this.status.set('loading');
    try {
      const rows = await firstValueFrom(this.api.list<Row>(schema.endpoint));
      if (epoch !== this.loadEpoch) {
        return;
      }
      this.rows.set(Array.isArray(rows) ? rows : []);
      this.status.set('ready');
    } catch {
      if (epoch !== this.loadEpoch) {
        return;
      }
      this.status.set('error');
    }
  }
}
