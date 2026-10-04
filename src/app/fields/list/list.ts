import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal, type TemplateRef } from '@angular/core';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';

import { LucideArrowDown, LucideArrowUp, LucideGripVertical, LucideTrash2 } from '@lucide/angular';
import type { ListField } from '../../core/models/schema.model';
import { NotificationService } from '../../core/services/notification.service';
import { Button } from '../../shared/components/button/button';
import { colSpanClass } from '../../shared/utils/col-span';
import {
  appendPosition,
  computeMove,
  GAP,
  type PositionedItem,
} from '../../shared/utils/gap-sorting';
import { seedFields } from '../../shared/utils/seed';
import { itemTree, listTree, type ListChildContext, type RootTree } from '../field-node';

const TOOLBAR_BTN =
  'rounded p-1 text-neutral hover:bg-neutral/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Lista de ítems (base.md §6): asa de arrastre, subir/bajar, eliminar con
 * confirmación (sólo si el ítem tiene contenido) y agregar respetando
 * `min`/`max`.
 *
 * **Los hijos los renderiza el despachador**: este componente recibe el
 * `TemplateRef` (#childTpl, declarado en el `@case` de `field-host`) y lo
 * instancia una vez por ítem con `ngTemplateOutlet`. No importa FieldHost —
 * un import mutuo revienta en runtime (ciclo-check del repo).
 *
 * El orden de visualización ES el orden del arreglo modelo; `position`
 * (gap-sorting, base.md §8) se calcula junto con cada mutación y viaja en el
 * payload. Un hueco que deja un `remove` se autocura en el siguiente `move`.
 */
@Component({
  selector: 'app-field-list',
  imports: [
    Button,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    LucideArrowDown,
    LucideArrowUp,
    LucideGripVertical,
    LucideTrash2,
    NgTemplateOutlet,
  ],
  template: `
    @if (items().length === 0) {
      <p
        class="rounded-lg border border-dashed border-neutral/30 px-4 py-6 text-center text-sm text-neutral"
      >
        {{ field().emptyText ?? 'Sin elementos.' }}
      </p>
    } @else {
      <div
        cdkDropList
        class="space-y-3"
        [cdkDropListData]="items()"
        [cdkDropListDisabled]="!sortable()"
        (cdkDropListDropped)="onDrop($event)"
      >
        @for (item of items(); track $index; let i = $index) {
          <div
            class="rounded-xl border border-neutral/20 bg-surface p-3"
            cdkDrag
            [cdkDragDisabled]="!sortable()"
          >
            <div class="mb-2 flex items-center gap-1.5">
              @if (sortable()) {
                <button
                  type="button"
                  class="cursor-grab text-neutral hover:text-primary"
                  cdkDragHandle
                  [attr.aria-label]="'Reordenar elemento ' + (i + 1)"
                  title="Arrastrar para reordenar"
                >
                  <svg lucideGripVertical size="16" />
                </button>
              }
              @if (isAccordion()) {
                <button
                  type="button"
                  class="flex min-w-0 items-center gap-1 text-sm font-medium"
                  [attr.aria-expanded]="openOf(i)"
                  (click)="toggle(i)"
                >
                  <span aria-hidden="true">{{ openOf(i) ? '▾' : '▸' }}</span>
                  <span class="truncate">{{ titleOf(i) }}</span>
                </button>
              }
              @if (isPrimary(i)) {
                <span
                  class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                >
                  Principal
                </span>
              }
              @if (hasProblem(i)) {
                <span class="text-xs font-medium text-danger">Revisar</span>
              }
              <span class="ml-auto flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="{{ toolbarBtn }}"
                  [disabled]="i === 0"
                  [attr.aria-label]="'Subir elemento ' + (i + 1)"
                  (click)="move(i, -1)"
                >
                  <svg lucideArrowUp size="16" />
                </button>
                <button
                  type="button"
                  class="{{ toolbarBtn }}"
                  [disabled]="i === items().length - 1"
                  [attr.aria-label]="'Bajar elemento ' + (i + 1)"
                  (click)="move(i, 1)"
                >
                  <svg lucideArrowDown size="16" />
                </button>
                <button
                  type="button"
                  class="{{ toolbarBtn }}"
                  [disabled]="!canRemove()"
                  [attr.aria-label]="'Eliminar elemento ' + (i + 1)"
                  (click)="remove(i)"
                >
                  <svg lucideTrash2 size="16" />
                </button>
              </span>
            </div>
            @if (!isAccordion() || openOf(i)) {
              @if (isRow()) {
                <div class="flex flex-wrap items-start gap-3">
                  <ng-container
                    [ngTemplateOutlet]="childTemplate()"
                    [ngTemplateOutletContext]="childContext(i)"
                  />
                </div>
              } @else {
                <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-12">
                  <ng-container
                    [ngTemplateOutlet]="childTemplate()"
                    [ngTemplateOutletContext]="childContext(i)"
                  />
                </div>
              }
            }
          </div>
        }
      </div>
    }

    <div class="mt-3">
      <button app-button variant="outline" type="button" [disabled]="!canAdd()" (click)="add()">
        + {{ field().addLabel ?? 'Agregar elemento' }}
      </button>
    </div>
  `,
})
export class FieldList {
  readonly field = input.required<ListField>();
  readonly tree = input.required<RootTree>();
  readonly serverErrors = input<Record<string, string>>({});
  readonly pathPrefix = input('');
  readonly exists = input(false);
  /** Template de los hijos, declarado en el `@case` del despachador. */
  readonly childTemplate = input.required<TemplateRef<ListChildContext>>();

  private readonly notifications = inject(NotificationService);

  /** Intento de apertura por ítem (`undefined` → sigue el auto-open). */
  private readonly intent = signal<Record<number, boolean>>({});

  private readonly itemsTree = computed(() =>
    listTree<Record<string, unknown>>(this.tree(), this.field().key),
  );
  private readonly state = computed(() => this.itemsTree()());
  protected readonly items = computed(() => this.state().value() ?? []);

  protected readonly sortable = computed(() => this.field().sortable ?? true);
  /** Clase fija de la barra de ícono (literal: Tailwind v4 es JIT). */
  protected readonly toolbarBtn = TOOLBAR_BTN;

  protected canAdd(): boolean {
    const max = this.field().max;
    return max === undefined || this.items().length < max;
  }

  protected canRemove(): boolean {
    return this.items().length > (this.field().min ?? 0);
  }

  protected isAccordion(): boolean {
    return this.field().itemDisplay === 'accordion';
  }

  protected isRow(): boolean {
    return this.field().itemDisplay === 'row';
  }

  protected isPrimary(index: number): boolean {
    return (this.field().primaryFirst ?? false) && index === 0;
  }

  protected titleOf(index: number): string {
    const item = this.items()[index];
    const key = this.field().itemTitle;
    const value = key !== undefined && item !== undefined ? item[key] : undefined;
    return typeof value === 'string' && value !== '' ? value : `#${index + 1}`;
  }

  // ── Ítem abierto (accordion) ──

  protected openOf(index: number): boolean {
    const forced = this.intent()[index];
    if (forced !== undefined) {
      return forced;
    }
    return this.hasProblem(index);
  }

  protected toggle(index: number): void {
    const willOpen = !this.openOf(index);
    this.intent.update((map) => ({ ...map, [index]: willOpen }));
  }

  /** Inválido+tocado (agrega hijos) o error del backend bajo `key[i].`. */
  hasProblem(index: number): boolean {
    const state = itemTree(this.itemsTree(), index)();
    if (state.invalid() && state.touched()) {
      return true;
    }
    const prefix = `${this.pathPrefix()}${this.field().key}[${index}].`;
    return Object.keys(this.serverErrors()).some((path) => path.startsWith(prefix));
  }

  // ── Mutaciones (todas sobre `controlValue` → marcan `dirty` solas) ──

  protected add(): void {
    if (!this.canAdd()) {
      return;
    }
    const item = seedFields(this.field().itemFields);
    const positionKey = this.field().positionField;
    if (positionKey !== undefined) {
      item[positionKey] = appendPosition(this.positioned());
    }
    const newIndex = this.items().length;
    this.updateItems((next) => {
      next.push(item);
    });
    // El ítem nuevo arranca visible.
    this.intent.update((map) => ({ ...map, [newIndex]: true }));
  }

  protected move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= this.items().length) {
      return;
    }
    this.applyMove(index, target);
  }

  protected onDrop(event: CdkDragDrop<Record<string, unknown>[]>): void {
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    this.applyMove(event.previousIndex, event.currentIndex);
  }

  protected async remove(index: number): Promise<void> {
    if (!this.canRemove()) {
      return;
    }
    if (this.hasContent(index)) {
      const accepted = await this.notifications.confirm({
        title: `Eliminar elemento ${index + 1}`,
        message: 'Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar',
        cancelLabel: 'Cancelar',
      });
      if (!accepted) {
        return;
      }
    }
    this.updateItems((next) => {
      next.splice(index, 1);
    });
    this.intent.set({});
  }

  /**
   * Contexto fresco por ítem: los nodos se atan a la identidad (NG01904).
   *
   * `$implicit` lleva el objeto completo: en el `ng-template` del host,
   * `let-child` (sin alias) lee `$implicit` — `NgTemplateOutlet` reparte el
   * contexto como propiedades top-level, no existe un alias mágico.
   */
  protected childContext(index: number): ListChildContext & { $implicit: ListChildContext } {
    const context: ListChildContext = {
      fields: this.field().itemFields,
      tree: itemTree(this.itemsTree(), index),
      prefix: `${this.pathPrefix()}${this.field().key}[${index}].`,
      errors: this.serverErrors(),
      exists: this.exists(),
      row: this.isRow(),
      colSpan: colSpanClass,
    };
    return { ...context, $implicit: context };
  }

  /** Ítem con algo distinto de sus `default` → pide confirmación. */
  private hasContent(index: number): boolean {
    const item = this.items()[index];
    if (item === undefined) {
      return false;
    }
    return JSON.stringify(item) !== JSON.stringify(seedFields(this.field().itemFields));
  }

  /**
   * Mueve el ítem y recalcula su `position` (base.md §8): los cambios de
   * posición se aplican ANTES del splice porque las claves referencian los
   * índices originales.
   */
  private applyMove(from: number, to: number): void {
    const positionKey = this.field().positionField;
    this.updateItems((next) => {
      if (positionKey !== undefined) {
        const result = computeMove(this.positioned(), String(from), to);
        for (const change of result.changes) {
          const item = next[Number(change.key)];
          if (item !== undefined) {
            item[positionKey] = change.position;
          }
        }
      }
      moveItemInArray(next, from, to);
    });
    this.intent.set({});
  }

  /** Posiciones actuales; sin `positionField` no se calculan. */
  private positioned(): PositionedItem[] {
    const positionKey = this.field().positionField;
    return this.items().map((item, index) => {
      const raw = positionKey !== undefined ? item[positionKey] : undefined;
      // Fallback: un registro viejo sin `position` se numera como rebalanceo.
      return {
        key: String(index),
        position: typeof raw === 'number' ? raw : (index + 1) * GAP,
      };
    });
  }

  private updateItems(mutator: (next: Record<string, unknown>[]) => void): void {
    this.state().controlValue.update((current) => {
      const next = [...current];
      mutator(next);
      return next;
    });
  }
}
