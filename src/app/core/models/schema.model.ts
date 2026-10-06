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
  /** Ciclo de vida: bloquea el campo solo en creación, solo en edición o siempre. */
  readonlyOn?: 'create' | 'update' | 'always';
  readonlyWhen?: FieldCondition;
  visibleWhen?: FieldCondition;
  /**
   * Ciclo de vida de la VISIBILIDAD: oculta el campo en creación, en edición
   * o siempre. Símétrico a `readonlyOn`, pero NO lo mismo que `visibleWhen`,
   * que expresa una condición sobre el valor de otro campo.
   *
   * Vale para los campos que LLENA EL BACK (`ref`, `pin`): en alta no existen
   * aún, así que mostrarlos vacíos y solo-lectura con un `help` que dice "se
   * genera solo al guardar" es ruido ocupando la sección. `hidden()` de Signal
   * Forms además los deja FUERA de la validación y del payload
   * (field-host:311 no los dibuja, form-model:52 los salta).
   */
  hiddenOn?: 'create' | 'update' | 'always';
  /**
   * Selección dependiente (guía §1: país → ciudad). Clave del campo padre
   * del MISMO nivel: mientras el padre esté vacío este campo queda
   * `disabled`, y si el padre cambia el hijo se reinicia a su valor por
   * defecto (plan 6.6).
   */
  dependsOn?: string;
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
  /**
   * Segundo dato a mostrar junto a la etiqueta (guía §1: «Juan Pérez ·
   * DNI 123»). Se concatena con « · » y forma parte de la opción, así que
   * también se busca sobre él.
   */
  secondaryField?: string;
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
// §5.6 Widgets de panel (sólo `kind: 'dashboard'` — motor-plan T5/T7)
// ─────────────────────────────────────────────────────────────

/**
 * Base de un widget de panel. Se declara en `ResourceSchema.widgets` — no
 * en `fields`, porque un KPI no es un campo: no se valida, no se envía y
 * `field-host` no lo renderiza. Sólo un recurso `kind: 'dashboard'` los
 * dibuja, y agregar un widget es tocar el schema, no el template.
 *
 * Su `key` es además la clave del dato en la respuesta del endpoint del
 * dashboard (`{ key: 'pendientes' }` ↔ `{ pendientes: 3 }`), salvo que el
 * widget declare `source: 'payload'` (abajo).
 */
export interface WidgetBase {
  key: string;
  label: string;
  help?: string;
  /** Ancho en la grilla del panel (1–12), igual que un campo. */
  width?: GridWidth;
  /**
   * De dónde saca sus datos respecto de la respuesta del endpoint.
   *
   * - `'key'` (por defecto): `data[widget.key]`. Es el contrato normal.
   * - `'payload'`: la respuesta COMPLETA. Para widgets que se componen a
   *   partir de varias claves (p. ej. `status-progress` leyendo
   *   `pendientes` + `entregados` + `cancelados`) sin que el orquestador
   *   tenga que saber qué tipo de widget es.
   */
  source?: 'key' | 'payload';
}

/** KPI de una cifra suelta («3 pendientes»). */
export interface MetricCardWidget extends WidgetBase {
  type: 'metric-card';
  /** Texto secundario bajo la cifra (estático, va en el schema). */
  hint?: string;
}

/** Barras por categoría con CSS/SVG — sin librería. */
export interface BarChartWidget extends WidgetBase {
  type: 'bar-chart';
  /** Sufijo de las cifras del eje («unidades», «S/»). */
  unit?: string;
}

/**
 * Serie temporal con Chart.js **detrás de `@defer (on viewport)`**.
 *
 * La librería (61,4 K gz medidos) vive en el chunk diferido que Angular
 * genera para `<app-chart-line>` dentro del `@defer` de `widget-host`, así
 * que **no entra en el bundle inicial** — mientras `chart-line` sólo se
 * referencie dentro de ese bloque y nunca por un barrel (angular.dev
 * «Deferred loading with @defer»: standalone + referencia exclusiva dentro
 * del bloque + import directo de fichero).
 */
export interface ChartLineWidget extends WidgetBase {
  type: 'chart-line';
  /** Sufijo de las cifras del eje («unidades», «S/»). */
  unit?: string;
}

/** Tabla embebida de registros operativos (ej. pedidos que requieren atención). */
export interface RecordListWidget extends WidgetBase {
  type: 'record-list';
  /** Recurso al que pertenecen los registros (ej. `orders`). */
  resource: string;
  /** Claves de columnas a mostrar en la tabla compacta. */
  columns: string[];
  /** Acción de navegación por fila. */
  action?: {
    label: string;
    routeTemplate: string;
  };
}

/** Grid de botones de accesos directos operativos. */
export interface QuickActionsWidget extends WidgetBase {
  type: 'quick-actions';
  actions: {
    label: string;
    icon?: string;
    navigateTo: string;
    variant?: 'primary' | 'secondary' | 'outline';
  }[];
}

/** Barra de distribución porcentual de estados o categorías. */
export interface StatusProgressWidget extends WidgetBase {
  type: 'status-progress';
  segments: {
    key: string;
    label: string;
    color: 'success' | 'warning' | 'danger' | 'neutral';
  }[];
}

export type WidgetSchema =
  | MetricCardWidget
  | BarChartWidget
  | ChartLineWidget
  | RecordListWidget
  | QuickActionsWidget
  | StatusProgressWidget;

export type WidgetType = WidgetSchema['type'];

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

export interface ResourceActionBase {
  id: string;
  label: string;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  visibleWhen?: { field: string; op: 'eq' | 'neq' | 'in'; value: unknown }[];
}

export interface CopyShareAction extends ResourceActionBase {
  type: 'copy-share';
  urlTemplate: string;
  shareTextTemplate?: string;
}

export interface NavigateAction extends ResourceActionBase {
  type?: 'navigate';
  /** Plantilla con marcadores, ej. `/products/{slug}` o `/admin/orders?id={ref}`. */
  urlTemplate: string;
}

export interface TriggerAction extends ResourceActionBase {
  type: 'trigger-endpoint';
  endpoint: string;
  method?: 'POST' | 'PUT';
  confirmMessage?: string;
}

/** Acciones extra de registro o listado (duplicar, compartir, navegar…). */
export type ResourceAction = CopyShareAction | NavigateAction | TriggerAction;

/** Configuración de diálogo/modal o acción tras crear un registro con éxito. */
export interface PostCreateSchema {
  mode: 'modal' | 'toast' | 'redirect_detail' | 'stay';
  title?: string;
  description?: string;
  summaryFields?: string[];
  actions?: ResourceAction[];
}

/** Configuración de Ficha de Detalle (modo lectura estructurado). */
export interface DetailViewSchema {
  enabled: boolean;
  headerFields?: string[];
  sections?: {
    id: string;
    label: string;
    fields: string[];
  }[];
  actions?: ResourceAction[];
  allowEdit?: boolean;
  allowDelete?: boolean;
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
  /**
   * `collection` → listado, `singleton` → formulario directo,
   * `dashboard` → panel de sólo lectura (motor-plan T4; sus datos llegan de
   * un endpoint declarativo, no de CRUD).
   */
  kind: 'collection' | 'singleton' | 'dashboard';
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
  /**
   * Widgets del panel — sólo `kind: 'dashboard'` (motor-plan T5).
   *
   * Van aparte de `fields`: un KPI no es un campo y no comparte `FieldBase`
   * (`required`/`visibleWhen`/`validators`…). Decisión tomada tras medir el
   * ripple de unirlos a `FieldSchema`: 18+ errores de tipos en 4 ficheros.
   * `contract-check` sólo recorre `fields`, así que esta propiedad no se
   * compara back↔front — el widget es config de UI, no dato almacenado.
   */
  widgets?: WidgetSchema[];
  layout?: ResourceLayout;
  actions?: ResourceAction[];
  /** Configuración de Ficha de Detalle estructurada para el recurso. */
  detail?: DetailViewSchema;
  /** Configuración de diálogo/modal post-creación. */
  postCreate?: PostCreateSchema;
  permissions?: ResourcePermissions;
  /**
   * Claves de `fields` que el listado edita en un drawer sin navegar
   * (plan 6.5, guía §5: «edición rápida de pocos campos, panel lateral en
   * lugar de pantalla nueva»). 1–3 campos; si no se declara, no hay atajo.
   */
  quickEdit?: string[];

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
