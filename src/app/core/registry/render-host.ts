import { NgComponentOutlet } from '@angular/common';
import {
  Component,
  computed,
  effect,
  forwardRef,
  inject,
  InjectionToken,
  input,
  isDevMode,
  PendingTasks,
  signal,
  viewChild,
  type TemplateRef,
  type Type,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { LucideCircleAlert } from '@lucide/angular';

import { FIELD_ARIA, type FieldAriaContext } from '../../fields/field-aria';
import {
  childTree,
  groupTree,
  type ListChildContext,
  type RootTree,
} from '../../fields/field-node';
import { FieldImage } from '../../fields/image/image';
import { FieldMultiselect } from '../../fields/multiselect/multiselect';
import { UnknownRender } from '../../fields/unknown-render/unknown-render';
import type {
  FieldSchema,
  GroupField,
  ImageField,
  ListField,
  MultiselectField,
  WidgetSchema,
} from '../models/schema.model';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { colSpanClass } from '../../shared/utils/col-span';
import { getSchema } from '../../schemas/registry';
import {
  get,
  isSupported,
  RENDER_CONTEXT_VACIO,
  resolve,
  type RenderContext,
  type RenderExtras,
  type RenderKind,
} from './render-registry';

/**
 * El contexto vive en el registro (R3.6): el contrato de `RenderDescriptor.
 * inputs` necesita nombrarlo. Se re-exporta acá para que `field-host` y sus
 * tests no cambien de domicilio.
 */
export type { RenderContext } from './render-registry';

/** Token con el que los controles inyectan el `RenderContext` del host. */
export const RENDER_CONTEXT = new InjectionToken<RenderContext>('RENDER_CONTEXT');

/**
 * Host genérico de render (R3.4).
 *
 * Sustituye el `@switch` de 21 ramas de `FieldHost` por una resolución contra
 * `core/registry/render-registry.ts`: el tipo llega por `[type]`, el registro
 * devuelve el componente y `NgComponentOutlet` lo monta. Añadir un tipo deja
 * de tocar este archivo.
 *
 * Conserva el envoltorio que `FieldHost` dibujaba — `<label>`, marca
 * required/opcional, `data-field`, `colSpanClass`, mensaje de error y ayuda —
 * porque eso es lo que el operador ve y no depende del tipo de control.
 *
 * **Sin imports de los 20 controles**: sólo llegan por `load()` perezoso del
 * descriptor. Mientras el `import()` resuelve se pinta `Skeleton`, y un tipo
 * fuera del catálogo degrada a `UnknownRender` en dev (nunca pantalla rota).
 */
@Component({
  selector: 'app-render-host',
  imports: [
    FieldImage,
    FieldMultiselect,
    FormField,
    LucideCircleAlert,
    NgComponentOutlet,
    RenderHost,
    Skeleton,
    UnknownRender,
  ],
  // El envoltorio de render es quien conoce la ayuda y el error —ambos viven
  // en SU plantilla—, así que de aquí sale el contexto de accesibilidad y el
  // de render, igual que salían de `FieldHost`.
  providers: [
    { provide: FIELD_ARIA, useExisting: forwardRef(() => RenderHost) },
    { provide: RENDER_CONTEXT, useExisting: forwardRef(() => RenderHost) },
  ],
  template: `
    <ng-template #groupContent>
      @for (child of group().fields; track child.key) {
        <div [class]="colSpan(child.width)">
          <app-render-host
            [kind]="kind()"
            [type]="child.type"
            [config]="child"
            [ctx]="groupChildCtx()"
          />
        </div>
      }
    </ng-template>

    <ng-template #childTpl let-child>
      @for (sub of child.fields; track sub.key) {
        <div [class]="child.row ? 'min-w-0 grow' : colSpan(sub.width)">
          <app-render-host
            [kind]="kind()"
            [type]="sub.type"
            [config]="sub"
            [ctx]="listChildCtx(child)"
          />
        </div>
      }
    </ng-template>

    @if (supported()) {
      @if (esCampo()) {
        <div class="mb-4" [class.field-enter]="cfgCampo().visibleWhen" [attr.data-field]="name()">
          @if (type() !== 'group') {
            @if (composite()) {
              <!-- Sin control único no existe ancla para el atributo for del
                 label: apuntaría a un id inexistente. Se dibuja como texto
                 (los controles internos reciben su propia etiqueta por campo
                 anidado). -->
              <div class="mb-1 text-label font-medium">
                {{ config().label }}
                @if (showRequiredMark()) {
                  <span aria-hidden="true" class="text-danger">*</span>
                }
                @if (showOptionalMark()) {
                  <span class="font-normal text-neutral">(opcional)</span>
                }
              </div>
            } @else {
              <label [for]="name()" class="mb-1 block text-label font-medium">
                {{ config().label }}
                @if (showRequiredMark()) {
                  <span aria-hidden="true" class="text-danger">*</span>
                }
                @if (showOptionalMark()) {
                  <span class="font-normal text-neutral">(opcional)</span>
                }
              </label>
            }
          }

          @if (type() === 'multiselect') {
            <!-- Dos de los veinte no pueden pasar por "NgComponentOutlet": su
               sincronización con Signal Forms vive en ɵɵcontrol, una
               instrucción que el compilador emite únicamente junto al binding
               formField de la propia plantilla. Sin ese binding escrito en el
               HTML el model() de value nunca se inicializa y el control lanza
               NG0952. Se declaran a mano (D27) y el resto de tipos siguen
               saliendo del registro. -->
            <app-field-multiselect
              [id]="name()"
              [field]="multiselectCfg()"
              [formField]="multiselectNode()"
            />
          } @else if (type() === 'image') {
            <app-field-image
              [id]="name()"
              [field]="imageCfg()"
              [formField]="imageNode()"
              [resource]="ctx().resource"
            />
          } @else {
            @if (control()) {
              <ng-container
                [ngComponentOutlet]="control()"
                [ngComponentOutletInputs]="controlInputs()"
              />
            } @else {
              <app-skeleton [lines]="2" [height]="32" />
            }
          }

          @if (errorMessage(); as message) {
            <p
              [id]="errorId()"
              class="mt-1 flex items-center gap-1 text-help text-danger"
              role="alert"
            >
              <svg lucideCircleAlert size="14" class="shrink-0" />
              {{ message }}
            </p>
          } @else if (config().help; as help) {
            <p [id]="helpId()" class="mt-1 text-help text-neutral">{{ help }}</p>
          }
        </div>
      } @else {
        <!-- Rama de widget (R3.6): el mismo outlet y el mismo cableado que
             un campo, pero sin el envoltorio — un widget no tiene etiqueta
             asociada, ni marca required, ni error, ni ayuda. El ancho en la
             grilla lo pone su host (app-widget-host), no el motor. -->
        @if (control()) {
          <ng-container
            [ngComponentOutlet]="control()"
            [ngComponentOutletInputs]="controlInputs()"
          />
        } @else {
          <app-skeleton [lines]="2" [height]="32" />
        }
      }
    } @else if (showUnknown()) {
      <!-- R1.10: degradación controlada. Un tipo fuera del catálogo no
           revienta; en dev se avisa y en producción sólo se omite. -->
      <app-unknown-render [type]="type()" [label]="config().label" />
    }
  `,
})
export class RenderHost implements FieldAriaContext, RenderContext {
  /** Categoría de render. Resuelve campos y widgets (R3.6). */
  readonly kind = input<RenderKind>('field');
  /** Identificador del tipo dentro de su `kind`. */
  readonly type = input.required<string>();
  /** Configuración del descriptor: el `FieldSchema` del campo o el `WidgetSchema`. */
  readonly config = input.required<FieldSchema | WidgetSchema>();
  /**
   * Contexto de render del nivel de este campo.
   *
   * Con valor por defecto y no requerido: los widgets no pertenecen a un
   * formulario y llegan sin árbol (R3.6). El default es un contexto vacío
   * que nunca se lee en esa rama — un campo montado sin contexto real ya
   * era un error antes y `childTree` lo sigue siendo.
   */
  readonly ctx = input<RenderContext>(RENDER_CONTEXT_VACIO);
  /** Payload del widget (`app-widget-host [data]`). `null` en campos. */
  readonly data = input<unknown>(null);

  private readonly dev = isDevMode();

  /** Mantiene `whenStable()` bloqueado mientras el descriptor carga su chunk. */
  private readonly pendientes = inject(PendingTasks);

  /** `true` cuando se dibuja un campo, `false` para cualquier otro `kind`. */
  protected readonly esCampo = computed(() => this.kind() === 'field');

  /** Configuración leída como campo. Sólo válida en la rama de campo. */
  private readonly cfgCampo = computed(() => this.config() as FieldSchema);

  private readonly node = computed(() => childTree<unknown>(this.ctx().tree, this.cfgCampo().key));

  protected readonly state = computed(() => this.node()());

  /** Nombre del control: ancla del `<label for>` y base de `*-help`/`*-error`. */
  protected readonly name = computed(() => this.state().name());

  /**
   * Fuera del catálogo o oculto por `visibleWhen`: no se dibuja.
   *
   * El `isSupported` va primero y corta antes de leer `state()`: un tipo
   * desconocido se siembra como `undefined`, Signal Forms no le crea nodo y
   * `childTree` lanzaría «El formulario no contiene el campo».
   *
   * El `esCampo()` corta lo mismo para los widgets: no hay árbol que ocultar
   * ni nodo que consultar, así que el widget se dibuja si está en el
   * catálogo y ya.
   */
  protected readonly supported = computed(() => {
    if (!isSupported(this.kind(), this.type())) {
      return false;
    }
    return this.esCampo() ? !this.state().hidden() : true;
  });

  /** Tipo fuera del catálogo, con independencia de si está oculto. */
  private readonly unsupported = computed(() => !isSupported(this.kind(), this.type()));

  protected readonly showUnknown = computed(() => this.unsupported() && this.dev);

  private readonly _trazaTipoDesconocido = effect(() => {
    if (!this.unsupported() || this.dev) return;
    console.warn(`[render-host] tipo sin renderizador: "${this.type()}" — se omite el control.`);
  });

  // ── Resolución del componente ────────────────────────────────────────────

  /** Componente montado, o `null` mientras el `load()` perezoso resuelve. */
  private readonly control = signal<Type<unknown> | null>(null);

  /** Descarta cargas obsoletas cuando el tipo cambia antes de que resuelva. */
  private carga = 0;

  private readonly _cargar = effect(() => {
    const kind = this.kind();
    const type = this.type();
    const carga = ++this.carga;
    this.control.set(null);
    if (!isSupported(kind, type)) return;
    // El `load()` del descriptor es un `import()` de chunk, que `whenStable()`
    // NO espera por sí solo (queda fuera del ciclo de estabilidad y el control
    // llegaría tarde a un `detectChanges()` posterior). Registrándolo como
    // tarea pendiente la estabilidad cubre la carga: el skeleton se pinta
    // mientras baja y el control aparece en el siguiente ciclo ya montado.
    this.pendientes.run(async () => {
      const componente = await resolve(kind, type, UnknownRender);
      if (this.carga === carga) this.control.set(componente);
    });
  });

  /**
   * Inputs del componente montado.
   *
   * El motor no sabe qué recibe cada tipo: pregunta al descriptor (`inputs`)
   * y sólo aplica la forma estándar del `kind` cuando el descriptor no la
   * sobreescribe — `{field, tree}` en campos, `{widget, data}` en widgets.
   * Ésa es la pieza que hace que «añadir un tipo» no toque este archivo
   * (R3.8). `multiselect` e `image` no pasan por aquí: se declaran a mano
   * por D27.
   */
  private readonly controlInputs = computed<Record<string, unknown>>(() => {
    const cfg = this.config();
    const extras: RenderExtras = {
      ctx: this.ctx(),
      data: this.data(),
      groupContent: this.groupTpl(),
      childTemplate: this.childTpl(),
    };

    const descriptor = get(this.kind(), this.type());
    if (descriptor?.inputs) {
      return descriptor.inputs(cfg, extras);
    }

    return this.esCampo()
      ? { field: cfg as FieldSchema, tree: this.ctx().tree }
      : { widget: cfg, data: this.data() };
  });

  // ── Recursión de los tipos compuestos ────────────────────────────────────

  protected readonly group = computed(() => this.config() as GroupField);
  protected readonly list = computed(() => this.config() as ListField);

  private readonly groupTpl = viewChild<TemplateRef<unknown>>('groupContent');
  private readonly childTpl = viewChild<TemplateRef<unknown>>('childTpl');

  /** Subárbol y prefijo que heredan los hijos del grupo. */
  protected readonly groupChildCtx = computed<RenderContext>(() => ({
    ...this.ctx(),
    tree: groupTree(this.ctx().tree, this.config().key),
    pathPrefix: `${this.ctx().pathPrefix}${this.config().key}.`,
  }));

  protected listChildCtx(child: ListChildContext): RenderContext {
    return {
      tree: child.tree,
      serverErrors: child.errors,
      pathPrefix: child.prefix,
      exists: child.exists,
      resource: this.ctx().resource,
    };
  }

  /** `sm:col-span-*` compartido con el grupo (literales: Tailwind v4 es JIT). */
  colSpan(width?: number): string {
    return colSpanClass(width);
  }

  // ── Envoltorio: label, marcas y estado ───────────────────────────────────

  /**
   * Los dos `FormValueControl` se declaran en la plantilla (D27), así que su
   * campo necesita el tipo estrecho que exige cada input — el mismo estrechado
   * que hacía `FieldHost`.
   */
  protected readonly multiselectCfg = computed(() => this.config() as MultiselectField);

  protected readonly imageCfg = computed(() => this.config() as ImageField);

  private readonly multiselectNode = computed(() =>
    childTree<string[]>(this.ctx().tree, this.config().key),
  );

  private readonly imageNode = computed(() =>
    childTree<string>(this.ctx().tree, this.config().key),
  );

  /**
   * Error visible: primero el del backend (si existe para esta ruta) y
   * después el propio, solo cuando el campo ya se tocó (validación al
   * perder el foco).
   */
  protected readonly errorMessage = computed<string | null>(() => {
    const serverError = this.ctx().serverErrors[`${this.ctx().pathPrefix}${this.config().key}`];
    if (serverError) {
      return serverError;
    }
    const state = this.state();
    if (!state.invalid() || !state.touched()) {
      return null;
    }
    return state.errors()[0]?.message ?? 'Revisa este campo.';
  });

  /**
   * Compuestos: varios controles internos, ninguno único. Para ellos
   * `<label for>` no tendría ancla, porque ningún elemento lleva el id del
   * campo padre (los hijos tienen los suyos propios).
   */
  protected readonly composite = computed(() =>
    new Set(['list', 'key-value', 'string-list', 'multiselect']).has(this.config().type),
  );

  // Contexto de accesibilidad consumido por `FieldAria` en los controles.

  /**
   * Ancla de la ayuda, sólo mientras no hay error: §2 dice que el error
   * **reemplaza** la ayuda, de modo que el id no puede apuntar a un nodo
   * que ya no está en el DOM.
   */
  readonly helpId = computed(() =>
    this.config().help && !this.errorMessage() ? `${this.name()}-help` : null,
  );

  readonly errorId = computed(() => (this.errorMessage() ? `${this.name()}-error` : null));

  readonly describedBy = computed(
    () => [this.helpId(), this.errorId()].filter(Boolean).join(' ') || null,
  );

  /** Mismo criterio que `errorMessage()` — el estado del control no es público. */
  readonly invalid = computed(() => this.errorMessage() !== null);

  readonly required = computed(() => this.cfgCampo().required ?? false);

  // §2: "si casi todos son obligatorios, marcar los opcionales con
  // «(opcional)»" en vez de sembrar `*` por todo el formulario.

  private readonly schema = computed(() => getSchema(this.ctx().resource));

  /**
   * Se decide una vez por recurso y se aplica a todos los niveles: es un
   * juicio de diseño sobre el formulario, no sobre un campo suelto. Contado
   * por nivel (sólo top-level) — un conteo plano mezcla los subcampos de
   * `group`/`list` y da ratios imposibles.
   */
  protected readonly markOptionals = computed(() => {
    const fields = this.schema()?.fields ?? [];
    if (fields.length === 0) {
      return false;
    }
    const required = fields.filter((field) => field.required).length;
    return required / fields.length >= 0.75;
  });

  protected readonly showRequiredMark = computed(
    () => !this.markOptionals() && this.cfgCampo().required,
  );

  protected readonly showOptionalMark = computed(
    () => this.markOptionals() && !this.cfgCampo().required,
  );

  // ── RenderContext (por DI) ───────────────────────────────────────────────

  get tree(): RootTree {
    return this.ctx().tree;
  }

  get serverErrors(): Record<string, string> {
    return this.ctx().serverErrors;
  }

  get pathPrefix(): string {
    return this.ctx().pathPrefix;
  }

  get exists(): boolean {
    return this.ctx().exists;
  }

  get resource(): string {
    return this.ctx().resource;
  }
}
