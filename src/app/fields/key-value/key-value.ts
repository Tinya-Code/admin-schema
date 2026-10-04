import { Component, computed, inject, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';

import { LucideArrowDown, LucideArrowUp, LucideGripVertical, LucideTrash2 } from '@lucide/angular';
import type { KeyValueField, KeyValueItem } from '../../core/models/schema.model';
import { NotificationService } from '../../core/services/notification.service';
import { Button } from '../../shared/components/button/button';
import {
  appendPosition,
  computeMove,
  GAP,
  type PositionedItem,
} from '../../shared/utils/gap-sorting';
import { FieldAria } from '../field-aria';
import { childTree, itemTree, listTree, type RootTree } from '../field-node';

const TOOLBAR_BTN =
  'rounded p-1 text-neutral hover:bg-neutral/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Pares clave→valor (base.md §9 «ficha técnica»). Hoja: tabla con sus
 * propios `<input [formField]>` (nodos `key`/`value` del ítem) y no toca
 * FieldHost. `position` se calcula con gap-sorting igual que en `list`.
 */
@Component({
  selector: 'app-field-key-value',
  imports: [
    FieldAria,
    Button,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    FormField,
    LucideArrowDown,
    LucideArrowUp,
    LucideGripVertical,
    LucideTrash2,
  ],
  template: `
    @if (items().length === 0) {
      <p
        class="rounded-lg border border-dashed border-neutral/30 px-4 py-6 text-center text-sm text-neutral"
      >
        {{ field().emptyText ?? 'Sin elementos.' }}
      </p>
    } @else {
      <div class="overflow-x-auto rounded-xl border border-neutral/20 bg-surface">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-neutral/20 text-left text-xs font-medium text-neutral">
              <th class="w-10 px-3 py-2" scope="col"><span class="sr-only">Orden</span></th>
              <th class="px-3 py-2" scope="col">Clave</th>
              <th class="px-3 py-2" scope="col">Valor</th>
              <th class="w-28 px-3 py-2" scope="col"><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody
            cdkDropList
            [cdkDropListData]="items()"
            [cdkDropListDisabled]="!sortable()"
            (cdkDropListDropped)="onDrop($event)"
          >
            @for (item of items(); track $index; let i = $index) {
              <tr
                class="border-b border-neutral/10 last:border-b-0"
                cdkDrag
                [cdkDragDisabled]="!sortable()"
              >
                <td class="px-3 py-2 align-middle">
                  @if (sortable()) {
                    <button
                      type="button"
                      class="cursor-grab text-neutral hover:text-primary"
                      cdkDragHandle
                      [attr.aria-label]="'Reordenar fila ' + (i + 1)"
                      title="Arrastrar para reordenar"
                    >
                      <svg lucideGripVertical size="16" />
                    </button>
                  }
                </td>
                <td class="px-3 py-2">
                  <input
                    class="w-full rounded-lg border border-neutral/30 px-3 py-2 focus:border-primary focus:outline-2 focus:outline-primary/40"
                    type="text"
                    placeholder="Clave"
                    [attr.aria-label]="'Clave, fila ' + (i + 1)"
                    [id]="idPrefix() + '-key-' + i"
                    [formField]="fieldNode(i, 'key')"
                  />
                </td>
                <td class="px-3 py-2">
                  <input
                    class="w-full rounded-lg border border-neutral/30 px-3 py-2 focus:border-primary focus:outline-2 focus:outline-primary/40"
                    type="text"
                    placeholder="Valor"
                    [attr.aria-label]="'Valor, fila ' + (i + 1)"
                    [id]="idPrefix() + '-value-' + i"
                    [formField]="fieldNode(i, 'value')"
                  />
                </td>
                <td class="px-3 py-2">
                  <span class="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      class="{{ toolbarBtn }}"
                      [disabled]="i === 0"
                      [attr.aria-label]="'Subir fila ' + (i + 1)"
                      (click)="move(i, -1)"
                    >
                      <svg lucideArrowUp size="16" />
                    </button>
                    <button
                      type="button"
                      class="{{ toolbarBtn }}"
                      [disabled]="i === items().length - 1"
                      [attr.aria-label]="'Bajar fila ' + (i + 1)"
                      (click)="move(i, 1)"
                    >
                      <svg lucideArrowDown size="16" />
                    </button>
                    <button
                      type="button"
                      class="{{ toolbarBtn }}"
                      [disabled]="!canRemove()"
                      [attr.aria-label]="'Eliminar fila ' + (i + 1)"
                      (click)="remove(i)"
                    >
                      <svg lucideTrash2 size="16" />
                    </button>
                  </span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <div class="mt-3">
      <button app-button variant="outline" type="button" [disabled]="!canAdd()" (click)="add()">
        + {{ field().addLabel ?? 'Agregar especificación' }}
      </button>
    </div>
  `,
})
export class FieldKeyValue {
  readonly field = input.required<KeyValueField>();
  readonly tree = input.required<RootTree>();

  private readonly notifications = inject(NotificationService);

  private readonly itemsNode = computed(() =>
    listTree<KeyValueItem>(this.tree(), this.field().key),
  );
  private readonly state = computed(() => this.itemsNode()());
  /** Prefijo estable del campo para los id de cada celda (§8). */
  protected readonly idPrefix = computed(() => this.state().name());
  protected readonly items = computed(() => this.state().value() ?? []);

  protected readonly sortable = computed(() => this.field().sortable ?? true);
  protected readonly toolbarBtn = TOOLBAR_BTN;

  /** Nodo de `key`/`value` del ítem; se llama fresco en cada render (NG01904). */
  protected fieldNode(
    index: number,
    column: 'key' | 'value',
  ): ReturnType<typeof childTree<string>> {
    return childTree<string>(itemTree(this.itemsNode(), index), column);
  }

  protected canAdd(): boolean {
    const max = this.field().max;
    return max === undefined || this.items().length < max;
  }

  protected canRemove(): boolean {
    return this.items().length > (this.field().min ?? 0);
  }

  protected add(): void {
    if (!this.canAdd()) {
      return;
    }
    const positionKey = this.field().positionField;
    const row: KeyValueItem & Record<string, unknown> = { key: '', value: '' };
    if (positionKey !== undefined) {
      row[positionKey] = appendPosition(this.positioned());
    }
    this.updateItems((next) => {
      next.push(row);
    });
  }

  protected move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= this.items().length) {
      return;
    }
    this.applyMove(index, target);
  }

  protected onDrop(event: CdkDragDrop<KeyValueItem[]>): void {
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    this.applyMove(event.previousIndex, event.currentIndex);
  }

  protected async remove(index: number): Promise<void> {
    if (!this.canRemove()) {
      return;
    }
    const row = this.items()[index];
    if (row !== undefined && (row.key.trim() !== '' || row.value.trim() !== '')) {
      const accepted = await this.notifications.confirm({
        title: `Eliminar fila ${index + 1}`,
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
  }

  /** Mueve y recalcula `position` (base.md §8): cambios antes del splice. */
  private applyMove(from: number, to: number): void {
    const positionKey = this.field().positionField;
    this.updateItems((next) => {
      if (positionKey !== undefined) {
        const result = computeMove(this.positioned(), String(from), to);
        for (const change of result.changes) {
          const row = next[Number(change.key)] as
            (KeyValueItem & Record<string, unknown>) | undefined;
          if (row !== undefined) {
            row[positionKey] = change.position;
          }
        }
      }
      moveItemInArray(next, from, to);
    });
  }

  private positioned(): PositionedItem[] {
    const positionKey = this.field().positionField;
    return this.items().map((item, index) => {
      const raw =
        positionKey !== undefined
          ? (item as unknown as Record<string, unknown>)[positionKey]
          : undefined;
      // Fallback: un registro viejo sin `position` se numera como rebalanceo.
      return {
        key: String(index),
        position: typeof raw === 'number' ? raw : (index + 1) * GAP,
      };
    });
  }

  private updateItems(mutator: (next: KeyValueItem[]) => void): void {
    this.state().controlValue.update((current) => {
      const next = [...current];
      mutator(next);
      return next;
    });
  }
}
