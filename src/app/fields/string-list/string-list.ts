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
import type { StringListField } from '../../core/models/schema.model';
import { NotificationService } from '../../core/services/notification.service';
import { Button } from '../../shared/components/button/button';
import { FieldAria } from '../field-aria';
import { childTree, stringItemTree, type RootTree } from '../field-node';

const TOOLBAR_BTN =
  'rounded p-1 text-neutral hover:bg-neutral/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Lista de cadenas (base.md §9: `text`, `url` o `email` por ítem).
 *
 * Hoja: renderiza sus propios `<input [formField]>` (el nodo de cada ítem es
 * `FieldTree<string>`) y no toca FieldHost. Los ítems escalares no pueden
 * llevar `position`: si el schema la declara, el orden viaja como orden del
 * arreglo y el backend renumera (api.md R3).
 */
@Component({
  selector: 'app-field-string-list',
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
      <div
        cdkDropList
        class="space-y-2"
        [cdkDropListData]="items()"
        [cdkDropListDisabled]="!sortable()"
        (cdkDropListDropped)="onDrop($event)"
      >
        @for (item of items(); track $index; let i = $index) {
          <div class="flex items-center gap-2" cdkDrag [cdkDragDisabled]="!sortable()">
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
            <input
              class="min-w-0 grow rounded-lg border border-neutral/30 px-3 py-2 text-sm focus:border-primary focus:outline-2 focus:outline-primary/40"
              [type]="inputType()"
              [placeholder]="field().placeholder ?? placeholderFor()"
              [attr.aria-label]="field().label + ', elemento ' + (i + 1)"
              [id]="idPrefix() + '-' + i"
              [formField]="itemNode(i)"
            />
            <span class="flex shrink-0 items-center gap-1">
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
export class FieldStringList {
  readonly field = input.required<StringListField>();
  readonly tree = input.required<RootTree>();

  private readonly notifications = inject(NotificationService);

  private readonly itemsNode = computed(() => childTree<string[]>(this.tree(), this.field().key));
  private readonly state = computed(() => this.itemsNode()());
  /** Prefijo estable del campo para los id de cada ítem (§8). */
  protected readonly idPrefix = computed(() => this.state().name());
  protected readonly items = computed(() => this.state().value() ?? []);

  protected readonly sortable = computed(() => this.field().sortable ?? true);
  protected readonly toolbarBtn = TOOLBAR_BTN;
  protected readonly inputType = computed(() => this.field().itemType ?? 'text');

  protected itemNode(index: number): ReturnType<typeof stringItemTree> {
    return stringItemTree(this.itemsNode(), index);
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
    this.updateItems((next) => {
      next.push('');
    });
  }

  protected move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= this.items().length) {
      return;
    }
    this.updateItems((next) => {
      moveItemInArray(next, index, target);
    });
  }

  protected onDrop(event: CdkDragDrop<string[]>): void {
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    this.updateItems((next) => {
      moveItemInArray(next, event.previousIndex, event.currentIndex);
    });
  }

  protected async remove(index: number): Promise<void> {
    if (!this.canRemove()) {
      return;
    }
    const value = this.items()[index] ?? '';
    if (value.trim() !== '') {
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
  }

  private updateItems(mutator: (next: string[]) => void): void {
    this.state().controlValue.update((current) => {
      const next = [...current];
      mutator(next);
      return next;
    });
  }

  private placeholderFor(): string {
    switch (this.field().itemType) {
      case 'url':
        return 'https://…';
      case 'email':
        return 'nombre@ejemplo.com';
      default:
        // §2: placeholder siempre ejemplo, nunca instrucción.
        return 'Ej. Opción 1';
    }
  }
}
