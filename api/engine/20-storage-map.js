// engine/20-storage-map — Mapa recurso → almacenamiento (baseapi §3, §5).
//
// UNA sola pasada sobre el schema declara cómo se persiste cada campo:
//   - colección  → columnas de la hoja principal (grupos con prefijo: address_street)
//   - singleton  → filas KV con clave aplanada (mismo nombre, en la columna 'key')
//   - hijos      → hoja aparte: list / string-list / key-value (con fk y position)
// El resto del motor (21-repo, 22-assemble, 23-validate, 24-crud) sólo
// consume ESTE mapa: agregar un campo no requiere tocar código (§3, regla
// de oro). Top-level: sólo declaraciones (se resuelven en runtime).

// Memoización por recurso: el mapa es inmutable y depende sólo del schema.
var STORAGE_MAPS_ = {};

// Mapa de almacenamiento del recurso (cacheado por id).
function storageMap_(resource) {
  var cached = STORAGE_MAPS_[resource.id];
  if (cached !== undefined) return cached;

  var isKv = resource.kind === 'singleton';
  var map = {
    id: resource.id,
    kind: resource.kind,
    sheet: resource.sheet,
    keyField: resource.keyField,
    titleField: resource.titleField || null,
    ordering: resource.ordering || 'none',
    orderStep: resource.orderStep || CONFIG.ORDER_STEP,
    activeField: resource.activeField || null,
    kvColumns: isKv ? resource.kvColumns || ['key', 'value', 'type', 'note'] : null,
    positionColumn: null,
    columns: [],
    children: [],
  };

  resource.fields.forEach(function (field) {
    var meta = FIELD_TYPES[field.type] || {};
    if (meta.storage === 'column') {
      map.columns.push(columnEntry_(field, field.key, field.key, null, isKv));
    } else if (meta.storage === 'group') {
      // Colección → columnas con prefijo; singleton → filas KV con la misma
      // clave aplanada que usa el seed (setup/04 singletonKvRows_).
      field.fields.forEach(function (sub) {
        map.columns.push(
          columnEntry_(sub, field.key + '_' + sub.key, field.key + '.' + sub.key, field.key, isKv),
        );
      });
    } else if (meta.storage === 'child-sheet') {
      map.children.push(childEntry_(field));
    }
  });

  if (map.ordering === 'positioned') {
    map.columns.forEach(function (col) {
      if (col.key === 'position') map.positionColumn = col.flatKey;
    });
  }

  STORAGE_MAPS_[resource.id] = map;
  return map;
}

// Entrada de columna: dato escalar (o sub-campo de grupo) del recurso.
function columnEntry_(field, flatKey, path, group, isKv) {
  return {
    field: field,
    key: field.key, // clave del campo (subcampo dentro del grupo)
    flatKey: flatKey, // nombre en la hoja / clave KV (address_street)
    path: path, // ruta de validación/contrato (address.street)
    group: group, // clave del grupo o null
    system: !!field.system, // el backend es dueño (position, updated_at…)
    computed: field.computed || null, // 'now' ⇒ se calcula al escribir
    storage: isKv ? 'kv' : 'column',
  };
}

// Entrada de hoja hija: lo que 21/22/23 necesitan para leer, escribir y
// validar listas sin volver a mirar el schema crudo.
function childEntry_(field) {
  return {
    field: field,
    key: field.key, // clave en el contrato (images, specs, hours…)
    type: field.type, // list | string-list | key-value
    sheet: field.sheet,
    fk: field.fk || null, // columna del padre (null en singleton: es el dueño de TODO)
    positionField: field.positionField || null,
    valueColumn: field.valueColumn || null, // string-list (url)
    keyColumn: field.keyColumn || null, // key-value (spec_key)
    itemFields: field.itemFields || [],
    itemType: field.itemType || 'text',
    required: !!field.required,
    min: field.min,
    max: field.max,
  };
}

// Busca la definición de una hoja hija por su clave de contrato.
function childSpec_(map, key) {
  for (var i = 0; i < map.children.length; i++) {
    if (map.children[i].key === key) return map.children[i];
  }
  return null;
}
