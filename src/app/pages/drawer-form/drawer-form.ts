import {
  Component,
  DestroyRef,
  Injector,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, submit } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';

import type { FieldSchema, ResourceSchema } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { ErrorMapperService } from '../../core/services/error-mapper.service';
import { NotificationService } from '../../core/services/notification.service';
import { FieldHost } from '../../fields/field-host/field-host';
import { childTree, type RootTree } from '../../fields/field-node';
import { Button } from '../../shared/components/button/button';
import { Drawer, type DrawerSize } from '../../shared/components/drawer/drawer';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { buildFormSchema } from '../form-view/form-schema';
import { buildPayload, seedModel } from '../form-view/form-model';

/**
 * Formulario dentro de un drawer (plan 6.4/6.5, guía §5).
 *
 * Es deliberadamente más chico que `form-view`: sin pestañas, sin secciones,
 * sin borrador y sin resumen de errores. Sirve para abrir 1–3 campos sin
 * perder el contexto de la pantalla de la que vino el usuario, y para crear
 * un registro desde el dropdown de una relación.
 *
 * Componente controlado: `open` entra por `input()`, y el padre cierra con
 * `close`/`saved`. Nada navega por su cuenta.
 */
@Component({
  selector: 'app-drawer-form',
  imports: [Button, Drawer, FieldHost, Skeleton],
  template: `
    <app-drawer [open]="open()" [title]="drawerTitle()" [size]="size()" (close)="close.emit()">
      @if (status() === 'loading') {
        <app-skeleton [lines]="4" />
      } @else if (status() === 'error') {
        <p role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {{ loadError() }}
        </p>
      } @else if (tree(); as formTree) {
        @if (generalError()) {
          <p
            role="alert"
            class="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
            data-drawer-error
          >
            {{ generalError() }}
          </p>
        }
        @for (field of visibleFields(); track field.key) {
          <div class="mb-4">
            <app-field-host
              [field]="field"
              [tree]="formTree"
              [exists]="mode() === 'edit'"
              [serverErrors]="fieldErrors()"
              [resource]="schema().id"
            />
          </div>
        }
      }

      <div drawer-actions class="flex justify-end gap-2">
        <button app-button variant="outline" type="button" (click)="close.emit()">Cancelar</button>
        <button app-button type="button" [loading]="saving()" (click)="save()">Guardar</button>
      </div>
    </app-drawer>
  `,
})
export class DrawerForm implements OnInit {
  readonly open = input(false);
  readonly schema = input.required<ResourceSchema>();
  /** Subconjunto de campos a mostrar. Por defecto, todos los del schema. */
  readonly fields = input<readonly FieldSchema[] | undefined>(undefined);
  readonly mode = input<'create' | 'edit'>('create');
  readonly recordKey = input<string | null>(null);
  readonly title = input<string | null>(null);
  readonly size = input<DrawerSize>('md');

  /** Registro creado o actualizado, listo para que el padre refresque. */
  readonly saved = output<Record<string, unknown>>();
  readonly close = output<void>();

  private readonly api = inject(ApiService);
  private readonly notifications = inject(NotificationService);
  private readonly errorMapper = inject(ErrorMapperService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  private readonly tree = signal<RootTree | null>(null);
  private readonly status = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  private readonly saving = signal(false);
  private readonly generalError = signal('');
  private readonly fieldErrors = signal<Record<string, string>>({});
  private readonly loadError = signal('');

  readonly visibleFields = computed<readonly FieldSchema[]>(
    () => this.fields() ?? this.schema().fields,
  );

  readonly drawerTitle = computed(() => {
    if (this.title() !== null) {
      return this.title() as string;
    }
    const label = this.schema().label;
    return this.mode() === 'create' ? `Crear ${label}` : `Editar ${label}`;
  });

  ngOnInit(): void {
    // Se construye al montar, NO en un `effect`: `form()` crea un effect
    // interno y no puede correr dentro de otro (NG0602). Los padres montan
    // este componente bajo un `@if` y fijan los inputs, así que no hace
    // falta reaccionar a cambios posteriores.
    this.build();
  }

  private build(): void {
    const schema = this.schema();
    const recordKey = this.recordKey();
    const schemaFn = buildFormSchema(schema, this.api, recordKey ?? undefined);
    const tree = form(signal(seedModel(schema)), schemaFn, { injector: this.injector });

    if (this.mode() === 'create' || recordKey === null) {
      this.tree.set(tree);
      this.status.set('ready');
      return;
    }

    // Edición: el valor se pisa con el registro, dejando los defaults de
    // los campos que el backend no devuelve.
    this.status.set('loading');
    this.api
      .get<Record<string, unknown>>(schema.endpoint, recordKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (record) => {
          tree().value.set({ ...seedModel(schema), ...record });
          this.tree.set(tree);
          this.status.set('ready');
        },
        error: (error: unknown) => {
          this.loadError.set(this.errorMapper.messageOf(error));
          this.status.set('error');
        },
      });
  }

  async save(): Promise<void> {
    const tree = this.tree();
    const schema = this.schema();
    if (tree === null || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.generalError.set('');
    this.fieldErrors.set({});
    try {
      const ok = await submit(tree, {
        // `null` = sin errores propios: los del backend se pintan aparte.
        action: async () => {
          await this.persist(tree, schema);
          return null;
        },
        onInvalid: () => this.markTouched(tree),
      });
      if (!ok || Object.keys(this.fieldErrors()).length > 0 || this.generalError() !== '') {
        this.markTouched(tree);
      }
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Marca como tocado lo que se está mostrando. Se recorre por campo y no
   * desde la raíz: `FieldTree<Record<string, unknown>>` se indexa con una
   * clave dinámica y `markAsTouched` no compila ahí (`childTree` centraliza
   * ese cast). Baja a todos los descendientes, así un `group` queda cubierto.
   */
  private markTouched(tree: RootTree): void {
    for (const field of this.visibleFields()) {
      childTree<unknown>(tree, field.key)().markAsTouched();
    }
  }

  /** create/update; nunca lanza (los errores quedan en las señales). */
  private async persist(tree: RootTree, schema: ResourceSchema): Promise<void> {
    const payload = buildPayload(schema, tree);
    try {
      if (this.mode() === 'create') {
        const created = await firstValueFrom(
          this.api.create<Record<string, unknown>>(schema.endpoint, payload),
        );
        this.notifications.success('Registro creado.');
        this.saved.emit(created ?? {});
        this.close.emit();
        return;
      }
      const updated = await firstValueFrom(
        this.api.update<Record<string, unknown>>(
          schema.endpoint,
          this.recordKey() ?? undefined,
          payload,
        ),
      );
      this.notifications.success('Registro guardado.');
      this.saved.emit(updated ?? {});
      this.close.emit();
    } catch (error: unknown) {
      const mapped = this.errorMapper.map(error);
      this.fieldErrors.set(mapped.fields);
      const withoutFields = Object.keys(mapped.fields).length === 0;
      this.generalError.set(
        mapped.general ?? (withoutFields ? this.errorMapper.messageOf(error) : ''),
      );
    }
  }
}
