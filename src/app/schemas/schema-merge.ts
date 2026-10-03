import type {
  FieldSchema,
  ListColumn,
  ListColumnFormat,
  OperationDescriptor,
  OperationShape,
  ResourceEndpoints,
  ResourceOperations,
  ResourcePolicies,
  ResourceSchema,
  ViewDescriptor,
} from '../core/models/schema.model';
import type { FieldValidators } from '../core/models/schema.model';

/**
 * Merge del schema remoto (`/admin/schema`, baseapi §12) sobre la capa de
 * presentación local (`src/app/schemas/*.schema.ts`).
 *
 * Reglas:
 * - **Local-driven por `key`**: sólo se fusionan campos que el schema local
 *   declara (la presentación decide QUÉ campos se dibujan; el backend decide
 *   sus restricciones). Campos del backend que el front no declara (p. ej.
 *   `position`, R3 de api.md) NO se agregan.
 * - **Presencia = autoridad, ausencia = conserva local**: si la proyección
 *   remota trae una clave estructural, su valor manda; si no viene, se queda
 *   lo local. Igual para los metadatos públicos de F7 (operations, views,
 *   policies): el `endpoint` local se sobrescribe operación a operación con
 *   las rutas efectivas que publica el backend.
 * - Nunca se tocan: `label*`, `listColumns`, `filters`, `search`, `layout`,
 *   `actions`, `permissions`, `positionField` (presentación local; sólo el
 *   backend publica `operations`/`views`/`policies`, F7-1).
 * - `extraColumns` de `string-list` y `listProjection` se ignoran: la UI local
 *   no los modela (decisión de presentación, no defecto).
 *
 * **F7-4 — `remoteToSchema`**: un recurso que existe SOLO en el backend (sin
 * schema local) se sintetiza completo (label derivado del id, listColumns
 * desde el `shape.pick`/`listProjection`, endpoint desde `operations`) — el
 * front lo dibuja con 0 cambios en `src/`.
 *
 * Defensivo: cualquier shape remoto inesperado cae al schema local sin
 * lanzar (el schema local SIEMPRE es el fallback, §12).
 */

/** Campo proyectado por `primitives/handlers/schema` (lista blanca de claves). */
export interface RemoteField {
  key?: unknown;
  type?: unknown;
  label?: unknown;
  required?: unknown;
  default?: unknown;
  pattern?: unknown;
  min?: unknown;
  max?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  minWords?: unknown;
  maxWords?: unknown;
  unique?: unknown;
  immutable?: unknown;
  from?: unknown;
  enum?: unknown;
  relation?: unknown;
  fields?: unknown;
  itemFields?: unknown;
  primaryFirst?: unknown;
  itemType?: unknown;
}

/** Recurso proyectado por `primitives/handlers/schema` (F7-1: + metadatos). */
export interface RemoteResource {
  id?: unknown;
  kind?: unknown;
  keyField?: unknown;
  titleField?: unknown;
  ordering?: unknown;
  listProjection?: unknown;
  operations?: unknown;
  views?: unknown;
  policies?: unknown;
  fields?: unknown;
}

/**
 * Valida la respuesta cruda de `/admin/schema` y devuelve sólo los recursos
 * con shape utilizable; `null` si no hay ninguno (→ fallback local puro).
 */
export function parseSchemaResponse(response: unknown): Record<string, RemoteResource> | null {
  if (!isRecord(response) || !isRecord(response['resources'])) {
    return null;
  }
  const resources: Record<string, RemoteResource> = {};
  for (const [id, entry] of Object.entries(response['resources'])) {
    if (isRecord(entry) && Array.isArray(entry['fields'])) {
      resources[id] = entry as RemoteResource;
    }
  }
  return Object.keys(resources).length > 0 ? resources : null;
}

/** Recurso local + proyección remota → schema fusionado (§12 «merge por key»). */
export function mergeResourceSchema(local: ResourceSchema, remote: RemoteResource): ResourceSchema {
  if (!Array.isArray(remote.fields)) {
    return local;
  }
  const out: Record<string, unknown> = { ...local };
  if (remote.kind === 'collection' || remote.kind === 'singleton') {
    out['kind'] = remote.kind;
  }
  if (typeof remote.keyField === 'string') {
    out['keyField'] = remote.keyField;
  }
  if (typeof remote.titleField === 'string') {
    out['titleField'] = remote.titleField;
  }
  // El orden lo declara el backend (§12): 'positioned' → reordenable.
  if (typeof remote.ordering === 'string') {
    out['sortable'] = remote.ordering === 'positioned';
  }
  // Metadatos públicos F7-1: presencia ⇒ manda el remoto; ausencia ⇒
  // conserva lo local (mismo contrato que el resto del merge).
  const operations = mergeOperations(remote.operations);
  if (operations !== null) {
    out['operations'] = operations.operations;
    out['endpoint'] = { ...local.endpoint, ...operations.endpoint };
  }
  const views = sanitizeViews(remote.views);
  if (views !== null) {
    out['views'] = views;
  }
  const policies = sanitizePolicies(remote.policies);
  if (policies !== null) {
    out['policies'] = policies;
  }
  out['fields'] = mergeFields(local.fields, remote.fields);
  // El objeto se arma por spreads de un `Record` conocido: el doble cast es
  // el mismo patrón centralizado de `pathAt` en `form-schema.ts`.
  return out as unknown as ResourceSchema;
}

/** Fusiona por `key`: cada campo local con su par remoto, si existe. */
function mergeFields(localFields: readonly FieldSchema[], remoteFields: unknown): FieldSchema[] {
  if (!Array.isArray(remoteFields) || remoteFields.length === 0) {
    return [...localFields];
  }
  const byKey = new Map<string, RemoteField>();
  for (const candidate of remoteFields) {
    if (isRecord(candidate) && typeof candidate['key'] === 'string') {
      byKey.set(candidate['key'], candidate as RemoteField);
    }
  }
  return localFields.map((local) => {
    const remote = byKey.get(local.key);
    return remote !== undefined ? mergeField(local, remote) : local;
  });
}

/**
 * Estructural sobre un campo: `type`/`required`/`default`/validadores del
 * backend + las claves propias de cada tipo (relation, enum, itemFields…).
 */
function mergeField(local: FieldSchema, remote: RemoteField): FieldSchema {
  const out: Record<string, unknown> = { ...local };

  if (typeof remote.type === 'string' && remote.type !== local.type) {
    out['type'] = remote.type;
  }
  if (typeof remote.required === 'boolean') {
    out['required'] = remote.required;
  }
  if (remote.default !== undefined) {
    out['default'] = remote.default;
  }

  // Validadores: `validators` tiene prioridad en buildFormSchema, así que el
  // backend se fusiona ahí y pisa lo local cuando la clave viene presente.
  // En listas, `min`/`max` significan número de ítems y viven en ListOptions.
  const isCountedList =
    local.type === 'list' || local.type === 'string-list' || local.type === 'key-value';
  const validators = mergeValidators(local.validators, remote, isCountedList);
  if (validators !== undefined) {
    out['validators'] = validators;
  }

  if (local.type === 'date') {
    // `date` valida con sus propios `min`/`max` ISO (form-schema §date).
    if (typeof remote.min === 'string') {
      out['min'] = remote.min;
    }
    if (typeof remote.max === 'string') {
      out['max'] = remote.max;
    }
  }

  if (local.type === 'relation' && isRecord(remote.relation)) {
    // La proyección trae `relation` aplanado (§12): mismo shape plano que
    // `RelationField` del front.
    const relation = remote.relation;
    if (typeof relation['resource'] === 'string') {
      out['resource'] = relation['resource'];
    }
    if (typeof relation['valueField'] === 'string') {
      out['valueField'] = relation['valueField'];
    }
    if (typeof relation['labelField'] === 'string') {
      out['labelField'] = relation['labelField'];
    }
    if (typeof relation['onlyActive'] === 'boolean') {
      out['onlyActive'] = relation['onlyActive'];
    }
  }

  if (local.type === 'select' || local.type === 'multiselect') {
    // Los labels son presentación (local gana); si el local no declara
    // opciones, se derivan del `enum` remoto.
    const hasLocalOptions = Array.isArray(local.options) && local.options.length > 0;
    if (!hasLocalOptions && Array.isArray(remote.enum)) {
      out['options'] = remote.enum.map((value) => ({ value: String(value), label: String(value) }));
    }
  }

  if (local.type === 'group') {
    out['fields'] = mergeFields(local.fields, remote.fields);
  } else if (local.type === 'list') {
    out['itemFields'] = mergeFields(local.itemFields, remote.itemFields);
    if (typeof remote.primaryFirst === 'boolean') {
      out['primaryFirst'] = remote.primaryFirst;
    }
  } else if (local.type === 'string-list') {
    if (remote.itemType === 'text' || remote.itemType === 'url' || remote.itemType === 'email') {
      out['itemType'] = remote.itemType;
    }
  }

  // `min`/`max` de las listas: mínimo/máximo de ítems (ListOptions).
  if (isCountedList) {
    if (typeof remote.min === 'number') {
      out['min'] = remote.min;
    }
    if (typeof remote.max === 'number') {
      out['max'] = remote.max;
    }
  }

  return out as unknown as FieldSchema;
}

/** Escalares de validación del backend → `FieldValidators` (prioridad). */
function mergeValidators(
  local: FieldValidators | undefined,
  remote: RemoteField,
  isCountedList: boolean,
): FieldValidators | undefined {
  const merged: FieldValidators = { ...local };
  let changed = false;

  if (typeof remote.pattern === 'string' && remote.pattern !== local?.pattern) {
    merged.pattern = remote.pattern;
    changed = true;
  }
  if (typeof remote.minLength === 'number' && remote.minLength !== local?.minLength) {
    merged.minLength = remote.minLength;
    changed = true;
  }
  if (typeof remote.maxLength === 'number' && remote.maxLength !== local?.maxLength) {
    merged.maxLength = remote.maxLength;
    changed = true;
  }
  if (typeof remote.minWords === 'number' && remote.minWords !== local?.minWords) {
    merged.minWords = remote.minWords;
    changed = true;
  }
  if (typeof remote.maxWords === 'number' && remote.maxWords !== local?.maxWords) {
    merged.maxWords = remote.maxWords;
    changed = true;
  }
  if (typeof remote.unique === 'boolean' && remote.unique !== local?.unique) {
    merged.unique = remote.unique;
    changed = true;
  }
  if (!isCountedList) {
    if (typeof remote.min === 'number' && remote.min !== local?.min) {
      merged.min = remote.min;
      changed = true;
    }
    if (typeof remote.max === 'number' && remote.max !== local?.max) {
      merged.max = remote.max;
      changed = true;
    }
  }

  return changed ? merged : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

// ─────────────────────────────────────────────────────────────
// F7-1: sanitizado de los metadatos públicos del backend
// ─────────────────────────────────────────────────────────────

/**
 * `operations` publicado → operaciones tipadas + rutas efectivas. Entradas
 * malformadas se descartan (sin método/path usables no hay operación).
 */
function mergeOperations(
  value: unknown,
): { operations: ResourceOperations; endpoint: ResourceEndpoints } | null {
  if (!isRecord(value)) {
    return null;
  }
  const operations: ResourceOperations = {};
  const endpoint: ResourceEndpoints = {};
  for (const name of ['list', 'get', 'create', 'update', 'remove'] as const) {
    const entry = value[name];
    if (!isRecord(entry)) {
      continue;
    }
    const method = entry['method'];
    const path = entry['path'];
    if (!isString(method) || !isString(path) || path === '') {
      continue;
    }
    const descriptor: OperationDescriptor = {
      method: method as OperationDescriptor['method'],
      path,
    };
    const shape = sanitizeShape(entry['shape']);
    if (shape !== undefined) {
      descriptor.shape = shape;
    }
    operations[name] = descriptor;
    endpoint[name] = path;
  }
  return Object.keys(operations).length > 0 ? { operations, endpoint } : null;
}

/** `shape` publicado: sólo claves conocidas y con tipos usables. */
function sanitizeShape(value: unknown): OperationShape | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const out: OperationShape = {};
  const pick = value['pick'];
  if (Array.isArray(pick)) {
    out.pick = pick.filter(isString);
  } else if (pick === 'full' || pick === 'list') {
    out.pick = pick;
  }
  const include = value['include'];
  if (Array.isArray(include)) {
    out.include = include.filter(isString);
  }
  const rename = value['rename'];
  if (isRecord(rename)) {
    const entries = Object.entries(rename).filter((pair): pair is [string, string] =>
      isString(pair[1]),
    );
    if (entries.length > 0) {
      out.rename = Object.fromEntries(entries);
    }
  }
  const nest = value['nest'];
  if (isRecord(nest)) {
    const entries = Object.entries(nest).filter(
      (pair) => Array.isArray(pair[1]) && pair[1].every(isString),
    );
    if (entries.length > 0) {
      out.nest = Object.fromEntries(entries) as Record<string, string[]>;
    }
  }
  const envelope = value['envelope'];
  if (envelope === 'plain' || envelope === 'list') {
    out.envelope = envelope;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `views` publicado: sólo objetos (lo que no lo es, se descarta). */
function sanitizeViews(value: unknown): Record<string, ViewDescriptor> | null {
  if (!isRecord(value)) {
    return null;
  }
  const out: Record<string, ViewDescriptor> = {};
  for (const [name, view] of Object.entries(value)) {
    if (isRecord(view)) {
      out[name] = view as unknown as ViewDescriptor;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** `policies` publicado: sólo `access` con los dos niveles como string. */
function sanitizePolicies(value: unknown): ResourcePolicies | null {
  if (!isRecord(value)) {
    return null;
  }
  const access = value['access'];
  if (!isRecord(access) || !isString(access['read']) || !isString(access['write'])) {
    return null;
  }
  return { access: { read: access['read'], write: access['write'] } };
}

// ─────────────────────────────────────────────────────────────
// F7-4: recurso que existe SOLO en el backend → ResourceSchema
// ─────────────────────────────────────────────────────────────

/** Formato de columna por tipo de campo (derivación de presentación). */
const FORMAT_BY_TYPE: Record<string, ListColumnFormat> = {
  boolean: 'boolean',
  currency: 'currency',
  date: 'date',
  image: 'thumbnail',
};

/**
 * Sintetiza un ResourceSchema usando SOLO la proyección remota: es lo que
 * hace que un recurso nuevo del backend se vea en el front (menú, listado
 * y formulario) con **0 cambios en `src/`** (F7-4).
 *
 * Derivaciones de presentación (el backend no publica labels ni layout):
 * - `label`/`labelPlural`: humanizado del id (`_prueba` ⇒ Prueba/Pruebas).
 * - `listColumns`: claves de `operations.list.shape.pick` → `listProjection`
 *   → `fields`; formato por tipo (boolean/currency/date/image).
 * - `endpoint`: rutas efectivas de `operations`.
 * - `positionField: 'position'` cuando `ordering === 'positioned'`
 *   (convención de la columna de orden; sólo afecta a recursos nuevos).
 * - `layout` no se sintetiza: FormView dibuja los campos sin secciones.
 *
 * Devuelve `undefined` si falta lo mínimo (id + algún campo).
 */
export function remoteToSchema(remote: RemoteResource): ResourceSchema | undefined {
  if (typeof remote.id !== 'string' || remote.id === '' || !Array.isArray(remote.fields)) {
    return undefined;
  }
  const fields = remote.fields
    .filter(isRecord)
    .filter((field) => typeof field['key'] === 'string' && typeof field['type'] === 'string')
    .map((field) => ({
      ...field,
      label: isString(field['label']) ? field['label'] : humanizeKey(String(field['key'])),
    }))
    .map((field) => field as unknown as FieldSchema);
  if (fields.length === 0) {
    return undefined;
  }

  const operations = mergeOperations(remote.operations);
  const label = humanizeKey(remote.id);
  const schema: ResourceSchema = {
    id: remote.id,
    label,
    labelPlural: label.endsWith('s') ? label : `${label}s`,
    kind: remote.kind === 'singleton' ? 'singleton' : 'collection',
    endpoint: operations !== null ? operations.endpoint : {},
    keyField:
      typeof remote.keyField === 'string' && remote.keyField !== '' ? remote.keyField : 'id',
    titleField:
      typeof remote.titleField === 'string' && remote.titleField !== ''
        ? remote.titleField
        : fields[0].key,
    listColumns: synthesizeListColumns(remote, fields),
    fields,
  };
  if (operations !== null) {
    schema.operations = operations.operations;
  }
  if (remote.ordering === 'positioned') {
    schema.sortable = true;
    schema.positionField = 'position';
  }
  const views = sanitizeViews(remote.views);
  if (views !== null) {
    schema.views = views;
  }
  const policies = sanitizePolicies(remote.policies);
  if (policies !== null) {
    schema.policies = policies;
  }
  return schema;
}

/** Columnas del listado: shape.pick del listado → listProjection → fields. */
function synthesizeListColumns(remote: RemoteResource, fields: FieldSchema[]): ListColumn[] {
  const typeByKey = new Map(fields.map((field) => [field.key, field.type]));
  return listPickKeys(remote, fields).map((key) => {
    const column: ListColumn = { key, label: humanizeKey(key) };
    const format = FORMAT_BY_TYPE[typeByKey.get(key) ?? ''];
    if (format !== undefined) {
      column.format = format;
    }
    return column;
  });
}

function listPickKeys(remote: RemoteResource, fields: FieldSchema[]): string[] {
  const picked = pickListShape(remote.operations);
  if (picked !== null) {
    return picked;
  }
  if (Array.isArray(remote.listProjection)) {
    const keys = remote.listProjection.filter(isString);
    if (keys.length > 0) {
      return keys;
    }
  }
  return fields.map((field) => field.key);
}

function pickListShape(operations: unknown): string[] | null {
  if (!isRecord(operations) || !isRecord(operations['list'])) {
    return null;
  }
  const shape = operations['list']['shape'];
  if (!isRecord(shape) || !Array.isArray(shape['pick'])) {
    return null; // 'full'/'list' no son una lista de claves concretas
  }
  const keys = shape['pick'].filter(isString);
  return keys.length > 0 ? keys : null;
}

/** `category_slug` ⇒ `Category slug` (presentación derivada, F7-4). */
function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s-]+/)
    .filter((word) => word !== '');
  if (words.length === 0) {
    return key;
  }
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
