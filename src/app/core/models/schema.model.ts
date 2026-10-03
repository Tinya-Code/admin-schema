/**
 * Modelos del schema de recursos — única fuente de verdad de la UI.
 * Especificación: doc/base.md §3–§7 y §9.
 *
 * Contrato de imágenes (decisión api.md §1): `image_url` en todo el JSON.
 */

/** Anchos de columna dentro de una fila del layout (base.md §4: 1–12). */
export type GridWidth = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** Operadores de `visibleWhen` / `readonlyWhen` (base.md §4). */
export type ConditionOperator = 'eq' | 'ne' | 'empty' | 'contains';

/**
 * Condición simple sobre otro campo del mismo nivel o del registro raíz.
 * Ej.: `{ field: 'availability', operator: 'eq', value: 'PreOrder' }`.
 */
export interface FieldCondition {
  field: string;
  operator: ConditionOperator;
  /** Valor de comparación; no aplica para `empty`. */
  value?: string | number | boolean;
}

/**
 * Reglas de validación comunes (base.md §4).
 * Nota: algunas se solapan con opciones propias del tipo (§5); el motor de
 * validación (Fase 10) los fusiona y `validators` tiene prioridad.
 */
export interface FieldValidators {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
  minWords?: number;
  maxWords?: number;
  /** El valor debe ser único en el recurso (validación asíncrona). */
  unique?: boolean;
}

/** Propiedades comunes a todo campo (base.md §4). */
export interface FieldBase<T> {
  /** Nombre de la propiedad en el JSON. */
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  default?: T;
  readonly?: boolean;
  readonlyWhen?: FieldCondition;
  visibleWhen?: FieldCondition;
  validators?: FieldValidators;
  width?: GridWidth;
  /** Id de la sección/pestaña del layout a la que pertenece (base.md §4). */
  section?: string;
}

// ─────────────────────────────────────────────────────────────
// §5.1 Campos simples (valor escalar)
// ─────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface TextField extends FieldBase<string> {
  type: 'text';
  maxLength?: number;
  pattern?: string;
}

export interface TextareaField extends FieldBase<string> {
  type: 'textarea';
  rows?: number;
  minWords?: number;
  maxWords?: number;
}

export interface SlugField extends FieldBase<string> {
  type: 'slug';
  /** Campo del que se autogenera el slug (ej. `name`). */
  from: string;
  /** Bloquea el campo una vez creado el registro (por defecto: sí). */
  lockAfterCreate?: boolean;
}

export interface NumberField extends FieldBase<number> {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
}

export interface CurrencyField extends FieldBase<number> {
  type: 'currency';
  /** Campo del registro del que se toma la moneda (ej. `currency`). */
  currencyFrom?: string;
}

export interface BooleanField extends FieldBase<boolean> {
  type: 'boolean';
  trueLabel?: string;
  falseLabel?: string;
}

export interface SelectField extends FieldBase<string> {
  type: 'select';
  options: SelectOption[];
}

export interface MultiselectField extends FieldBase<string[]> {
  type: 'multiselect';
  options: SelectOption[];
}

export interface UrlField extends FieldBase<string> {
  type: 'url';
}

export interface EmailField extends FieldBase<string> {
  type: 'email';
}

export interface PhoneField extends FieldBase<string> {
  type: 'phone';
  /** Normalización del valor guardado. */
  format?: 'e164' | 'digits';
}

export interface DateField extends FieldBase<string> {
  type: 'date';
  /** Fecha ISO `YYYY-MM-DD` permitida. */
  min?: string;
  max?: string;
}

export interface TimeField extends FieldBase<string> {
  type: 'time';
}

export interface ReadonlyTextField extends FieldBase<string> {
  type: 'readonly-text';
  /** Formato de presentación (texto, fecha, moneda…). */
  format?: string;
}

// ─────────────────────────────────────────────────────────────
// §5.2 Referencias
// ─────────────────────────────────────────────────────────────

export interface RelationField extends FieldBase<string> {
  type: 'relation';
  /** Recurso del que se cargan las opciones (id de otro ResourceSchema). */
  resource: string;
  valueField?: string;
  labelField?: string;
  /** Cargar solo registros activos. */
  onlyActive?: boolean;
}

// ─────────────────────────────────────────────────────────────
// §5.3 Imagen — el valor es SOLO la URL pública (`image_url`)
// ─────────────────────────────────────────────────────────────

export interface ImageField extends FieldBase<string> {
  type: 'image';
  /** Tipos aceptados (ej. `image/*`, `image/png,image/jpeg`). */
  accept?: string;
  maxSizeMB?: number;
  /** Relación de aspecto de la vista previa (ej. `16/9`). */
  aspectRatio?: string;
  previewSize?: string;
}

// ─────────────────────────────────────────────────────────────
// §5.4 Campos compuestos (contienen otros campos)
// ─────────────────────────────────────────────────────────────

export interface GroupField extends FieldBase<Record<string, unknown>> {
  type: 'group';
  fields: FieldSchema[];
  /** Presentación del grupo (base.md §5.4). */
  display?: 'card' | 'collapsible' | 'inline';
}

/** Propiedades comunes a las listas (base.md §6). */
export interface ListOptions {
  min?: number;
  max?: number;
  /** Si se puede reordenar (por defecto: sí). */
  sortable?: boolean;
  /** Campo donde se guarda el orden dentro de cada item (`position`). */
  positionField?: string;
  addLabel?: string;
  emptyText?: string;
  itemDisplay?: 'card' | 'row' | 'accordion';
}

export interface ListField extends FieldBase<Record<string, unknown>[]>, ListOptions {
  type: 'list';
  /** Campos de cada item (cualquier tipo, incluso `group` o `list`). */
  itemFields: FieldSchema[];
  /** Campo del item usado como título cuando está colapsado. */
  itemTitle?: string;
  /** El primer item tiene significado especial (ej. imagen principal). */
  primaryFirst?: boolean;
}

export interface StringListField extends FieldBase<string[]>, ListOptions {
  type: 'string-list';
  /** Tipo permitido de cada item (base.md §9: solo text, url o email). */
  itemType?: 'text' | 'url' | 'email';
}

export interface KeyValueItem {
  key: string;
  value: string;
}

export interface KeyValueField extends FieldBase<KeyValueItem[]>, ListOptions {
  type: 'key-value';
}

// ─────────────────────────────────────────────────────────────
// Unión discriminada por `type` (20 tipos, base.md §5)
// ─────────────────────────────────────────────────────────────

export type FieldSchema =
  | TextField
  | TextareaField
  | SlugField
  | NumberField
  | CurrencyField
  | BooleanField
  | SelectField
  | MultiselectField
  | UrlField
  | EmailField
  | PhoneField
  | DateField
  | TimeField
  | ReadonlyTextField
  | RelationField
  | ImageField
  | GroupField
  | ListField
  | StringListField
  | KeyValueField;

export type FieldType = FieldSchema['type'];

// ─────────────────────────────────────────────────────────────
// Listado, layout y metadatos del recurso (base.md §3)
// ─────────────────────────────────────────────────────────────

export type ListColumnFormat =
  'text' | 'badge' | 'thumbnail' | 'boolean' | 'number' | 'currency' | 'date';

export interface ListColumn {
  key: string;
  label: string;
  /** Por defecto: `text`. */
  format?: ListColumnFormat;
}

export interface ListFilter {
  key: string;
  label: string;
  type?: 'text' | 'select' | 'boolean';
  options?: SelectOption[];
}

export interface LayoutSection {
  /** Coincide con `field.section`. */
  id: string;
  label: string;
}

export interface ResourceLayout {
  /** Secciones colapsables (por defecto) o pestañas. */
  mode?: 'sections' | 'tabs';
  sections: LayoutSection[];
  // Las columnas se definen con `field.width` (1–12) dentro de cada sección.
}

/** Acciones extra del listado (base.md §3): duplicar, activar/desactivar… */
export interface ResourceAction {
  id: string;
  label: string;
  icon?: string;
  /** Para `open-url`: plantilla con marcadores, ej. `/products/{slug}`. */
  urlTemplate?: string;
}

/** Operaciones permitidas (base.md §3). `undefined` = permitido. */
export interface ResourcePermissions {
  create?: boolean;
  update?: boolean;
  remove?: boolean;
  reorder?: boolean;
}

/**
 * Rutas de la API relativas a `API_URL` (base.md §3, api.md §6 Opción A).
 * Pueden incluir el marcador `{key}`. Los singleton solo usan
 * `get` / `update`.
 */
export interface ResourceEndpoints {
  list?: string;
  get?: string;
  create?: string;
  update?: string;
  remove?: string;
}

export interface ResourceSchema {
  /** Identificador interno (`categories`). */
  id: string;
  label: string;
  labelPlural: string;
  kind: 'collection' | 'singleton';
  endpoint: ResourceEndpoints;
  /** Campo que identifica el registro (`slug`). */
  keyField: string;
  /** Campo que se muestra como nombre del registro. */
  titleField: string;
  /** Si el listado se reordena (requiere `positionField`). */
  sortable?: boolean;
  positionField?: string;
  listColumns: ListColumn[];
  filters?: ListFilter[];
  /** Campos buscables en el listado. */
  search?: string[];
  /** Árbol de campos del formulario (base.md §4–§6). */
  fields: FieldSchema[];
  layout?: ResourceLayout;
  actions?: ResourceAction[];
  permissions?: ResourcePermissions;

  // ── Metadatos públicos de `/admin/schema` (F7-1, PLAN-MEJORAS) ──
  // Ausentes ⇒ sólo manda el schema local (merge local-driven preservado).
  /** Rutas efectivas por operación, con la forma pública si la declara. */
  operations?: ResourceOperations;
  /** Vistas declaradas como metadatos (sin operandos internos). */
  views?: Record<string, ViewDescriptor>;
  /** Lo mínimo del backend para menú/acciones: `access` normalizado. */
  policies?: ResourcePolicies;
}

// ─────────────────────────────────────────────────────────────
// Metadatos públicos de `/admin/schema` (F7-1)
// ─────────────────────────────────────────────────────────────

/** Forma pública de la respuesta de una operación (declaración `shape`). */
export interface OperationShape {
  pick?: 'full' | 'list' | string[];
  include?: string[];
  rename?: Record<string, string>;
  nest?: Record<string, string[]>;
  envelope?: 'plain' | 'list';
}

/** Ruta efectiva de una operación: método + path (con `{key}` si aplica). */
export interface OperationDescriptor {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  shape?: OperationShape;
}

/** Operaciones CRUD efectivas (derivadas de la misma ruta que el router). */
export interface ResourceOperations {
  list?: OperationDescriptor;
  get?: OperationDescriptor;
  create?: OperationDescriptor;
  update?: OperationDescriptor;
  remove?: OperationDescriptor;
}

/**
 * Condición de vista como metadato público: el literal `value` y el `ref`
 * (metadato de relación) viajan; el operando interno `from: '$item.x'` no.
 */
export interface ViewCondition {
  field: string;
  op: string;
  not?: boolean;
  value?: unknown;
  ref?: string;
}

/** Vista declarada publicada como metadato (F7-1). */
export interface ViewDescriptor {
  where?: ViewCondition[];
  sort?: { field: string; dir?: 'asc' | 'desc' }[];
  limit?: number;
  extends?: string;
  /** Vista con handler propio (escape hatch): su existencia, nada más. */
  custom?: boolean;
}

/** Políticas públicas: sólo `access`, lo mínimo para menú/acciones. */
export interface ResourcePolicies {
  access: { read: string; write: string };
}
