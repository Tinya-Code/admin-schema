import { Component, computed, inject, Injector, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, submit } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { FieldSchema, ResourceSchema } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { ErrorMapperService, type MappedError } from '../../core/services/error-mapper.service';
import { NotificationService } from '../../core/services/notification.service';
import { FieldHost, isSupportedFieldType } from '../../fields/field-host/field-host';
import { childTree, type RootTree } from '../../fields/field-node';
import { getSchema } from '../../schemas/registry';
import { Button } from '../../shared/components/button/button';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { colSpanClass } from '../../shared/utils/col-span';
import { mergeRecord } from '../../shared/utils/seed';
import { buildFormSchema } from './form-schema';
import { buildPayload, seedModel } from './form-model';

type FormMode = 'create' | 'edit' | 'single';
type FormStatus = 'loading' | 'ready' | 'error';

interface SectionView {
  id: string;
  label: string;
  fields: FieldSchema[];
}

const TAB_ACTIVE =
  'border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const TAB_INACTIVE =
  'border-b-2 border-transparent px-3 py-2 text-sm text-neutral hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Formulario genérico: lo construye el schema del recurso (base.md §4–§6,
 * §10) con `form()` de Signal Forms sobre un modelo `Record<string, unknown>`.
 *
 * - **Acceso dinámico**: `form()[field.key]` no compila con claves
 *   arbitrarias; el modelo se tipa como `Record<string, unknown>` y el acceso
 *   vive en `fields/field-node.ts` (`childTree`) y en `form-schema.ts`
 *   (`pathAt`), que centralizan los dos casts.
 * - **Sin `debounce('blur')`**: difiere `controlValue → value` (el modelo), no
 *   la visibilidad de errores, y con controles custom (`multiselect`, que
 *   nunca emite `touch`) se perderían datos en el payload. La validación al
 *   perder foco la resuelve FieldHost (`invalid() && touched()`).
 * - `<form novalidate>`: Signal Forms expone `required` como atributo nativo,
 *   y la validación nativa del navegador bloquearía el submit sin mostrar
 *   nada (campos en `<details>` cerrados).
 */
@Component({
  selector: 'app-form-view',
  imports: [Button, EmptyState, FieldHost, Skeleton],
  template: `
    @if (schema()) {
      <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="font-display text-2xl font-semibold">{{ heading() }}</h1>
            @if (dirty()) {
              <span class="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
                Sin guardar
              </span>
            }
          </div>
          @if (mode() === 'single') {
            <p class="text-sm text-neutral">Configuración única</p>
          }
        </div>
        @if (mode() !== 'single') {
          <button app-button variant="outline" type="button" (click)="back()">
            Volver al listado
          </button>
        }
      </header>

      @switch (status()) {
        @case ('loading') {
          <app-skeleton [lines]="8" [height]="48" />
        }
        @case ('error') {
          <app-empty-state
            title="No se pudo cargar el registro"
            message="Revisa tu conexión e intenta de nuevo."
          >
            <button app-button variant="outline" type="button" (click)="retry()">Reintentar</button>
          </app-empty-state>
        }
        @case ('ready') {
          @if (formTree(); as tree) {
            @if (serverErrors().general; as general) {
              <p
                class="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
                role="alert"
              >
                {{ general }}
              </p>
            }

            <form novalidate [attr.aria-busy]="saving()" (submit)="onSubmit($event)">
              @if (unsectionedFields().length > 0) {
                <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-12">
                  @for (field of unsectionedFields(); track field.key) {
                    <div [class]="colSpan(field)">
                      <app-field-host
                        [field]="field"
                        [tree]="tree"
                        [exists]="exists()"
                        [serverErrors]="serverErrors().fields"
                        [resource]="resourceId()"
                      />
                    </div>
                  }
                </div>
              }

              @if (layoutMode() === 'tabs') {
                <div role="tablist" class="mb-4 flex flex-wrap gap-1 border-b border-neutral/20">
                  @for (section of sectionViews(); track section.id) {
                    <button
                      type="button"
                      role="tab"
                      [class]="tabClass(section)"
                      [attr.aria-selected]="activeSection() === section.id"
                      (click)="selectSection(section.id)"
                    >
                      {{ section.label }}
                      @if (sectionHasProblem(section)) {
                        <span class="ml-1 text-danger" aria-hidden="true">•</span>
                      }
                    </button>
                  }
                </div>
              }

              @for (section of visibleSections(); track section.id) {
                @if (layoutMode() === 'tabs') {
                  <div role="tabpanel" class="grid grid-cols-1 gap-x-4 sm:grid-cols-12">
                    @for (field of section.fields; track field.key) {
                      <div [class]="colSpan(field)">
                        <app-field-host
                          [field]="field"
                          [tree]="tree"
                          [exists]="exists()"
                          [serverErrors]="serverErrors().fields"
                          [resource]="resourceId()"
                        />
                      </div>
                    }
                  </div>
                } @else {
                  <details
                    class="mb-4 rounded-xl border border-neutral/20 bg-white"
                    [open]="isSectionOpen(section.id)"
                    (toggle)="setSectionOpen(section.id, $event)"
                  >
                    <summary
                      class="flex cursor-pointer items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold hover:bg-neutral/5"
                    >
                      <span>{{ section.label }}</span>
                      @if (sectionHasProblem(section)) {
                        <span class="text-xs font-medium text-danger">Revisar</span>
                      }
                    </summary>
                    <div class="grid grid-cols-1 gap-x-4 px-4 pb-4 sm:grid-cols-12">
                      @for (field of section.fields; track field.key) {
                        <div [class]="colSpan(field)">
                          <app-field-host
                            [field]="field"
                            [tree]="tree"
                            [exists]="exists()"
                            [serverErrors]="serverErrors().fields"
                          />
                        </div>
                      }
                    </div>
                  </details>
                }
              }

              <div
                class="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-neutral/20 pt-4"
              >
                @if (canDelete()) {
                  <div class="mr-auto">
                    <button app-button variant="danger" type="button" (click)="remove()">
                      Eliminar
                    </button>
                  </div>
                }
                <button app-button variant="outline" type="button" (click)="back()">
                  Cancelar
                </button>
                <button app-button type="submit" [loading]="saving()" [disabled]="!canSave()">
                  {{ saving() ? 'Guardando…' : 'Guardar' }}
                </button>
              </div>
            </form>
          }
        }
      }
    } @else {
      <app-empty-state
        title="Recurso no encontrado"
        message="No existe un schema con ese id en el registry."
      />
    }
  `,
})
export class FormView {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly notifications = inject(NotificationService);
  private readonly errorMapper = inject(ErrorMapperService);
  /** `form()` puede reconstruirse fuera de contexto (cambio de ruta). */
  private readonly injector = inject(Injector);
  private readonly params = toSignal(this.route.paramMap, { requireSync: true });

  readonly schema = computed(() => getSchema(this.params().get('id') ?? ''));
  /** Recurso actual (lo consumen `image` para pedir la firma, §11.2). */
  readonly resourceId = computed(() => this.schema()?.id ?? '');

  readonly mode = computed<FormMode>(() => {
    const schema = this.schema();
    if (!schema) {
      return 'single';
    }
    if (this.params().get('key') !== null) {
      return 'edit';
    }
    return schema.kind === 'singleton' ? 'single' : 'create';
  });

  readonly heading = computed(() => {
    const schema = this.schema();
    if (!schema) {
      return '';
    }
    switch (this.mode()) {
      case 'create':
        return `Nueva ${schema.label}`;
      case 'edit':
        return `Editar ${schema.label}`;
      case 'single':
        return schema.labelPlural;
    }
  });

  readonly status = signal<FormStatus>('loading');
  /** Estado «guardando» del botón (además del bloqueo interno de `submit`). */
  readonly saving = signal(false);
  /** Errores del backend: rutas de campo + mensaje general (base.md §10). */
  readonly serverErrors = signal<MappedError>({ fields: {} });
  /** Pestaña activa (solo `layout.mode === 'tabs'`). */
  readonly activeSection = signal<string | null>(null);

  private readonly openSections = signal<Record<string, boolean>>({});
  private readonly formTree = signal<RootTree | null>(null);
  /** Evita que una respuesta lenta pise el formulario ya reconstruido. */
  private loadEpoch = 0;

  constructor() {
    // `paramMap` emite síncrono al suscribirse: el primer `rebuild()` corre
    // dentro del constructor (contexto de inyección) y los siguientes, al
    // cambiar de ruta (`new` → `edit`), por eso `form()` lleva `injector`.
    this.route.paramMap.subscribe(() => this.rebuild());
  }

  // ── Layout (base.md §4) ──

  readonly layoutMode = computed<'sections' | 'tabs'>(
    () => this.schema()?.layout?.mode ?? 'sections',
  );

  /** Campos que la UI sabe dibujar (los de Fase 11 se omiten, no se borran del payload). */
  readonly renderedFields = computed(() =>
    (this.schema()?.fields ?? []).filter((field) => isSupportedFieldType(field.type)),
  );

  /** Secciones con al menos un campo dibujable. */
  readonly sectionViews = computed<SectionView[]>(() => {
    const layout = this.schema()?.layout;
    if (!layout) {
      return [];
    }
    const rendered = this.renderedFields();
    return layout.sections
      .map((section) => ({
        id: section.id,
        label: section.label,
        fields: rendered.filter((field) => field.section === section.id),
      }))
      .filter((view) => view.fields.length > 0);
  });

  /** Campos sin sección (o con una sección inexistente): siempre visibles. */
  readonly unsectionedFields = computed(() => {
    const ids = new Set(this.sectionViews().map((view) => view.id));
    return this.renderedFields().filter(
      (field) => field.section === undefined || !ids.has(field.section),
    );
  });

  /** En pestañas solo se dibuja la activa; en secciones, todas (colapsables). */
  readonly visibleSections = computed<SectionView[]>(() => {
    const sections = this.sectionViews();
    if (this.layoutMode() !== 'tabs') {
      return sections;
    }
    const active = sections.find((section) => section.id === this.activeSection()) ?? sections[0];
    return active ? [active] : [];
  });

  // ── Estado del formulario ──

  /** Indicador _dirty_ + aviso al salir (base.md §10). Agrega descendientes. */
  readonly dirty = computed(() => this.formTree()?.().dirty() ?? false);

  /** `slug` con `lockAfterCreate` se bloquea solo si el registro ya existe. */
  readonly exists = computed(() => this.mode() !== 'create');

  readonly canSave = computed(() => {
    const permissions = this.schema()?.permissions;
    return this.mode() === 'create' ? permissions?.create !== false : permissions?.update !== false;
  });

  readonly canDelete = computed(
    () => this.mode() === 'edit' && this.schema()?.permissions?.remove !== false,
  );

  // ── Ciclo de vida ──

  /** Reconstruye el formulario al cambiar de ruta o de recurso. */
  private rebuild(): void {
    const schema = this.schema();
    this.serverErrors.set({ fields: {} });
    this.openSections.set({});
    this.activeSection.set(null);

    if (!schema) {
      this.formTree.set(null);
      this.status.set('error');
      return;
    }

    const model = signal(seedModel(schema));
    const schemaFn = buildFormSchema(schema, this.api, this.recordKey() ?? undefined);
    this.formTree.set(form(model, schemaFn, { injector: this.injector }));
    this.activeSection.set(this.sectionViews()[0]?.id ?? null);

    if (this.mode() === 'create') {
      // Crear no lee nada: el formulario está listo de entrada.
      this.status.set('ready');
      return;
    }
    this.status.set('loading');
    void this.load();
  }

  private async load(): Promise<void> {
    const schema = this.schema();
    const tree = this.formTree();
    if (!schema || !tree) {
      return;
    }
    const epoch = ++this.loadEpoch;
    try {
      const record = await firstValueFrom(
        this.api.get<Record<string, unknown>>(schema.endpoint, this.recordKey() ?? undefined),
      );
      if (epoch !== this.loadEpoch) {
        return;
      }
      this.applyRecord(tree, schema, record ?? {});
      this.status.set('ready');
    } catch {
      if (epoch !== this.loadEpoch) {
        return;
      }
      this.status.set('error');
    }
  }

  /**
   * Siembra defaults + registro: los campos ausentes en la respuesta conservan
   * su valor por defecto y los grupos/ítems parciales se fusionan en profundidad
   * (si no, `childTree` no encontraría nodos y revienta al renderizar).
   * `value.set` es programático: no marca `dirty`.
   */
  private applyRecord(
    tree: RootTree,
    schema: ResourceSchema,
    record: Record<string, unknown>,
  ): void {
    tree().value.set(mergeRecord(schema.fields, record));
  }

  retry(): void {
    void this.load();
  }

  // ── Guardado ──

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const tree = this.formTree();
    if (!tree || this.saving()) {
      return;
    }
    this.serverErrors.set({ fields: {} });
    this.saving.set(true);
    try {
      const ok = await submit(tree, {
        // `null` = sin errores: los del backend salen por `applyServerErrors`
        // (también si `submit` dio `true`), para no dejar el form invalidado.
        action: async () => {
          await this.persist(tree);
          return null;
        },
        onInvalid: () => this.revealErrors(),
      });
      if (!ok || this.hasServerErrors()) {
        this.revealErrors();
      }
    } finally {
      this.saving.set(false);
    }
  }

  /** create/update según el modo; nunca lanza (los errores van a `serverErrors`). */
  private async persist(tree: RootTree): Promise<void> {
    const schema = this.schema();
    if (!schema) {
      return;
    }
    const payload = buildPayload(schema, tree);

    try {
      if (this.mode() === 'create') {
        const created = await firstValueFrom(
          this.api.create<Record<string, unknown>>(schema.endpoint, payload),
        );
        this.notifications.success('Registro creado.');
        // Limpia `dirty` antes de navegar: si no, el guard pediría confirmar.
        tree().reset();
        const createdKey = created?.[schema.keyField];
        if (typeof createdKey === 'string' && createdKey !== '') {
          void this.router.navigate(['/', schema.id, createdKey, 'edit']);
        } else {
          this.back();
        }
        return;
      }

      await firstValueFrom(
        this.api.update<Record<string, unknown>>(
          schema.endpoint,
          this.mode() === 'edit' ? (this.recordKey() ?? undefined) : undefined,
          payload,
        ),
      );
      this.notifications.success('Registro guardado.');
      tree().reset();
    } catch (err) {
      this.applyServerErrors(this.errorMapper.map(err));
      return;
    }

    // Recarga del valor guardado (base.md §10); su fallo no invalida el guardado.
    try {
      const record = await firstValueFrom(
        this.api.get<Record<string, unknown>>(schema.endpoint, this.recordKey() ?? undefined),
      );
      this.applyRecord(tree, schema, record ?? {});
      tree().reset();
    } catch {
      this.notifications.error('No se pudo recargar el registro.');
    }
  }

  /**
   * Errores del backend → mapa por ruta; el mensaje se queda en `general`
   * sólo si su raíz (`address`, `faq[2]` → `faq`) no es un campo dibujado
   * (base.md §10). Los hijos anidados se resuelven en el host con
   * `serverErrors[prefix + key]`.
   */
  private applyServerErrors(mapped: MappedError): void {
    const rendered = new Set(this.renderedFields().map((field) => field.key));
    const fields: Record<string, string> = {};
    const loose: string[] = [];
    if (mapped.general) {
      loose.push(mapped.general);
    }
    for (const [path, message] of Object.entries(mapped.fields)) {
      const root = path.split(/[.[]/)[0];
      if (rendered.has(root)) {
        fields[path] = message;
      } else {
        // Campo no dibujado u oculto: el usuario tiene que verlo.
        loose.push(message);
      }
    }
    this.serverErrors.set({ fields, general: loose.length > 0 ? loose.join(' ') : undefined });
  }

  private hasServerErrors(): boolean {
    const current = this.serverErrors();
    return current.general !== undefined || Object.keys(current.fields).length > 0;
  }

  /** Muestra todos los errores: abre secciones, activa la pestaña con problemas. */
  private revealErrors(): void {
    const sections = this.sectionViews();
    if (this.layoutMode() === 'sections') {
      this.openSections.update((open) => {
        const next = { ...open };
        for (const section of sections) {
          next[section.id] = true;
        }
        return next;
      });
    }
    const withProblem = sections.find((section) => this.sectionHasProblem(section));
    if (withProblem && this.layoutMode() === 'tabs') {
      this.activeSection.set(withProblem.id);
    }
  }

  // ── Borrado ──

  async remove(): Promise<void> {
    const schema = this.schema();
    const key = this.recordKey();
    if (!schema || this.mode() !== 'edit' || !key) {
      return;
    }
    const title = this.title();
    const accepted = await this.notifications.confirm({
      title: title ? `Eliminar «${title}»` : `Eliminar ${schema.label.toLowerCase()}`,
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
      this.back();
    } catch (err) {
      // El motivo (p. ej. «categoría con productos») lo decide el backend.
      this.notifications.error(this.errorMapper.messageOf(err));
    }
  }

  /** Consultado por `unsavedChangesGuard` al salir de la ruta. */
  async canDeactivate(): Promise<boolean> {
    if (!this.dirty()) {
      return true;
    }
    return this.notifications.confirm({
      title: 'Cambios sin guardar',
      message: 'Si salís ahora, perdés los cambios realizados.',
      confirmLabel: 'Salir sin guardar',
      cancelLabel: 'Seguir editando',
    });
  }

  back(): void {
    void this.router.navigate(['/', this.schema()?.id]);
  }

  // ── Helpers de template ──

  colSpan(field: FieldSchema): string {
    return colSpanClass(field.width);
  }

  tabClass(section: SectionView): string {
    return section.id === this.activeSection() ? TAB_ACTIVE : TAB_INACTIVE;
  }

  selectSection(id: string): void {
    this.activeSection.set(id);
  }

  isSectionOpen(id: string): boolean {
    // Las secciones arrancan abiertas (base.md §4).
    return this.openSections()[id] ?? true;
  }

  setSectionOpen(id: string, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    this.openSections.update((sections) => ({ ...sections, [id]: open }));
  }

  /** Invalido (propio, anidado o del backend): marca la pestaña/sección. */
  fieldHasProblem(field: FieldSchema): boolean {
    const root = field.key;
    const hasServerError = Object.keys(this.serverErrors().fields).some(
      (path) => path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[`),
    );
    if (hasServerError) {
      return true;
    }
    const tree = this.formTree();
    return tree !== null && childTree<unknown>(tree, root)().invalid();
  }

  sectionHasProblem(section: SectionView): boolean {
    return section.fields.some((field) => this.fieldHasProblem(field));
  }

  private title(): string {
    const tree = this.formTree();
    const schema = this.schema();
    if (!tree || !schema) {
      return '';
    }
    const value = tree().value()[schema.titleField];
    return typeof value === 'string' ? value : '';
  }

  private recordKey(): string | null {
    return this.params().get('key');
  }
}
