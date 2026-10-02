# Admin dinámico en Angular — UI generada desde un schema

> Especificación conceptual (sin código) para que un agente construya el admin.
> Idea central: **se define un objeto (schema) por recurso y el admin renderiza
> listado + formulario completo a partir de él.** Agregar una entidad nueva =
> agregar un schema, no escribir componentes.

---

## 1. Principios

1. **Schema = única fuente de verdad** de la UI: campos, tipos, validaciones, orden, visibilidad.
2. **Componentes tontos por tipo:** cada tipo de campo tiene un componente que solo conoce su tipo, no la entidad.
3. **Un renderizador recursivo:** un campo puede contener otros campos (grupo, lista), así que el mismo despachador se llama a sí mismo.
4. **El valor siempre es JSON plano** que coincide con el contrato de la API (sin transformaciones ocultas).
5. **El backend manda:** el front valida por UX, pero los errores del backend (422, etc.) se pintan en el campo correcto.
6. **Posiciones invisibles:** el usuario reordena arrastrando; nunca ve ni edita el número de `position`.

---

## 2. Piezas de la arquitectura

| Pieza                        | Responsabilidad                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Schema registry**          | Catálogo de schemas de recursos (`categories`, `products`, `site`, `legal`…). Alimenta rutas y menú lateral |
| **Resource page**            | Página genérica: lee el schema y decide si muestra listado, formulario o ambos                              |
| **List view (tabla)**        | Muestra los registros con las columnas del schema; búsqueda, filtros, reordenar, acciones                   |
| **Form view**                | Construye el formulario recorriendo `fields` del schema                                                     |
| **Field host (despachador)** | Recibe un campo del schema y elige el componente según `type`. Es recursivo                                 |
| **Field components**         | Uno por tipo (texto, imagen, lista, etc.)                                                                   |
| **Servicios**                | API genérica (CRUD por endpoint del schema), subida de archivos, mapeo de errores, notificaciones           |
| **Estado del formulario**    | Valor actual, valor original, _dirty_, errores por ruta de campo, _saving_                                  |

Stack recomendado: Angular moderno (standalone components, signals, reactive forms,
`@if`/`@for`), con una librería de UI y drag & drop (CDK). Los tipos de schema
se tipan con interfaces/uniones discriminadas por `type`.

---

## 3. Schema de recurso

Cada recurso se describe con estas propiedades:

| Propiedad               | Descripción                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `id`                    | Identificador interno (`products`)                                                           |
| `label` / `labelPlural` | Nombres para menú y títulos                                                                  |
| `kind`                  | `collection` (muchos registros) o `singleton` (un solo registro, ej. site, legal)            |
| `endpoint`              | Rutas de la API: listar, leer, crear, actualizar, borrar. Los singleton solo leer/actualizar |
| `keyField`              | Campo que identifica el registro (`slug`)                                                    |
| `titleField`            | Campo que se muestra como nombre del registro                                                |
| `sortable`              | Si el listado se puede reordenar (usa `positionField`)                                       |
| `positionField`         | Nombre del campo de orden (`position`)                                                       |
| `listColumns`           | Qué campos son columnas del listado, con formato (texto, badge, imagen miniatura, booleano)  |
| `filters` / `search`    | Campos filtrables y buscables en el listado                                                  |
| `fields`                | Árbol de campos del formulario (ver §4)                                                      |
| `layout`                | Cómo se agrupan los campos: secciones, pestañas, columnas                                    |
| `actions`               | Acciones extra (duplicar, activar/desactivar, ver en sitio)                                  |
| `permissions`           | Qué operaciones están permitidas (crear, borrar, reordenar)                                  |

---

## 4. Schema de campo — propiedades comunes

Todo campo, sea del tipo que sea, acepta:

| Propiedad      | Descripción                                                                   |
| -------------- | ----------------------------------------------------------------------------- |
| `key`          | Nombre de la propiedad en el JSON                                             |
| `type`         | Tipo de campo (catálogo §5)                                                   |
| `label`        | Etiqueta visible                                                              |
| `help`         | Texto de ayuda bajo el campo                                                  |
| `placeholder`  | Texto de ejemplo                                                              |
| `required`     | Obligatorio                                                                   |
| `default`      | Valor inicial al crear                                                        |
| `readonly`     | Solo lectura (ej. `slug` tras publicar)                                       |
| `readonlyWhen` | Condición que lo vuelve solo lectura (ej. “registro ya existe”)               |
| `visibleWhen`  | Condición de visibilidad según otros campos                                   |
| `validators`   | Reglas: longitud mín/máx, patrón, mín/máx numérico, conteo de palabras, único |
| `width`        | Ancho dentro de la fila del layout (1–12 columnas)                            |
| `section`      | Sección o pestaña a la que pertenece                                          |

Las condiciones (`visibleWhen`, `readonlyWhen`) se expresan como comparaciones
simples sobre otros campos del mismo nivel o del registro raíz
(igual, distinto, está vacío, contiene).

---

## 5. Catálogo de tipos de campo

### 5.1 Simples (valor escalar)

| `type`          | Valor en JSON  | Componente / comportamiento                                                  | Opciones propias                         |
| --------------- | -------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| `text`          | string         | Input de una línea                                                           | `maxLength`, `pattern`                   |
| `textarea`      | string         | Área multilínea con contador de caracteres/palabras                          | `rows`, `maxWords`, `minWords`           |
| `slug`          | string         | Input que se autogenera desde otro campo (`from`) y se bloquea tras publicar | `from`, `lockAfterCreate`                |
| `number`        | number         | Input numérico                                                               | `min`, `max`, `step`, `decimals`         |
| `currency`      | number         | Número con prefijo de moneda; el valor sigue siendo número puro              | `currencyFrom` (de dónde sale la moneda) |
| `boolean`       | boolean        | Interruptor (switch)                                                         | `trueLabel`, `falseLabel`                |
| `select`        | string         | Desplegable de un solo valor                                                 | `options` (fijas)                        |
| `multiselect`   | string[]       | Selección múltiple con chips                                                 | `options`                                |
| `url`           | string         | Input con validación de URL y botón “abrir”                                  | —                                        |
| `email`         | string         | Input con validación de correo                                               | —                                        |
| `phone`         | string         | Input telefónico; guarda siempre el formato esperado (E.164 o solo dígitos)  | `format`                                 |
| `date`          | string ISO     | Selector de fecha                                                            | `min`, `max`                             |
| `time`          | string `HH:mm` | Selector de hora                                                             | —                                        |
| `readonly-text` | string         | Muestra un dato calculado o de solo lectura (ej. `updated_at`)               | `format`                                 |

### 5.2 Referencias

| `type`     | Valor                         | Componente                                                                                          | Opciones                                             |
| ---------- | ----------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `relation` | string (slug de otro recurso) | Desplegable con búsqueda cuyas opciones se cargan desde otro recurso (ej. categoría de un producto) | `resource`, `valueField`, `labelField`, `onlyActive` |

### 5.3 Imagen

| `type`  | Valor                                     | Componente |
| ------- | ----------------------------------------- | ---------- |
| `image` | string — **la URL pública** (`image_url`) | Ver §7     |

El texto alternativo **no** va dentro del campo imagen: es un campo `text`
hermano (`image_alt`). Cuando conviene agruparlos, se usa un `group` o un
item de lista (§6).

### 5.4 Compuestos (contienen otros campos)

| `type`        | Valor                        | Descripción                                                                                                                   |
| ------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `group`       | objeto                       | Agrupa campos relacionados bajo un nombre (ej. `address`, `geo`). Puede mostrarse como tarjeta, sección colapsable o en línea |
| `list`        | arreglo de objetos           | Colección ordenable de items; cada item es un objeto con sus propios campos (§6)                                              |
| `string-list` | string[]                     | Lista simple de textos o URLs (ej. redes sociales), ordenable                                                                 |
| `key-value`   | arreglo de pares clave/valor | Tabla editable de pares (ej. ficha técnica); ordenable                                                                        |

---

## 6. Listas (`list`, `string-list`, `key-value`)

Son el tipo más importante porque cubren imágenes de producto, FAQ, specs,
horarios y redes.

### Definición

| Propiedad       | Descripción                                                                                |
| --------------- | ------------------------------------------------------------------------------------------ |
| `itemFields`    | Campos de cada item (cualquier tipo, incluso otro `group` o `list`)                        |
| `itemTitle`     | Qué campo usar como título del item cuando está colapsado                                  |
| `min` / `max`   | Cantidad mínima y máxima de items (ej. imágenes: mín 1)                                    |
| `sortable`      | Si se puede reordenar (por defecto sí)                                                     |
| `positionField` | Campo donde se guarda el orden dentro de cada item (`position`)                            |
| `addLabel`      | Texto del botón de agregar                                                                 |
| `itemDisplay`   | `card`, `row` (compacto) o `accordion`                                                     |
| `emptyText`     | Mensaje cuando no hay items                                                                |
| `primaryFirst`  | Si el primer item tiene significado especial (ej. imagen principal) y se marca visualmente |

### Comportamiento de la UI

- Cada item muestra: **asa de arrastre**, sus campos, y botón **eliminar** (con confirmación si tiene contenido).
- Botón **agregar** al final; crea un item con los `default` de sus campos.
- **Reordenar** por arrastre. Opcional: botones subir/bajar para accesibilidad y móvil.
- Se respeta `min`: si se llegó al mínimo, eliminar queda deshabilitado.
- Se respeta `max`: al alcanzarlo, agregar queda deshabilitado.
- Los errores se muestran en el item y campo exactos (ruta, ej. `faq[2].answer`).
- Un item nuevo aún no guardado no tiene identificador; el orden se guarda igual en `position`.

### Items con combinaciones típicas

| Caso                 | Composición del item                                   |
| -------------------- | ------------------------------------------------------ |
| Imágenes de producto | `image` + `text` (alt)                                 |
| FAQ                  | `text` (pregunta) + `textarea` (respuesta)             |
| Ficha técnica        | `text` (clave) + `text` (valor)                        |
| Horarios             | `multiselect` (días) + `time` (abre) + `time` (cierra) |
| Redes sociales       | `url` (+ `text` opcional de red)                       |

---

## 7. Componente `image`

El valor es **solo la URL**. El componente gestiona todo lo demás.

**Estados**

1. **Vacío:** zona punteada con botón “Subir imagen” (y arrastrar-soltar).
2. **Con imagen:** vista previa de la imagen actual + botones **Reemplazar** y **Quitar** (este último solo si el campo no es obligatorio) + opción de ver en grande.
3. **Subiendo:** barra de progreso/spinner; el valor actual no cambia hasta que la subida termine.
4. **Error:** mensaje claro (formato no permitido, tamaño excedido, fallo de red) y se conserva la imagen anterior.

**Flujo de subida**

1. El usuario elige un archivo (se valida tipo y tamaño en el cliente según `accept` y `maxSizeMB`).
2. El servicio de subida lo envía al endpoint de upload.
3. El backend responde con la URL pública.
4. El campo guarda esa URL como su nuevo valor y marca el formulario como modificado.

**Opciones:** `accept` (tipos permitidos), `maxSizeMB`, `aspectRatio` (para la vista previa), `previewSize`.
**Si se reemplaza:** la imagen anterior no se borra del servidor desde el front; solo cambia la URL.

---

## 8. Ordenamiento con huecos

Aplica a: **(a)** el listado de un recurso reordenable (ej. categorías) y
**(b)** los items de una lista dentro de un formulario.

> Nota de coherencia: el documento del backend define posiciones densas 1..N.
> Con este método el backend pasa a **guardar enteros espaciados** y solo
> renumera en casos excepcionales. Hay que ajustar R3 y las reglas de
> `position` del backend en consecuencia.

### Reglas

- Las posiciones son enteros con **separación fija** (paso de 1000: 1000, 2000, 3000…).
- Al mover un elemento entre dos vecinos, su nueva posición es el **punto medio** entre las posiciones de esos vecinos. Solo se modifica ese elemento.
- Mover al **inicio**: posición = la mitad de la posición del primero.
- Mover al **final**: posición = la del último + el paso.
- Lista vacía o primer elemento: posición = el paso.
- Si los vecinos quedan **sin espacio** (diferencia menor a 2), se hace un **rebalanceo**: se renumera toda la lista con el paso original conservando el orden, y luego se aplica el movimiento.
- Nuevos elementos se agregan al final (última posición + paso).

### Dónde se calcula

| Contexto                                               | Quién calcula                                    | Cómo se guarda                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Listas dentro de un formulario (imágenes, FAQ, specs…) | El front, localmente                             | Viaja con el registro padre al guardar                                                          |
| Listado de un recurso (categorías)                     | El front calcula la posición del elemento movido | Se envía un único cambio (clave + nueva posición); si hay rebalanceo, se envía el lote completo |

- El usuario **nunca ve** los números.
- La UI ordena siempre por `position` ascendente.
- Tras un movimiento en el listado, se actualiza de forma optimista y se revierte con aviso si la API falla.

---

## 9. Combinaciones soportadas y reglas de anidamiento

| Contenedor        | Puede contener                                                               |
| ----------------- | ---------------------------------------------------------------------------- |
| Formulario (raíz) | Cualquier tipo                                                               |
| `group`           | Cualquier tipo, incluido otro `group` o `list`                               |
| `list` (item)     | Cualquier tipo, incluido `group` y otra `list` (máx. 2 niveles recomendados) |
| `string-list`     | Solo texto, url o email                                                      |
| `key-value`       | Dos campos de texto (clave, valor)                                           |

Combinaciones frecuentes a validar en el motor: lista de imágenes con alt,
lista de grupos, grupo dentro de lista, campo condicional dentro de un grupo,
`relation` dentro de un item de lista, singleton con listas y grupos
(site con horarios y redes).

---

## 10. Comportamiento del formulario

| Aspecto             | Regla                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Carga               | Recurso colección: lista → clic → carga el registro. Singleton: carga directa                                                                           |
| Creación            | Mismo formulario con valores por defecto; la clave (`slug`) se puede generar desde `name`                                                               |
| Modificado          | Indicador _dirty_; aviso al salir con cambios sin guardar                                                                                               |
| Validación          | Campo a campo al perder foco + completa al guardar. Se bloquea guardar si hay errores                                                                   |
| Errores del backend | El backend devuelve el mensaje y, cuando aplica, la ruta del campo; el front lo pinta en el campo exacto. Si no hay ruta, se muestra como error general |
| Guardado            | Botón con estado _guardando_; al terminar, se recarga el valor y se muestra confirmación                                                                |
| Borrado             | Confirmación; si el backend lo rechaza (ej. categoría con productos), se muestra el motivo                                                              |
| Solo lectura        | Campos `readonly` visibles pero no editables; `slug` queda bloqueado en registros existentes                                                            |
| Campos ocultos      | Los campos con `visibleWhen` falso no se muestran y no se envían                                                                                        |

### Listado

- Columnas definidas por el schema, con formatos: texto, imagen miniatura, booleano como badge, número, moneda, fecha.
- Búsqueda y filtros según el schema.
- Interruptor rápido de `active` directamente en la fila (si el schema lo declara).
- Modo reordenar (arrastrar) activo solo si `sortable` y sin filtros aplicados.

### Estados universales

Cargando (skeleton), vacío, error de red con reintento, sin permisos.

---

## 11. Ejemplos de schema (descritos, no codificados)

### Recurso `categories` — colección, reordenable

- Clave: `slug` (slug, generado desde `name`, bloqueado tras crear)
- Campos: `name` (text, req) · `seo_title` (text, req) · `seo_description` (textarea, req) · `intro` (textarea, req, ~150 palabras) · `image_url` (image, req) · `image_alt` (text) · `active` (boolean, default sí)
- Listado: miniatura, nombre, activo (switch). Reordenable por arrastre

### Recurso `products` — colección

- **Pestaña General:** `name`, `slug`, `category_slug` (relation → categories activas), `brand`, `sku`, `price` (currency), `availability` (select), `featured` (boolean), `active` (boolean)
- **Pestaña Contenido:** `description` (textarea, 150–300 palabras), `seo_title`, `seo_description`
- **Pestaña Imágenes:** `images` (list, mín 1, `primaryFirst`): item = `image_url` (image) + `image_alt` (text, req)
- **Pestaña Sanitario:** `registro_sanitario` (text, con aviso “sin esto el producto no se publica”), `clase_riesgo` (select), `titular_registro` (text)
- **Pestaña Ficha técnica:** `specs` (key-value, ordenable)
- **Pestaña FAQ:** `faq` (list): item = `question` (text) + `answer` (textarea)
- Listado: miniatura principal, nombre, categoría, precio, disponibilidad, estado sanitario (badge), activo

### Recurso `site` — singleton

- **Negocio:** `name`, `url`, `description`, `currency`
- **Contacto:** `phone` (phone E.164), `whatsapp` (phone solo dígitos), `email`
- **Dirección:** grupo `address` (street, city, region, postal_code, country) y grupo `geo` (lat, lng)
- **Horarios:** `hours` (list): item = `days` (multiselect) + `opens` (time) + `closes` (time)
- **Redes:** `social` (string-list de urls)

### Recurso `legal` — singleton

- Campos de texto/email/phone, `ruc` (text con patrón de 11 dígitos), `reclamos_response_days` (number), `prices_include_igv` (boolean), `last_updated` (solo lectura)

---

## 12. Estructura sugerida del proyecto (solo nombres)

- `admin/core/` — modelos de schema (tipos), servicio API genérico, servicio de upload, mapeo de errores, notificaciones
- `admin/schemas/` — un schema por recurso + registro central
- `admin/shell/` — layout, menú lateral generado desde el registro, rutas dinámicas
- `admin/pages/` — resource page, list view, form view
- `admin/fields/` — field host + un componente por tipo (`text`, `textarea`, `slug`, `number`, `currency`, `boolean`, `select`, `multiselect`, `url`, `email`, `phone`, `date`, `time`, `relation`, `image`, `group`, `list`, `string-list`, `key-value`, `readonly-text`)
- `admin/shared/` — utilidades: ordenamiento con huecos, evaluador de condiciones, validadores

---

## 13. Criterios de aceptación

1. Agregar un recurso nuevo solo requiere crear su schema y registrarlo; aparece en el menú, con listado y formulario funcionales.
2. Cada tipo del catálogo (§5) se renderiza, valida y guarda correctamente.
3. Una `list` dentro de un `group` dentro de otra `list` funciona (anidamiento hasta 2 niveles).
4. El componente `image` muestra la imagen actual, permite reemplazar y refleja la nueva URL sin recargar.
5. Reordenar (listado y listas internas) usa posiciones con huecos y rebalancea solo cuando no hay espacio.
6. `visibleWhen`, `readonlyWhen`, `required`, `min`/`max` y validadores se respetan en cualquier nivel.
7. Los errores del backend aparecen en el campo exacto, incluso dentro de items de lista.
8. El valor enviado a la API coincide con el contrato JSON (nombres normalizados, `image_url`, posiciones).
9. Se avisa al salir con cambios sin guardar y se bloquea doble guardado.
10. Funciona en móvil (arrastre táctil o botones subir/bajar).
