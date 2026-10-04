import { Component, computed, effect, inject, Injector, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, submit } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { FieldSchema, ResourceSchema } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { ErrorMapperService, type MappedError } from '../../core/services/error-mapper.service';
import { NotificationService } from '../../core/services/notification.service';
import {
  RelationDrawerService,
  type RelationCreateRequest,
} from '../../core/services/relation-drawer.service';
import { FieldHost, isSupportedFieldType } from '../../fields/field-host/field-host';
import { childTree, groupTree, type RootTree } from '../../fields/field-node';
import { DrawerForm } from '../drawer-form/drawer-form';
import { getSchema } from '../../schemas/registry';
import { collectDependsOn } from '../../shared/utils/depends-on';
import { Button } from '../../shared/components/button/button';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { colSpanClass } from '../../shared/utils/col-span';
import { isRecord, mergeRecord } from '../../shared/utils/seed';
import { buildFormSchema } from './form-schema';
import { buildPayload, seedModel } from './form-model';

type FormMode = 'create' | 'edit' | 'single';
type FormStatus = 'loading' | 'ready' | 'error';

interface SectionView {
  id: string;
  label: string;
  fields: FieldSchema[];
}

/**
 * Un ítem del resumen de errores (§4.11). `id` es el que ya genera
 * `state().name()`: es a la vez el valor de `data-field` del envoltorio y el
 * `id` real del control, así que no se inventa ningún ancla nueva.
 */
interface ErrorEntry {
  id: string;
  label: string;
  message: string;
  /** Sección/pestaña del campo raíz; `undefined` si no está en ninguna. */
  section?: string;
}

const TAB_ACTIVE =
  'border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const TAB_INACTIVE =
  'border-b-2 border-transparent px-3 py-2 text-sm text-neutral hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Espera antes de volcar el borrador a localStorage (§4.6). */
const DRAFT_DEBOUNCE_MS = 800;

/**
 * Fecha del registro tal como llega del backend. No está en el schema
 * (`updated_at` es un `readonly-text`, no un campo editable), así que se
 * prueba la forma habitual; si no hay, devuelve `undefined` y el borrador se
 * ofrece igual.
 */
function readTimestamp(record: Record<string, unknown> | null): number | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of ['updated_at', 'updatedAt', 'updated']) {
    const raw = record[key];
    if (typeof raw === 'number') {
      return raw < 1e12 ? raw * 1000 : raw;
    }
    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

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
  imports: [Button, DrawerForm, EmptyState, FieldHost, Skeleton],
  template: `
    @if (schema()) {
      <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="font-display text-2xl font-semibold">{{ heading() }}</h1>
            @if (dirty()) {
              <span
                class="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent-text"
              >
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
              @if (draftOffer(); as offer) {
                <!-- §4.6: se OFRECE, nunca se restaura solo. role=status para
                     anunciarlo sin arrebatarle el foco a quien está escribiendo. -->
                <div
                  class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-neutral/20 bg-surface px-4 py-3 text-sm"
                  role="status"
                >
                  <span class="text-neutral">
                    Hay un borrador guardado {{ draftAge(offer.savedAt) }}.
                  </span>
                  <button app-button variant="outline" type="button" (click)="restoreDraft()">
                    Restaurar
                  </button>
                  <button app-button variant="ghost" type="button" (click)="discardDraft()">
                    Descartar
                  </button>
                </div>
              }

              @if (summaryErrors().length >= 2) {
                <!-- Con uno solo no se pinta: el foco ya está en el campo y
                     el resumen sólo restaría. Con 2+ es la única forma de
                     ver que hay varios (§4.11). tabindex -1 para poder
                     recibir el foco y que role=alert lo anuncie. -->
                <div
                  data-error-summary
                  tabindex="-1"
                  role="alert"
                  aria-labelledby="error-summary-title"
                  class="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 focus:outline-2 focus:outline-danger"
                >
                  <p id="error-summary-title" class="text-sm font-semibold text-danger">
                    Hay {{ summaryErrors().length }} errores que corregir
                  </p>
                  <ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
                    @for (entry of summaryErrors(); track entry.id) {
                      <li>
                        <a
                          href="#"
                          class="text-danger underline underline-offset-2 hover:text-danger/80"
                          (click)="goToError(entry, $event)"
                        >
                          {{ entry.label }} — {{ entry.message }}
                        </a>
                      </li>
                    }
                  </ul>
                </div>
              }

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
                <div
                  role="tablist"
                  class="mb-4 flex flex-wrap gap-1 border-b border-neutral/20"
                  (keydown)="onTablistKeydown($event)"
                >
                  @for (section of sectionViews(); track section.id) {
                    <button
                      type="button"
                      role="tab"
                      [id]="tabId(section.id)"
                      [class]="tabClass(section)"
                      [attr.aria-selected]="activeSection() === section.id"
                      [attr.tabindex]="activeSection() === section.id ? 0 : -1"
                      (click)="selectSection(section.id)"
                    >
                      {{ section.label }}
                      <!-- Progreso (§4.3, decisión A): el ✓ siempre que esté
                           completa; el ⚠ recién después del primer Guardar.
                           El glifo va oculto para lectores y el estado se
                           cuenta aparte en texto. -->
                      @switch (sectionProgress(section)) {
                        @case ('problem') {
                          <span class="ml-1 text-danger" aria-hidden="true">⚠</span>
                          <span class="sr-only"> — con errores</span>
                        }
                        @case ('complete') {
                          <span class="ml-1 text-success" aria-hidden="true">✓</span>
                          <span class="sr-only"> — completa</span>
                        }
                      }
                    </button>
                  }
                </div>
              }

              @if (layoutMode() === 'tabs') {
                @for (section of visibleSections(); track section.id) {
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
                }
              } @else {
                <!-- Índice interno (§5.3): en escritorio, índice sticky a la
                     izquierda; en móvil, chips horizontales. En tabs las
                     pestañas ya hacen de índice, así que esto no se dibuja. -->
                <div class="flex flex-col gap-4 lg:flex-row lg:gap-6">
                  <nav
                    aria-label="Secciones"
                    class="sticky top-4 hidden shrink-0 self-start lg:block lg:w-44"
                  >
                    <p
                      class="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral"
                      aria-hidden="true"
                    >
                      Secciones
                    </p>
                    <ul class="space-y-1 border-l border-neutral/20 pl-3">
                      @for (section of visibleSections(); track section.id) {
                        <li>
                          <button
                            type="button"
                            class="w-full rounded px-2 py-1 text-left text-sm hover:bg-neutral/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            [class.font-medium]="sectionProgress(section) === 'problem'"
                            (click)="goToSection(section.id)"
                          >
                            {{ section.label }}
                            @switch (sectionProgress(section)) {
                              @case ('problem') {
                                <span class="ml-1 text-danger" aria-hidden="true">⚠</span>
                                <span class="sr-only"> — con errores</span>
                              }
                              @case ('complete') {
                                <span class="ml-1 text-success" aria-hidden="true">✓</span>
                                <span class="sr-only"> — completa</span>
                              }
                            }
                          </button>
                        </li>
                      }
                    </ul>
                  </nav>

                  <div class="min-w-0 flex-1">
                    <nav
                      aria-label="Secciones"
                      class="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden"
                    >
                      @for (section of visibleSections(); track section.id) {
                        <button
                          type="button"
                          class="shrink-0 rounded-full border border-neutral/30 px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          [class.border-danger]="sectionProgress(section) === 'problem'"
                          [class.text-danger]="sectionProgress(section) === 'problem'"
                          [class.font-medium]="sectionProgress(section) === 'problem'"
                          (click)="goToSection(section.id)"
                        >
                          {{ section.label }}
                        </button>
                      }
                    </nav>

                    @for (section of visibleSections(); track section.id) {
                      <details
                        id="section-{{ section.id }}"
                        class="mb-4 rounded-xl border border-neutral/20 bg-surface scroll-mt-4"
                        [open]="isSectionOpen(section.id)"
                        (toggle)="setSectionOpen(section.id, $event)"
                      >
                        <summary
                          tabindex="-1"
                          class="flex cursor-pointer items-center justify-between gap-2 rounded-xl px-4 py-3 text-section font-semibold hover:bg-neutral/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          <span>{{ section.label }}</span>
                          @if (sectionProgress(section) === 'problem') {
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
                                [resource]="resourceId()"
                              />
                            </div>
                          }
                        </div>
                      </details>
                    }
                  </div>
                </div>
              }

              <!-- Sticky (§5.1): en products son 19 campos y Cancelar/Guardar
                     desaparecían al final del scroll. bg-surface es opaco: sin
                     él el contenido vería pasar por detrás. -->
              <div
                class="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-neutral/20 bg-surface pt-4 pb-4"
              >
                @if (canDelete()) {
                  <div class="mr-auto">
                    <button app-button variant="danger" type="button" (click)="remove()">
                      Eliminar
                    </button>
                  </div>
                }
                @if (mode() !== 'create') {
                  <!-- §5: descartar lo escrito y volver a lo del servidor. -->
                  <button app-button variant="ghost" type="button" (click)="restablecer()">
                    Restablecer
                  </button>
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

    <!-- «Crear nuevo» desde el dropdown de una relación (plan 6.4). Se monta
         y desmonta con el pedido: el Drawer devuelve el foco al botón que lo
         abrió al destruirse. -->
    @if (relationDrawer.request(); as createRequest) {
      @if (drawerSchema(createRequest.resource); as target) {
        <app-drawer-form
          [open]="true"
          [schema]="target"
          mode="create"
          [title]="'Crear ' + target.label"
          (close)="relationDrawer.clear()"
          (saved)="relationCreated($event, createRequest)"
        />
      }
    }
  `,
})
export class FormView {
  /** Puente con el control `relation` (ver `relation-drawer.service`). */
  readonly relationDrawer = inject(RelationDrawerService);

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
  /**
   * Borrador (§4.6 / plan 5.4). `draftOffer` queda en `null` cuando no hay
   * nada que ofrecer: NUNCA se restaura solo, sólo con un clic del usuario.
   */
  private readonly draftOffer = signal<{ savedAt: number; value: Record<string, unknown> } | null>(
    null,
  );
  /** Snapshot de lo que vino del servidor; sólo se guarda si el usuario cambió algo. */
  private loadedSnapshot = '';
  /** Registro original, para «Restablecer» (§5). */
  private loadedRecord: Record<string, unknown> | null = null;
  /** Snapshot de los padres de `dependsOn` y el árbol al que pertenece. */
  private readonly dependsOnSnapshot = new Map<string, string>();
  private dependsOnTree: RootTree | null = null;
  /**
   * Hubo un intento de guardado. Sin este guardia el resumen aparecería de
   * entrada en cualquier formulario con `required` vacíos: `invalid()` es
   * cierto desde el primer render, no sólo después de enviar.
   *
   * También gobierna el `⚠` de las pestañas y el bloqueo al cambiar de
   * pestaña (decisión A): antes del primer Guardar un campo `required` vacío
   * YA es inválido, y andar gritando `⚠` —o trancando la navegación— al
   * usuario que todavía no le erró a nada es ruido, no ayuda.
   */
  readonly submitted = signal(false);

  constructor() {
    // `paramMap` emite síncrono al suscribirse: el primer `rebuild()` corre
    // dentro del constructor (contexto de inyección) y los siguientes, al
    // cambiar de ruta (`new` → `edit`), por eso `form()` lleva `injector`.
    this.route.paramMap.subscribe(() => this.rebuild());

    // Autoguardado del borrador (§4.6): se dispara con cada cambio del árbol
    // y debouncea 800 ms. `tree().value()` es la lectura que registra la
    // dependencia — sin ella el effect no vería las ediciones del usuario.
    effect((onCleanup) => {
      const tree = this.formTree();
      if (!tree) {
        return;
      }
      const value = tree().value();
      if (this.status() !== 'ready' || JSON.stringify(value) === this.loadedSnapshot) {
        return;
      }
      const timer = setTimeout(() => this.saveDraft(value), DRAFT_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
    });

    // Selección dependiente (guía §1, plan 6.6): cuando el padre cambia, el
    // hijo vuelve a su default. `disabled()` en `form-schema.ts` ya lo dejó
    // ineditable mientras el padre esté vacío; esto es la otra mitad.
    // La lectura de `value()` del padre es la que registra la dependencia.
    effect(() => {
      const tree = this.formTree();
      const schema = this.schema();
      if (tree === null || !schema) {
        this.dependsOnSnapshot.clear();
        this.dependsOnTree = null;
        return;
      }
      if (this.dependsOnTree !== tree) {
        // Árbol reconstruido (cambio de ruta): los valores anteriores ya no
        // significan nada, se empieza de cero para no limpiar nada de más.
        this.dependsOnTree = tree;
        this.dependsOnSnapshot.clear();
      }
      for (const link of collectDependsOn(schema.fields)) {
        let container: RootTree = tree;
        for (const key of link.container) {
          container = groupTree(container, key);
        }
        const parentValue = JSON.stringify(
          childTree<unknown>(container, link.parentKey)().value() ?? null,
        );
        const previous = this.dependsOnSnapshot.get(link.id);
        if (previous !== undefined && previous !== parentValue) {
          childTree<unknown>(container, link.childKey)().value.set(link.resetValue);
        }
        this.dependsOnSnapshot.set(link.id, parentValue);
      }
    });
  }

  // ── Layout (base.md §4) ──

  readonly layoutMode = computed<'sections' | 'tabs'>(
    () => this.schema()?.layout?.mode ?? 'sections',
  );

  /** Campos que la UI sabe dibujar (los de Fase 11 se omiten, no se borran del payload). */
  readonly renderedFields = computed(() =>
    (this.schema()?.fields ?? []).filter((field) => isSupportedFieldType(field.type)),
  );

  /**
   * Ítems del resumen de errores (§4.11), vacío hasta que se intente guardar.
   *
   * Recorre el ÁRBOL, no `serverErrors.fields`: el backend sólo puede
   * devolver un `path` por respuesta (`api.md §7`), así que ahí nunca hay más
   * de un ítem. Los errores múltiples los produce la validación del cliente,
   * que `submit()` deja marcados como tocados de una.
   */
  readonly summaryErrors = computed<ErrorEntry[]>(() =>
    this.submitted() ? this.collectErrors() : [],
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
    this.submitted.set(false);

    if (!schema) {
      this.formTree.set(null);
      this.status.set('error');
      return;
    }

    const model = signal(seedModel(schema));
    const schemaFn = buildFormSchema(schema, this.api, this.recordKey() ?? undefined);
    this.formTree.set(form(model, schemaFn, { injector: this.injector }));
    this.activeSection.set(this.sectionViews()[0]?.id ?? null);

    // El snapshot de «sin cambios» arranca en los defaults sembrados; si no,
    // el effect guardaría un borrador con el formulario recién abierto.
    const tree = this.formTree();
    this.loadedSnapshot = JSON.stringify(tree ? tree().value() : {});
    this.loadedRecord = null;
    this.draftOffer.set(null);

    if (this.mode() === 'create') {
      // Crear no lee nada: el formulario está listo de entrada.
      this.status.set('ready');
      // En crear solo hay clave de recurso sin key: un borrador previo sí
      // puede aplicar (mismo «nuevo»), así que se ofrece.
      this.offerDraft(null);
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
      this.loadedRecord = record ?? {};
      this.status.set('ready');
      // Recién termina la carga: es el único momento en que tiene sentido
      // comparar el borrador con el servidor.
      this.offerDraft(record ?? null);
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
    // Base de comparación del autoguardado: con esto el effect no escribe un
    // borrador idéntico al servidor apenas termina la carga.
    this.loadedSnapshot = JSON.stringify(tree().value());
  }

  // ── Borrador (§4.6, plan 5.4) ──

  /** `draft:<recurso>:<key|nuevo>` — aislado por recurso Y registro. */
  private draftStorageKey(): string {
    return `draft:${this.resourceId()}:${this.recordKey() ?? 'nuevo'}`;
  }

  /** Best-effort: localStorage puede fallar (modo privado, cuota). */
  private saveDraft(value: Record<string, unknown>): void {
    try {
      localStorage.setItem(this.draftStorageKey(), JSON.stringify({ savedAt: Date.now(), value }));
    } catch {
      /* el borrador nunca debe romper el formulario */
    }
  }

  /**
   * Ofrece el borrador si es más reciente que el servidor. Si el registro no
   * trae fecha, cualquier borrador sirve — sólo existe si el usuario cambió
   * algo, porque `loadedSnapshot` filtra los idénticos.
   */
  private offerDraft(serverRecord: Record<string, unknown> | null): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(this.draftStorageKey());
    } catch {
      return;
    }
    if (!raw) {
      return;
    }
    let draft: { savedAt?: number; value?: unknown } | null = null;
    try {
      draft = JSON.parse(raw) as { savedAt?: number; value?: unknown };
    } catch {
      return;
    }
    if (!draft || typeof draft.savedAt !== 'number' || !isRecord(draft.value)) {
      this.clearDraft();
      return;
    }

    const serverTs = readTimestamp(serverRecord);
    if (serverTs !== undefined && serverTs >= draft.savedAt) {
      // El servidor ya tiene algo más nuevo: el borrador está vencido.
      this.clearDraft();
      return;
    }
    this.draftOffer.set({ savedAt: draft.savedAt, value: draft.value });
  }

  /** Restaurar es una acción explícita del usuario (§4.6: nunca en silencio). */
  restoreDraft(): void {
    const offer = this.draftOffer();
    const tree = this.formTree();
    const schema = this.schema();
    if (!offer || !tree || !schema) {
      return;
    }
    this.applyRecord(tree, schema, offer.value);
    this.draftOffer.set(null);
    this.notifications.info('Borrador restaurado.');
  }

  /** Descarta el borrador sin tocar lo cargado. */
  discardDraft(): void {
    this.clearDraft();
    this.draftOffer.set(null);
  }

  private clearDraft(): void {
    try {
      localStorage.removeItem(this.draftStorageKey());
    } catch {
      /* idem */
    }
  }

  /** «hace 1 min» — relativo y discreto (§4.6). */
  draftAge(savedAt: number): string {
    const minutes = Math.max(1, Math.round((Date.now() - savedAt) / 60_000));
    if (minutes < 60) {
      return `hace ${minutes} min`;
    }
    const hours = Math.round(minutes / 60);
    return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  }

  /**
   * Botón «Restablecer» (§5): vuelve a lo que vino del servidor y limpia el
   * borrador. Es la única vía de descartar cambios en modo edición.
   */
  restablecer(): void {
    const tree = this.formTree();
    const schema = this.schema();
    if (!tree || !schema) {
      return;
    }
    this.applyRecord(tree, schema, this.loadedRecord ?? seedModel(schema));
    this.serverErrors.set({ fields: {} });
    this.submitted.set(false);
    this.draftOffer.set(null);
    this.clearDraft();
    this.notifications.info('Se restauraron los valores originales.');
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

  /**
   * create/update según el modo; nunca lanza (los errores van a `serverErrors`).
   *
   * **Regla de éxito por flujo** (guía §6: «toast y volver a la lista o
   * quedarse según el flujo») — es la misma para los cuatro recursos:
   *
   * - **Crear** desde la pantalla completa → **vuelve a la lista** del
   *   recurso: el registro quedó creado y no hay nada más que editar acá.
   * - **Editar** → **se queda** y recarga lo guardado: el usuario sigue
   *   trabajando sobre el mismo registro.
   * - **Eliminar** → **vuelve a la lista** (`back()`).
   * - **Desde un drawer** (crear una relación desde el dropdown, edición
   *   rápida desde la lista) → **se queda** donde estaba: salir destruiría
   *   el contexto que el drawer existía para conservar. Ver
   *   `drawer-form.ts` y `relation-drawer.service.ts`.
   *
   * El toast se emite **antes** de navegar y el contenedor vive en el
   * layout, así que sobrevive al cambio de ruta y el mensaje se lee igual.
   */
  private async persist(tree: RootTree): Promise<void> {
    const schema = this.schema();
    if (!schema) {
      return;
    }
    const payload = buildPayload(schema, tree);

    try {
      if (this.mode() === 'create') {
        await firstValueFrom(this.api.create<Record<string, unknown>>(schema.endpoint, payload));
        this.notifications.success('Registro creado.');
        // Limpia `dirty` antes de navegar: si no, el guard pediría confirmar.
        tree().reset();
        // El borrador ya no aporta nada (§5.5).
        this.clearDraft();
        this.draftOffer.set(null);
        // Vuelve al listado del recurso (el «inicio» de la colección); al
        // reentrar en `:id/new` el form se reconstruye limpio.
        void this.router.navigate(['/', schema.id]);
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
      // Guardado exitoso = fin del borrador (§5.5). El snapshot se actualiza
      // para que el effect no lo reescriba con los valores ya persistidos.
      this.clearDraft();
      this.draftOffer.set(null);
      this.loadedSnapshot = JSON.stringify(tree().value());
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
    // Marca el intento: habilita `summaryErrors` (vacío hasta acá).
    this.submitted.set(true);
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
    // Una vez abiertas/activadas las secciones con errores, el navegador
    // debe IR al primer campo con problema (no quedarse arriba del form).
    // `setTimeout`: los mensajes se pintan en la pasada de change detection
    // posterior al submit.
    setTimeout(() => {
      if (this.summaryErrors().length >= 2) {
        this.focusSummary();
      } else {
        this.scrollToFirstError();
      }
    });
  }

  /** Scroll + focus al primer campo visible con mensaje de error. */
  private scrollToFirstError(): void {
    for (const wrap of document.querySelectorAll<HTMLElement>('[data-field]')) {
      if (!wrap.querySelector('p[role="alert"]')) {
        continue;
      }
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const focusable = wrap.querySelector<HTMLElement>(
        'input:not([type="hidden"]), textarea, select, [contenteditable="true"]',
      );
      focusable?.focus({ preventScroll: true });
      return;
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
      message: 'Si sales ahora, se perderán los cambios realizados.',
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

  /** Id estable de una pestaña: ancla del foco programático. */
  tabId(sectionId: string): string {
    return `section-tab-${sectionId}`;
  }

  /**
   * `role="tab"` exige moverse con `ArrowLeft`/`ArrowRight`/`Home`/`End`
   * (WAI-ARIA APG). El foco se reengancha al que quedó ACTIVO, no al que se
   * pidió: si `selectSection()` bloquea el cambio por validación (§4.9,
   * decisión A) la selección no se mueve y el foco se queda donde estaba.
   *
   * Este handler es también lo que hace correcto el `Tab`: con el roving
   * `tabindex` sólo la pestaña activa entra en el orden de tabulación, así
   * que `Tab` va del tablist al primer campo de la sección en lugar de
   * recorrer las pestañas apagadas.
   */
  onTablistKeydown(event: KeyboardEvent): void {
    const tabs = this.sectionViews();
    if (tabs.length < 2) {
      return;
    }
    const current = Math.max(
      tabs.findIndex((section) => section.id === this.activeSection()),
      0,
    );

    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.selectSection(tabs[next].id);
    const active = this.activeSection() ?? tabs[current].id;
    document.getElementById(this.tabId(active))?.focus();
  }

  tabClass(section: SectionView): string {
    return section.id === this.activeSection() ? TAB_ACTIVE : TAB_INACTIVE;
  }

  selectSection(id: string): void {
    const current = this.activeSection();
    // §4.9 / plan 5.7, decisión A: sólo se tranc después del primer envío.
    // Antes, `invalid()` es cierto por los `required` vacíos y no se le puede
    // prohibir al usuario recorrer las pestañas para ver qué hay en cada una.
    if (
      this.submitted() &&
      current !== null &&
      current !== id &&
      this.sectionHasLocalErrors(current)
    ) {
      this.revealSectionErrors(current);
      return;
    }
    this.activeSection.set(id);
  }

  /** Sólo validación local: los errores del backend no bloquean navegar. */
  private sectionHasLocalErrors(sectionId: string): boolean {
    const tree = this.formTree();
    const section = this.sectionViews().find((view) => view.id === sectionId);
    if (!tree || !section) {
      return false;
    }
    return section.fields.some((field) => childTree<unknown>(tree, field.key)().invalid());
  }

  /**
   * Marca la sección como tocada (los mensajes sólo aparecen una vez tocado)
   * y devuelve el foco al primer campo con problema, sin cambiar de pestaña.
   */
  private revealSectionErrors(sectionId: string): void {
    const tree = this.formTree();
    const section = this.sectionViews().find((view) => view.id === sectionId);
    if (!tree || !section) {
      return;
    }
    this.submitted.set(true);
    for (const field of section.fields) {
      childTree<unknown>(tree, field.key)().markAsTouched();
    }
    // Los mensajes se pintan en la pasada de change detection posterior.
    setTimeout(() => this.scrollToFirstError());
  }

  isSectionOpen(id: string): boolean {
    // Las secciones arrancan abiertas (base.md §4).
    return this.openSections()[id] ?? true;
  }

  setSectionOpen(id: string, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    this.openSections.update((sections) => ({ ...sections, [id]: open }));
  }

  /**
   * Índice lateral (§5.3) → sección. Abre el `<details>` primero: si estaba
   * plegado, saltar antes daría con un elemento sin altura. El foco va al
   * `<summary>` para que el teclado siga teniendo dónde continuar.
   */
  goToSection(id: string): void {
    this.openSections.update((open) => ({ ...open, [id]: true }));
    setTimeout(() => {
      const section = document.getElementById(`section-${id}`);
      if (!section) {
        return;
      }
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      section.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
    });
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

  /**
   * Estado de progreso de una sección (§4.3 / decisión A).
   *
   * - `complete`: sin problemas → `✓` siempre, es progreso positivo.
   * - `problem`: con problemas **después** del primer envío → `⚠`.
   * - `pending`: con problemas pero todavía no se envió → sin marca, para
   *   no amedrentar a quien recién abrió el formulario.
   */
  sectionProgress(section: SectionView): 'problem' | 'complete' | 'pending' {
    if (!this.sectionHasProblem(section)) {
      return 'complete';
    }
    return this.submitted() ? 'problem' : 'pending';
  }

  // ── Resumen de errores (§4.11) ──

  /**
   * Un ítem por campo con problema, recorriendo el árbol. Los `group` se
   * descienden para quedar en la hoja (ahí está el mensaje real); los
   * compuestos (`list`, `key-value`, `string-list`) se listan como uno,
   * porque el envoltorio es el único ancla a la que se puede saltar.
   */
  private collectErrors(): ErrorEntry[] {
    const tree = this.formTree();
    if (!tree) {
      return [];
    }
    const server = this.serverErrors().fields;
    const entries: ErrorEntry[] = [];
    const seen = new Set<string>();

    const walk = (
      fields: readonly FieldSchema[],
      subtree: RootTree,
      inheritedSection?: string,
    ): void => {
      for (const field of fields) {
        const section = field.section ?? inheritedSection;
        const state = childTree<unknown>(subtree, field.key)();
        const serverMessage = this.serverMessageFor(field.key, server);

        if (field.type === 'group') {
          const before = entries.length;
          walk(field.fields, groupTree(subtree, field.key), section);
          // El grupo sigue marcado pero ningún hijo aportó el motivo.
          if (entries.length === before && (serverMessage || state.invalid())) {
            seen.add(state.name());
            entries.push({
              id: state.name(),
              label: field.label,
              message: serverMessage ?? 'Revisa este campo',
              section,
            });
          }
          continue;
        }

        if (!state.invalid() && !serverMessage) {
          continue;
        }
        const composite =
          field.type === 'list' || field.type === 'key-value' || field.type === 'string-list';
        const id = state.name();
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        entries.push({
          id,
          label: field.label,
          message:
            serverMessage ??
            state.errors()[0]?.message ??
            (composite ? 'Hay elementos con errores' : 'Revisa este campo'),
          section,
        });
      }
    };

    walk(this.renderedFields(), tree);
    return entries;
  }

  /** Mensaje del backend para una ruta raíz (`faq` cubre `faq[2].answer`). */
  private serverMessageFor(root: string, server: Record<string, string>): string | undefined {
    for (const [path, message] of Object.entries(server)) {
      if (path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[`)) {
        return message;
      }
    }
    return undefined;
  }

  /**
   * Enlace del resumen → campo. Cambia de pestaña/sección si hace falta y
   * sólo después salta: en modo tabs el campo de otra pestaña todavía no
   * existe en el DOM en este punto.
   */
  goToError(entry: ErrorEntry, event: Event): void {
    event.preventDefault();
    if (entry.section) {
      if (this.layoutMode() === 'tabs') {
        this.activeSection.set(entry.section);
      } else {
        this.openSections.update((open) => ({ ...open, [entry.section as string]: true }));
      }
    }
    setTimeout(() => this.focusField(entry.id));
  }

  /** Scroll + focus al campo con `data-field="id"` (mismo selector que `scrollToFirstError`). */
  private focusField(id: string): void {
    const wrap = document.querySelector<HTMLElement>(`[data-field="${id}"]`);
    if (!wrap) {
      return;
    }
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = wrap.querySelector<HTMLElement>(
      'input:not([type="hidden"]), textarea, select, [contenteditable="true"]',
    );
    focusable?.focus({ preventScroll: true });
  }

  /**
   * Con 2+ errores el foco va al resumen: es la única forma de que el usuario
   * sepa que hay varios. Con uno solo se lo roba el campo, que ya está a la
   * vista — por eso el resumen ni se pinta entonces.
   */
  private focusSummary(): void {
    const summary = document.querySelector<HTMLElement>('[data-error-summary]');
    summary?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    summary?.focus({ preventScroll: true });
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

  /** Schema destino del panel «Crear nuevo»; `undefined` si no existe. */
  drawerSchema(resource: string): ResourceSchema | undefined {
    return getSchema(resource);
  }

  /**
   * Cerró el panel con un registro nuevo: se cierra, y si vino con clave se
   * le pasa a la relación que lo pidió (recarga sus opciones y lo selecciona).
   */
  relationCreated(record: Record<string, unknown>, request: RelationCreateRequest): void {
    const target = getSchema(request.resource);
    const key = target === undefined ? undefined : record[target.keyField];
    this.relationDrawer.clear();
    if (key === undefined || key === null || key === '') {
      return;
    }
    request.onCreated(String(key));
  }
}
