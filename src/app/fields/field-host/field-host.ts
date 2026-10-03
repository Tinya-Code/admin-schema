import { Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type {
  BooleanField,
  CurrencyField,
  DateField,
  EmailField,
  FieldSchema,
  GroupField,
  ImageField,
  KeyValueField,
  ListField,
  MultiselectField,
  NumberField,
  PhoneField,
  ReadonlyTextField,
  RelationField,
  SelectField,
  SlugField,
  StringListField,
  TextareaField,
  TextField,
  TimeField,
  UrlField,
} from '../../core/models/schema.model';
import { colSpanClass } from '../../shared/utils/col-span';
import { childTree, groupTree, type RootTree } from '../field-node';
import { FieldBoolean } from '../boolean/boolean';
import { FieldCurrency } from '../currency/currency';
import { FieldDate } from '../date/date';
import { FieldEmail } from '../email/email';
import { FieldGroup } from '../group/group';
import { FieldImage } from '../image/image';
import { FieldKeyValue } from '../key-value/key-value';
import { FieldList } from '../list/list';
import { FieldMultiselect } from '../multiselect/multiselect';
import { FieldNumber } from '../number/number';
import { FieldPhone } from '../phone/phone';
import { FieldReadonlyText } from '../readonly-text/readonly-text';
import { FieldRelation } from '../relation/relation';
import { FieldSelect } from '../select/select';
import { FieldSlug } from '../slug/slug';
import { FieldStringList } from '../string-list/string-list';
import { FieldText } from '../text/text';
import { FieldTextarea } from '../textarea/textarea';
import { FieldTime } from '../time/time';
import { FieldUrl } from '../url/url';

/** Tipos que la UI sabe renderizar. */
const SUPPORTED_FIELD_TYPES = new Set<string>([
  'text',
  'textarea',
  'slug',
  'number',
  'currency',
  'boolean',
  'select',
  'multiselect',
  'url',
  'email',
  'phone',
  'date',
  'time',
  'readonly-text',
  'group',
  'list',
  'string-list',
  'key-value',
  'relation',
  'image',
]);

/** ¿La UI sabe renderizar este tipo de campo? */
export function isSupportedFieldType(type: string): boolean {
  return SUPPORTED_FIELD_TYPES.has(type);
}

/**
 * Despachador de campos por `type` (base.md §5). Renderiza el rótulo, la
 * ayuda y el estado de validación; cada componente de tipo dibuja SOLO el
 * control.
 *
 * **Auto-import**: los tipos compuestos vuelven a invocar a este host
 * (`group` e `list` instancian un `ng-template` del host con
 * `ngTemplateOutlet`: `#groupContent` por grupo y `#childTpl` por ítem de
 * lista). El componente se importa a sí mismo en `imports` — patrón
 * verificado, sin error `ɵcmp`.
 *
 * Rutas del backend: `pathPrefix` encadena el prefijo del contenedor
 * (`address.`, `faq[2].`) y `serverErrors` lleva el mapa completo; el error
 * propio de este campo se resuelve como `serverErrors[prefix + key]`.
 *
 * El error propio del campo se muestra al perder el foco (base.md §10:
 * validación campo a campo) y desaparece al corregir el valor; el error que
 * devuelve el backend lo pinta sin esperar el foco.
 */
@Component({
  selector: 'app-field-host',
  imports: [
    FieldBoolean,
    FieldCurrency,
    FieldDate,
    FieldEmail,
    FieldGroup,
    FieldHost,
    FieldImage,
    FieldKeyValue,
    FieldList,
    FieldMultiselect,
    FieldNumber,
    FieldPhone,
    FieldReadonlyText,
    FieldRelation,
    FieldSelect,
    FieldSlug,
    FieldStringList,
    FieldText,
    FieldTextarea,
    FieldTime,
    FieldUrl,
    FormField,
  ],
  template: `
    @if (supported()) {
      <div class="mb-4">
        @if (field().type !== 'group') {
          <label [for]="state().name()" class="mb-1 block text-sm font-medium">
            {{ field().label }}
            @if (field().required) {
              <span aria-hidden="true" class="text-danger">*</span>
            }
          </label>
        }

        @switch (field().type) {
          @case ('text') {
            <app-field-text [field]="text()" [tree]="tree()" />
          }
          @case ('textarea') {
            <app-field-textarea [field]="textarea()" [tree]="tree()" />
          }
          @case ('slug') {
            <app-field-slug [field]="slug()" [tree]="tree()" [exists]="exists()" />
          }
          @case ('number') {
            <app-field-number [field]="number()" [tree]="tree()" />
          }
          @case ('currency') {
            <app-field-currency [field]="currency()" [tree]="tree()" />
          }
          @case ('boolean') {
            <app-field-boolean [field]="boolean()" [tree]="tree()" />
          }
          @case ('select') {
            <app-field-select [field]="select()" [tree]="tree()" />
          }
          @case ('multiselect') {
            <app-field-multiselect
              [id]="state().name()"
              [field]="multiselect()"
              [formField]="multiselectNode()"
            />
          }
          @case ('url') {
            <app-field-url [field]="url()" [tree]="tree()" />
          }
          @case ('email') {
            <app-field-email [field]="email()" [tree]="tree()" />
          }
          @case ('phone') {
            <app-field-phone [field]="phone()" [tree]="tree()" />
          }
          @case ('date') {
            <app-field-date [field]="date()" [tree]="tree()" />
          }
          @case ('time') {
            <app-field-time [field]="time()" [tree]="tree()" />
          }
          @case ('readonly-text') {
            <app-field-readonly-text [field]="readonlyText()" [tree]="tree()" />
          }
          @case ('group') {
            <ng-template #groupContent>
              @for (child of group().fields; track child.key) {
                <div [class]="colSpan(child.width)">
                  <app-field-host
                    [field]="child"
                    [tree]="groupSubtree()"
                    [exists]="exists()"
                    [serverErrors]="serverErrors()"
                    [pathPrefix]="groupPrefix()"
                    [resource]="resource()"
                  />
                </div>
              }
            </ng-template>
            <app-field-group
              [field]="group()"
              [tree]="tree()"
              [serverErrors]="serverErrors()"
              [pathPrefix]="pathPrefix()"
              [content]="groupContent"
            />
          }
          @case ('list') {
            <ng-template #childTpl let-child>
              @for (sub of child.fields; track sub.key) {
                <div [class]="child.row ? 'min-w-0 grow' : child.colSpan(sub.width)">
                  <app-field-host
                    [field]="sub"
                    [tree]="child.tree"
                    [exists]="child.exists"
                    [serverErrors]="child.errors"
                    [pathPrefix]="child.prefix"
                    [resource]="resource()"
                  />
                </div>
              }
            </ng-template>
            <app-field-list
              [field]="list()"
              [tree]="tree()"
              [childTemplate]="childTpl"
              [serverErrors]="serverErrors()"
              [pathPrefix]="pathPrefix()"
              [exists]="exists()"
            />
          }
          @case ('string-list') {
            <app-field-string-list [field]="stringList()" [tree]="tree()" />
          }
          @case ('key-value') {
            <app-field-key-value [field]="keyValue()" [tree]="tree()" />
          }
          @case ('relation') {
            <app-field-relation [field]="relation()" [tree]="tree()" />
          }
          @case ('image') {
            <app-field-image
              [id]="state().name()"
              [field]="image()"
              [formField]="imageNode()"
              [resource]="resource()"
            />
          }
        }

        @if (field().help; as help) {
          <p class="mt-1 text-xs text-neutral">{{ help }}</p>
        }
        @if (errorMessage(); as message) {
          <p class="mt-1 text-xs text-danger" role="alert">{{ message }}</p>
        }
      </div>
    }
  `,
})
export class FieldHost {
  /** Descriptor del campo (schema). */
  readonly field = input.required<FieldSchema>();
  /** Árbol del formulario del nivel padre (raíz o grupo). */
  readonly tree = input.required<RootTree>();
  /** Si el registro ya existe (lo consume `slug` con `lockAfterCreate`). */
  readonly exists = input(false);
  /** Errores del backend por ruta (`address.street`, `faq[2].answer`). */
  readonly serverErrors = input<Record<string, string>>({});
  /** Prefijo de ruta de este campo en el registro raíz (`address.`). */
  readonly pathPrefix = input('');
  /** Recurso dueño del formulario (lo consume `image` para la firma, §11.2). */
  readonly resource = input('');

  /** Fuera del catálogo o oculto por `visibleWhen`: no se dibuja. */
  protected readonly supported = computed(
    () => isSupportedFieldType(this.field().type) && !this.state().hidden(),
  );

  // El @switch garantiza el tipo; los computeds estrechan el union.
  protected readonly text = computed(() => this.field() as TextField);
  protected readonly textarea = computed(() => this.field() as TextareaField);
  protected readonly slug = computed(() => this.field() as SlugField);
  protected readonly number = computed(() => this.field() as NumberField);
  protected readonly currency = computed(() => this.field() as CurrencyField);
  protected readonly boolean = computed(() => this.field() as BooleanField);
  protected readonly select = computed(() => this.field() as SelectField);
  protected readonly multiselect = computed(() => this.field() as MultiselectField);
  protected readonly url = computed(() => this.field() as UrlField);
  protected readonly email = computed(() => this.field() as EmailField);
  protected readonly phone = computed(() => this.field() as PhoneField);
  protected readonly date = computed(() => this.field() as DateField);
  protected readonly time = computed(() => this.field() as TimeField);
  protected readonly readonlyText = computed(() => this.field() as ReadonlyTextField);
  protected readonly group = computed(() => this.field() as GroupField);
  protected readonly list = computed(() => this.field() as ListField);
  protected readonly stringList = computed(() => this.field() as StringListField);
  protected readonly keyValue = computed(() => this.field() as KeyValueField);
  protected readonly relation = computed(() => this.field() as RelationField);
  protected readonly image = computed(() => this.field() as ImageField);

  private readonly node = computed(() => childTree<unknown>(this.tree(), this.field().key));
  /** Nodo tipado para el control custom `multiselect` (`[formField]`). */
  private readonly multiselectNode = computed(() =>
    childTree<string[]>(this.tree(), this.field().key),
  );
  /** Nodo tipado para el control custom `image`. */
  private readonly imageNode = computed(() => childTree<string>(this.tree(), this.field().key));
  /** Subárbol del grupo: desde ahí se navegan sus hijos proyectados. */
  private readonly groupSubtree = computed(() => groupTree(this.tree(), this.field().key));
  /** Prefijo de ruta que heredan los hijos del grupo (`address.`). */
  private readonly groupPrefix = computed(() => `${this.pathPrefix()}${this.field().key}.`);
  protected readonly state = computed(() => this.node()());

  /** `sm:col-span-*` compartido con el grupo (literales: Tailwind v4 es JIT). */
  colSpan(width?: number): string {
    return colSpanClass(width);
  }

  /**
   * Error visible: primero el del backend (si existe para esta ruta) y
   * después el propio, solo cuando el campo ya se tocó (validación al
   * perder el foco).
   */
  protected readonly errorMessage = computed<string | null>(() => {
    const serverError = this.serverErrors()[`${this.pathPrefix()}${this.field().key}`];
    if (serverError) {
      return serverError;
    }
    const state = this.state();
    if (!state.invalid() || !state.touched()) {
      return null;
    }
    return state.errors()[0]?.message ?? 'Valor inválido';
  });
}
