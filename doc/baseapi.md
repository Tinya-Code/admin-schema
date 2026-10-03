# Backend dinámico guiado por schema (Apps Script + Sheets + Cloudinary)

> Versión 2. Correcciones al `api/README.md` y concepto para generar el backend
> desde definiciones de recurso, igual que el admin Angular se genera desde un
> schema. Sin código.
>
> **Novedades de esta versión:** (1) catálogo y gestión de **Script Properties**
> (§10); (2) las imágenes se gestionan con **Cloudinary**, no con Drive (§11).

---

## 1. Respuesta corta

**Sí es válido y encaja bien.** `01-sheet-definitions` ya era "fuente única" de
hojas y columnas. La corrección es llevar esa idea hasta el final: la misma
definición gobierna también el CRUD, relaciones, validaciones, orden, rutas y
lo que se expone al front.

**Límite honesto:** se genera dinámicamente lo _estructural y repetitivo_. Las
_reglas de negocio singulares_ (filtro sanitario, RUC, placeholders,
destacados, relacionados) se declaran por nombre y se implementan aparte (§7).

---

## 2. Correcciones al documento actual

### 2.1 Críticas

| #   | Problema en el doc                                       | Por qué falla                                                            | Corrección                                                                                                      |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 1   | Auth con `Authorization: Bearer`                         | `doGet/doPost` **no exponen las cabeceras**                              | El token viaja en el **cuerpo** (`token`)                                                                       |
| 2   | El admin llama desde el navegador con `application/json` | Dispara _preflight_ (`OPTIONS`), que Apps Script no soporta → CORS falla | Petición "simple": `Content-Type: text/plain` con el JSON como texto, sin cabeceras personalizadas              |
| 3   | Lecturas admin por `GET`                                 | El token quedaría en la URL                                              | Todo `/admin/*` por **POST** con `{ token, method, path, payload }`                                             |
| 4   | `/upload` multipart a Apps Script (y luego a Drive)      | Apps Script no parsea multipart; Drive no es el destino                  | **Se elimina `/upload`.** El navegador sube directo a Cloudinary con una **firma** emitida por el backend (§11) |
| 5   | Orden de carga por prefijo alfabético                    | `clasp` no lo garantiza                                                  | `filePushOrder` + no ejecutar código dependiente de otros archivos al cargar                                    |
| 6   | Reorder sin dueño claro                                  | Carreras entre admins                                                    | **El backend es dueño de `position`** (§9)                                                                      |
| 7   | Solo se menciona "Script Properties" de pasada           | Sin catálogo, sin verificación, sin manejo de secretos ni de entornos    | Sección propia (§10) con manifiesto de propiedades y chequeo en el setup                                        |

### 2.2 Importantes

| #   | Problema                                                                 | Corrección                                                                           |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 8   | Error con un solo `field?`                                               | Lista de `{ path, message }`: un 422 trae todos los errores                          |
| 9   | Caché de listados completos                                              | `CacheService` limita ~100 KB por valor y 6 h → cachear **por recurso y troceado**   |
| 10  | "Borra y reescribe diff" fila por fila                                   | Reemplazar **todas las filas hijas del padre en lote**, dentro del lock              |
| 11  | `30-assemblers`, `40-admin-resources`, `41-admin-singletons` por entidad | Motor genérico + schema                                                              |
| 12  | Drive como host de imágenes                                              | **Reemplazado por Cloudinary** (§11); desaparecen la carpeta de Drive y sus permisos |
| 13  | Listado devuelve productos completos                                     | **Proyección** para el listado; detalle completo                                     |
| 14  | Sin evolución del schema                                                 | Drift-check en el setup (§14)                                                        |

### 2.3 Cambios que arrastran a los otros documentos

- **`api.md`:** R3 con posiciones **con huecos**; se elimina `/upload`; se añade `/admin/upload-signature`; auth por cuerpo; `_media` pasa a opcional.
- **Admin Angular:** el servicio API envía `text/plain` + token en el cuerpo; el **componente `image`** sube en dos pasos (pedir firma → subir a Cloudinary), sin base64 ni multipart hacia Apps Script; el reorder del listado envía **intención**; miniaturas con transformación de URL de Cloudinary.

---

## 3. Concepto: una definición de recurso como única fuente

| Salida generada                                    | Qué toma de la definición                                            |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| Hojas, cabeceras, formatos, validaciones de Sheets | Campos, tipos, enums, obligatoriedad                                 |
| Lectura/escritura (CRUD)                           | Hoja principal, clave, hijos                                         |
| Objetos anidados                                   | Grupos, listas, key-value, singleton                                 |
| Validación de payloads                             | Tipos, requeridos, patrones, únicos, FK, mín/máx, origen de imágenes |
| Rutas `/admin/{recurso}`                           | Id y tipo (colección/singleton)                                      |
| Orden                                              | Estrategia declarada                                                 |
| Vistas públicas (futuro)                           | Reglas de visibilidad nombradas                                      |
| Schema para el front (§12)                         | Proyección de campos y validaciones                                  |

**Regla de oro:** si agregar un campo o un recurso estándar exige tocar código,
el motor está mal diseñado.

---

## 4. Schema de recurso (lado backend)

| Propiedad                   | Descripción                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `id`                        | Identificador (`products`) y segmento de ruta                                                      |
| `kind`                      | `collection` o `singleton`                                                                         |
| `sheet`                     | Hoja principal                                                                                     |
| `keyField` / `immutableKey` | Clave única (`slug`) e inmutable tras crear                                                        |
| `fields`                    | Campos (§5)                                                                                        |
| `ordering`                  | `none` o `positioned` (campo `position`, paso 1000)                                                |
| `activeField`               | Campo booleano que oculta del público (`active`)                                                   |
| `onDelete`                  | `restrict` o `cascade-children`                                                                    |
| `dependents`                | Recursos que lo referencian                                                                        |
| `listProjection`            | Campos devueltos en el listado                                                                     |
| `imageFolder`               | Carpeta de Cloudinary donde suben las imágenes de este recurso (§11)                               |
| `rules`                     | Reglas/validadores nombrados (§7)                                                                  |
| `views`                     | Vistas públicas declaradas (§7)                                                                    |
| `audit`                     | Si registra en `_audit_log`                                                                        |
| `cache`                     | TTL e invalidación                                                                                 |
| `exposeToFront`             | Qué parte del schema se publica en `/admin/schema` (contrato legible, D1 — el admin no lo consume) |

---

## 5. Schema de campo y almacenamiento

Tipos idénticos al catálogo del front: `text`, `textarea`, `slug`, `number`,
`currency`, `boolean`, `select`, `multiselect`, `url`, `email`, `phone`,
`date`, `time`, `relation`, `image`, `group`, `list`, `string-list`,
`key-value`, `readonly-text`.

**Propiedades de campo:** `key` · `type` · `required` · `unique` · `immutable` ·
`default` · `enum` · `pattern` · `min/max` · `minWords/maxWords` · `relation`
(destino, `onlyActive`) · `computed` · `system` · `column` · `format`.

| Tipo                 | Almacenamiento                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Escalares            | Una **columna**                                                                                                            |
| `image`              | Columna `image_url` con la URL **de Cloudinary**. Validación propia: `https` y que pertenezca al _cloud_ configurado (§11) |
| `relation`           | Columna FK; valida existencia (y `active`)                                                                                 |
| `multiselect`        | Celda con valores separados por coma                                                                                       |
| `group` en colección | Columnas con prefijo (`address_street`)                                                                                    |
| `group` en singleton | Una fila por campo, clave aplanada con `_`                                                                                 |
| `list`               | **Hoja hija** 1:N: `{padre}_slug` + `position` + campos                                                                    |
| `string-list`        | Hoja hija con una columna de valor                                                                                         |
| `key-value`          | Hoja hija con `key`, `value`                                                                                               |

---

## 6. Relaciones

- **Padre → hijos (1:N embebidos):** listas/pares; se leen y escriben siempre con el padre.
- **Referencia entre recursos:** `relation` (producto → categoría), valida FK y estado activo.
- **Dependientes:** con `restrict`, borrar con dependientes devuelve 409 con motivo.
- **Mínimos de lista** (imágenes ≥ 1) se validan al guardar el padre.
- **Sin integridad nativa:** el motor es el único que escribe, bajo lock; las hojas no se editan a mano en producción.

---

## 7. Reglas declarativas vs nombradas

**Declarativas (el motor las entiende):** obligatorio, único, inmutable, enum,
patrón, rangos, palabras, FK, mín/máx de lista, `active`, orden, `onDelete`,
computados/sistema, **origen de imagen válido**.

**Nombradas (registro pequeño de funciones puras):**

| Nombre               | Tipo        | Qué hace                                                        | Mapea a |
| -------------------- | ----------- | --------------------------------------------------------------- | ------- |
| `publishable`        | filtro      | `active` + `registro_sanitario` + categoría activa + ≥ 1 imagen | R1, R2  |
| `featured`           | vista       | publicables + `featured`, máx. 6                                | R4      |
| `related`            | vista       | misma categoría, sin el propio, máx. 4                          | R5      |
| `hidden-with-reason` | vista admin | excluidos + motivo                                              | R6      |
| `no-placeholders`    | validador   | rechaza valores de `_placeholders`                              | R8      |
| `ruc-valid`          | validador   | 11 dígitos y formato                                            | legal   |
| `slug-from`          | computado   | sugiere/valida slug                                             | —       |

---

## 8. Motor genérico: pipelines

### Escritura

1. **Entrada:** cuerpo `text/plain` → `{ token, method, path, payload }`.
2. **Auth:** token contra la propiedad correspondiente (§10).
3. **Resolver recurso** desde el registro de schemas.
4. **Validar** contra el schema acumulando **todos** los errores con ruta.
5. **Reglas nombradas.**
6. **Lock** → releer estado fresco.
7. **Escribir:** fila principal + reemplazo en lote de hijos; campos de sistema/computados.
8. **Auditar.**
9. **Invalidar caché** del recurso afectado.
10. **Responder** con el recurso armado.

### Lectura

Caché por recurso → rangos completos → armar → ordenar → proyectar → JSON plano.

### Errores

Siempre HTTP 200 con `{ error: { status, message, errors?: [{ path, message }] } }`.
Estados: 400, 401, 404, 409, 422, 500.

---

## 9. Ordenamiento con huecos: el backend manda

- **Listado reordenable (categorías):** el front envía la _intención_ ("mover X **después de** Y" o "al inicio"). El backend, dentro del lock, calcula el punto medio (paso 1000) y rebalancea internamente si no hay espacio.
- **Listas hijas:** el **orden del arreglo** recibido es la verdad; el backend asigna las posiciones.
- Los nuevos van al final (última + paso).
- `position` se expone solo al admin y nunca al público (R3).

---

## 10. Script Properties (variables de entorno de Apps Script)

### 10.1 Qué son

Apps Script incluye **Properties** (servicio de propiedades): pares clave/valor
guardados **en la nube, ligados al proyecto**, que no viven en el código ni en
el repositorio. Para este backend se usan las **Script Properties**
(compartidas por todas las ejecuciones del script). Se editan en el editor de
Apps Script: _Configuración del proyecto → Propiedades de la secuencia de
comandos_, o se escriben mediante funciones de setup.

> El documento anterior las mencionaba solo de pasada. Aquí se formalizan.

### 10.2 Qué va en Properties y qué no

| Va en Script Properties        | Va en `00-config` (código)                                                    | Va en una hoja                            |
| ------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------- |
| Secretos y valores por entorno | Constantes no sensibles (límites, TTL, paso de orden, nombres de propiedades) | Datos del negocio (site, legal, catálogo) |

Nunca: secretos en hojas, en el código ni en el repositorio. Nunca registrar
sus valores en logs.

### 10.3 Catálogo de propiedades

| Propiedad                | Origen                                                                              | Secreto                                    | Uso                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `SPREADSHEET_ID`         | Generada por el setup                                                               | No                                         | Libro de Sheets                                                                   |
| `ADMIN_TOKEN_HASH`       | Generada por el setup (se muestra el token **una sola vez** en el log de ejecución) | Sí                                         | Se guarda el **hash** del token; al autenticar se hashea el recibido y se compara |
| `CLOUDINARY_CLOUD_NAME`  | **Manual**                                                                          | No                                         | Identifica el _cloud_; también para validar el origen de `image_url`              |
| `CLOUDINARY_API_KEY`     | **Manual**                                                                          | Semi (se entrega al navegador en la firma) | Parámetro de la subida firmada                                                    |
| `CLOUDINARY_API_SECRET`  | **Manual**                                                                          | **Sí, crítico**                            | Firmar subidas. **Nunca sale del backend ni se devuelve**                         |
| `CLOUDINARY_BASE_FOLDER` | Manual                                                                              | No                                         | Carpeta raíz (ej. nombre del negocio)                                             |
| `ENV`                    | Manual                                                                              | No                                         | `dev` o `prod`                                                                    |
| `SCHEMA_VERSION`         | Generada por el setup                                                               | No                                         | Versión del schema aplicada a las hojas                                           |

(Si en el futuro se usa la API de administración de Cloudinary, no se agregan
secretos nuevos: se reutilizan la API key y el secret.)

### 10.4 Manifiesto de propiedades (declarativo)

En `00-config` vive un **manifiesto**: lista de nombres de propiedades, con
`required`, `secret` y `source` (`manual` | `generated`) y una validación
simple (ej. el _cloud name_ no vacío). **Nunca contiene valores.**

### 10.5 Acceso a propiedades

- **Un solo módulo de acceso**; ningún otro archivo toca el servicio de propiedades.
- Se leen **una vez por ejecución** y se guardan en memoria.
- Si falta una requerida: error 500 con mensaje claro ("falta configurar X"), sin revelar valores.
- Límites: valores pequeños (≈9 KB cada uno) y almacén total ≈500 KB; no guardar datos grandes.

### 10.6 Setup y propiedades

Nuevo paso `setup/00-check-properties`, **antes** de todo lo demás:

1. Lee el manifiesto.
2. Verifica que las propiedades `manual` existan y no estén vacías; si faltan, **lista cuáles** y se detiene.
3. Genera las `generated` si no existen (idempotente: no regenera el token si ya existe; la rotación es una acción explícita aparte).
4. Reporta un resumen **sin mostrar secretos**.

### 10.7 Seguridad y entornos

- Quien tenga **acceso de edición** al proyecto puede leer las propiedades: limitar los editores.
- **Rotación:** una función manual de "rotar token" regenera el token (muestra el nuevo una vez, guarda el hash).
- **Dev y prod separados:** dos proyectos de Apps Script (y dos libros de Sheets), cada uno con **sus propias** propiedades; en `clasp` dos archivos de configuración. Nunca compartir el _secret_ de Cloudinary entre entornos si se puede evitar (usar carpetas/cuentas distintas).
- `.clasp.json` y cualquier archivo con IDs no se commitean.

---

## 11. Imágenes con Cloudinary

### 11.1 Decisión: subida **directa y firmada**

| Opción                                  | Cómo funciona                                                               | Veredicto                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A. Apps Script sube la imagen           | El navegador envía el archivo a Apps Script y este lo reenvía a Cloudinary  | ❌ Doble transferencia, límites de tamaño/tiempo, requiere base64                            |
| B. **Backend firma, navegador sube**    | El backend solo emite una **firma**; el navegador sube directo a Cloudinary | ✅ **Recomendada**                                                                           |
| C. Subida sin firma (_unsigned preset_) | El navegador sube con un preset público                                     | ⚠️ Cualquiera con el nombre del preset puede subir a tu cuenta; solo si se acepta ese riesgo |

Con B, el _API secret_ nunca sale del backend y Apps Script **no necesita
llamar a Cloudinary** (no hace falta permiso de peticiones externas, y
desaparecen los permisos de Drive).

### 11.2 Flujo de subida (componente `image` del front)

1. El usuario elige archivo; el front valida tipo y tamaño (UX).
2. El front pide al backend una firma: `POST /admin/upload-signature` (autenticado) indicando el **recurso/propósito** (ej. `products`).
3. El backend decide **los parámetros firmados**: carpeta (`CLOUDINARY_BASE_FOLDER` + `imageFolder` del recurso), marca de tiempo, formatos permitidos; los firma con el _API secret_.
4. El front sube el archivo **directo a Cloudinary** con esos parámetros, la firma y la API key.
5. Cloudinary responde con la **URL segura** (`secure_url`).
6. El campo guarda esa URL como valor (`image_url`); el formulario queda modificado; se persiste con el guardado normal del registro.

### 11.3 Contrato de `/admin/upload-signature`

|                | Detalle                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Entrada        | `{ token, method, path, payload: { resource } }` (mismo envelope que todo `/admin/*`)                              |
| Salida         | `cloud_name`, `api_key`, `timestamp`, `signature`, `folder`, `allowed_formats` y la URL de subida de Cloudinary    |
| Nunca devuelve | `api_secret`                                                                                                       |
| Vigencia       | La firma caduca pronto (del orden de una hora); se pide una por subida                                             |
| Control        | El **cliente no elige** carpeta ni formatos: los fija el backend. Opcional: limitar firmas por minuto con la caché |

### 11.4 Qué se guarda y qué valida el backend

- Se guarda **solo la URL** `secure_url` en `image_url` (consistente con los demás documentos).
- **Validador del tipo `image`:** debe ser `https` y comenzar con la ruta del _cloud_ configurado en `CLOUDINARY_CLOUD_NAME`. Así nadie guarda URLs de terceros ni ajenas.
- La imagen principal de un producto sigue siendo la de `position = 1`.

### 11.5 Entrega y miniaturas

Cloudinary transforma por URL (formato/calidad automáticos, redimensionado).
Regla: **se guarda la URL original**; quien muestra (admin o sitio público)
inserta la transformación (ej. ancho para miniatura, formato y calidad
automáticos). Así no se duplican registros por tamaño.

### 11.6 Reemplazo, borrado y huérfanos

- Reemplazar una imagen solo cambia la URL; la anterior **no se borra** automáticamente (decisión simple y segura).
- Opcional futuro: tarea de limpieza que detecte imágenes de Cloudinary no referenciadas por ninguna hoja.

### 11.7 La hoja `_media`

Pasa de obligatoria a **opcional**: con subida directa, el backend no se entera de cada archivo. Si se desea registro, el front notifica tras subir y se guardan `public_id`, `image_url`, dimensiones y fecha. Se **elimina** `file_id` (era de Drive).

---

## 12. El schema del backend y el del front

1. **Mismo vocabulario, dos instancias separadas:** tipos idénticos; el
   front añade lo visual (etiquetas, columnas, layout, endpoints) y el back
   declara rutas, validaciones y políticas. **No se piden definiciones en
   runtime** — el front consume datos, no metadata.
2. **Sincronización:** un **contract check estático**
   (`scripts/contract-check.mjs`, en `npm run api:check`) compara ambos
   lados: existencia de recursos en las dos direcciones, `kind`, ruta del
   endpoint contra la ruta efectiva del back, y `required` + validators por
   campo. Divergencia ⇒ rojo. Es higiene del monorepo: ninguno de los dos
   lados lo ejecuta en runtime.
3. **`/admin/schema` (D1):** sigue publicando la proyección (campos, tipos,
   `required`, enums, patrones, rangos, relaciones, orden, `listProjection`)
   como **contrato legible** — inspección, debug y clientes futuros. El
   admin **no** lo consume.

Nunca se publica: nombres de hojas, columnas internas, token, propiedades ni
reglas internas. Para imágenes, el schema solo indica el tipo `image`; la
firma se pide por separado.

---

## 13. Estructura de carpetas actualizada

```
api/
├── README.md
├── appsscript.json
├── .clasp.json            ← local, con filePushOrder (uno por entorno)
├── .claspignore
│
├── 00-config              ← constantes + MANIFIESTO de propiedades (solo nombres)
│
├── schema/                ← 🧬 FUENTE ÚNICA (datos declarativos)
│   ├── 01-types
│   ├── 02-enums
│   ├── 03-resources-*     ← categories, products, site, legal
│   └── 04-registry
│
├── setup/                 ← manual, idempotente
│   ├── 00-check-properties ← verifica/genera propiedades según el manifiesto
│   ├── 01-setup-spreadsheet
│   ├── 02-setup-sheets
│   ├── 03-setup-drift
│   └── 04-setup-seed      ← enums y placeholders (ya no crea carpeta de Drive)
│
├── core/
│   ├── 10-router
│   ├── 11-auth            ← hash del token vs ADMIN_TOKEN_HASH
│   ├── 12-http
│   └── 13-props           ← ÚNICO acceso a Properties (lectura en memoria por ejecución)
│
├── engine/
│   ├── 20-storage-map
│   ├── 21-repo
│   ├── 22-assemble
│   ├── 23-validate        ← incluye validación de origen de imagen
│   ├── 24-crud
│   ├── 25-ordering
│   └── 26-lock-cache
│
├── rules/
│   ├── 30-registry
│   ├── 31-catalog-rules
│   └── 32-validators
│
├── routes/                ← solo lo que NO es CRUD genérico
│   ├── 40-upload-signature ← firma de Cloudinary (§11)
│   └── 41-schema           ← /admin/schema
│
├── 50-audit
└── (futuro) 60-public
```

Cambios frente a la v1: **sale** `40-media` (Drive); **entran**
`13-props`, `setup/00-check-properties` y `40-upload-signature`.

---

## 14. Evolución del schema

| Cambio                    | Qué hace el sistema                                        |
| ------------------------- | ---------------------------------------------------------- |
| Agregar campo escalar     | El drift-check agrega la columna; no toca datos            |
| Agregar lista             | Crea la hoja hija                                          |
| Renombrar campo           | Operación manual guiada (reporta columna huérfana + nueva) |
| Quitar campo              | Se marca obsoleto; la columna no se borra                  |
| Cambiar tipo              | Bloqueado si hay datos incompatibles                       |
| Orden de columnas         | Irrelevante: se mapea por nombre de cabecera               |
| Nueva propiedad requerida | Se agrega al manifiesto; `check-properties` avisa si falta |

Se registra `SCHEMA_VERSION` (propiedad) y el cambio en `_audit_log`.

---

## 15. Ejemplos (descritos)

### `products` — colección

- Hoja `products`, clave `slug` (inmutable), `ordering: none`, `activeField: active`, `imageFolder`: `products`
- Escalares: `name`, `seo_title`, `seo_description`, `description` (150–300 palabras), `price`, `availability`, `brand`, `sku` (único), `registro_sanitario`, `clase_riesgo`, `titular_registro`, `featured`, `active`, `updated_at` (computado)
- `category_slug`: `relation` → `categories` (solo activas)
- `images`: `list` (hoja `product_images`, mín 1) → `image_url` (image, Cloudinary) + `image_alt`
- `specs`: `key-value`; `faq`: `list` → `question` + `answer`
- Reglas: `publishable`, `featured`, `related`, `hidden-with-reason`

### `categories` — colección

- Clave `slug`, `ordering: positioned`, `onDelete: restrict`, `imageFolder`: `categories`
- Campos: `name`, `seo_title`, `seo_description`, `intro`, `image_url`, `image_alt`, `active`

### `site` — singleton

- Hoja clave/valor `site_config`; grupos `address` y `geo` aplanados
- `hours`: `list` (días, abre, cierra); `social`: `string-list`
- Reglas: `no-placeholders`

### `legal` — singleton

- Hoja clave/valor; `last_updated` computado
- Reglas: `no-placeholders`, `ruc-valid`

---

## 16. Qué NO generalizar

- Destacados, relacionados, publicables → reglas nombradas.
- RUC y placeholders → validadores nombrados.
- Emisión de la firma de Cloudinary → ruta propia.
- Autenticación y acceso a Properties → módulos de `core`.
- Lógica que dependa de varios recursos y no sea una FK simple.

Si una regla se repite en 2–3 recursos, entonces se promueve a propiedad declarativa.

---

## 17. Orden de implementación y criterios

### Orden

1. Crear la cuenta/_cloud_ de Cloudinary y cargar manualmente sus tres valores en Script Properties.
2. `00-config` con el manifiesto + `core/13-props` + `setup/00-check-properties` (debe pasar en verde).
3. `schema/` con los 4 recursos.
4. `setup/` restante → libro y hojas correctos; probar el drift-check.
5. `core/` (router, auth por hash, envelope con errores múltiples).
6. `engine/`: `storage-map` → `repo` → `assemble` → `validate` → `crud` → `ordering` → `lock-cache`.
7. `rules/` conectadas por nombre.
8. Probar con `categories` y `site`, luego `products`.
9. `routes/40-upload-signature` y `41-schema`; `50-audit`.
10. Del lado del front: crear `src/app/schemas/<id>.schema.ts` y registrarlo en `schemas/registry.ts` (envelope `text/plain`, componente `image` en dos pasos, intención de reorder). `api:check` valida que coincida con el back.
11. Publicar y probar **desde el navegador** (CORS real, subida directa a Cloudinary incluida).

### Criterios de aceptación

1. Agregar un recurso estándar = un archivo en `schema/` + registro; sin código nuevo.
2. Agregar un campo escalar = editar el schema y correr setup.
3. El setup falla con un mensaje claro si falta cualquier propiedad `manual`, sin mostrar valores.
4. Re-ejecutar el setup no regenera el token ni duplica nada.
5. El `API secret` de Cloudinary no aparece en ninguna respuesta, log, hoja ni archivo del repo.
6. Subir una imagen desde el admin llega directo a Cloudinary y el campo guarda la `secure_url`.
7. Guardar un `image_url` de otro dominio o de otro _cloud_ devuelve 422 con ruta del campo.
8. Un 422 devuelve todos los errores con ruta, incluidos los de items de lista.
9. Reordenar categorías con dos admins simultáneos no corrompe `position`.
10. Borrar una categoría con productos devuelve 409 con motivo.
11. Ninguna llamada del navegador a Apps Script usa cabeceras personalizadas ni `application/json`.
12. Dev y prod tienen proyectos, libros y propiedades separados.
