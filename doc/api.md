# Backend con Google Sheets + Apps Script

> Diseño derivado de `api-modelo-datos.md`. Google Sheets = base de datos.
> Apps Script = lógica del backend (reglas R1–R8 y endpoints). Sin código aquí:
> solo estructura, columnas, relaciones y convenciones.

---

## 1. Convenciones de nombres (normalización)

El documento original mezcla estilos (`image_url`, `images[].src`, `seoTitle`,
`registroSanitario`). Para unificar:

| Regla                     | Decisión                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encabezados de hojas      | `snake_case`, minúsculas, sin tildes ni espacios                                                                                                               |
| Idioma de los nombres     | Inglés para todo (`health_registry`, no `registroSanitario`)... **excepto** términos legales peruanos que no tienen traducción útil (`ruc`, `igv`, `reclamos`) |
| Imágenes                  | **Siempre `image_url`** (categoría, producto, cualquier otra). Se elimina `src`                                                                                |
| Texto alternativo         | `image_alt`                                                                                                                                                    |
| Llaves de relación        | `<entidad>_slug` (ej. `category_slug`, `product_slug`)                                                                                                         |
| Booleanos                 | `TRUE` / `FALSE` (casilla de verificación)                                                                                                                     |
| Orden interno             | `position` (entero, nunca expuesto al front)                                                                                                                   |
| Fechas                    | ISO `YYYY-MM-DD` o `YYYY-MM-DD HH:mm`                                                                                                                          |
| Hojas                     | prefijo por dominio: `categories`, `products`, `product_images`, `site_config`…                                                                                |
| Hojas internas/auxiliares | prefijo `_` (ej. `_enums`, `_audit_log`)                                                                                                                       |

### Mapeo hoja → JSON público

**Decisión (contrato del front): el JSON público NO traduce estilos.** Las
claves del JSON son los nombres `snake_case` de las hojas; el front define
`field.key` —y las rutas de error del backend— con esos mismos nombres. La
API solo **ensambla estructura** (columnas aplanadas → objetos anidados,
listas separadas por comas → arreglos), sin renombrar.

| Hoja (snake_case)           | JSON público                                              |
| --------------------------- | --------------------------------------------------------- |
| `seo_title`                 | `seo_title` (sin renombrar a `seoTitle`)                  |
| `category_slug`             | `category_slug` (sin renombrar a `category`)              |
| `image_url`                 | `image_url` (unificado en todo el JSON; se elimina `src`) |
| `image_alt`                 | `image_alt` (campo hermano de la imagen)                  |
| `question` / `answer` (FAQ) | `question` / `answer` (sin renombrar a `q` / `a`)         |
| `address_street`            | `address.street` (ensamblado)                             |
| `days` (`mon,tue,…`)        | `days: [...]` (ensamblado)                                |

> **Contrato de imágenes (decisión tomada):** `image_url` en todo el JSON —
> categoría (`image_url`), imágenes de producto (`images[].image_url` +
> `images[].image_alt`). `src` queda eliminado.

---

## 2. Vista general de hojas

| #   | Hoja             | Tipo                    | Equivale a                    | Filas                 |
| --- | ---------------- | ----------------------- | ----------------------------- | --------------------- |
| 1   | `categories`     | Entidad                 | Category                      | 1 por categoría       |
| 2   | `products`       | Entidad                 | Product (campos escalares)    | 1 por producto        |
| 3   | `product_images` | Detalle (1:N)           | `Product.images[]`            | 1 por imagen          |
| 4   | `product_specs`  | Detalle (1:N)           | `Product.specs`               | 1 por par clave/valor |
| 5   | `product_faq`    | Detalle (1:N)           | `Product.faq[]`               | 1 por pregunta        |
| 6   | `site_config`    | Singleton (clave/valor) | SiteConfig                    | 1 por campo           |
| 7   | `site_hours`     | Detalle                 | `SiteConfig.hours[]`          | 1 por tramo horario   |
| 8   | `site_social`    | Detalle                 | `SiteConfig.social[]`         | 1 por red             |
| 9   | `legal_config`   | Singleton (clave/valor) | Legal                         | 1 por campo           |
| 10  | `_enums`         | Auxiliar                | Enums y listas válidas        | —                     |
| 11  | `_placeholders`  | Auxiliar                | Valores prohibidos (R8)       | —                     |
| 12  | `_media`         | Auxiliar (opcional)     | Registro de `/upload`         | 1 por archivo subido  |
| 13  | `_audit_log`     | Auxiliar (opcional)     | Trazabilidad de cambios admin | 1 por cambio          |

**Por qué se separan imágenes, specs y FAQ:** una celda de Sheets no maneja bien
listas ni objetos anidados. Normalizar en hojas hijas evita JSON dentro de
celdas, permite ordenar y validar, y es lo más cercano a una base relacional.

---

## 3. Definición de cada hoja

### 3.1 `categories`

| Columna           | Tipo        | Oblig. | Notas                                              |
| ----------------- | ----------- | ------ | -------------------------------------------------- |
| `slug`            | texto       | ✅     | **PK.** Único, minúsculas, URL-friendly, inmutable |
| `name`            | texto       | ✅     | Nombre visible                                     |
| `seo_title`       | texto       | ✅     |                                                    |
| `seo_description` | texto       | ✅     |                                                    |
| `intro`           | texto largo | ✅     | ~150 palabras únicas                               |
| `image_url`       | URL         | ✅     | URL pública (ver §6, Drive)                        |
| `image_alt`       | texto       | ❌     | Recomendado                                        |
| `active`          | booleano    | ✅     | `FALSE` ⇒ no sale en público (R1)                  |
| `position`        | entero      | ✅     | Orden 1..N denso. **Nunca se expone** (R3)         |

### 3.2 `products`

| Columna              | Tipo        | Oblig.           | Notas                                                               |
| -------------------- | ----------- | ---------------- | ------------------------------------------------------------------- |
| `slug`               | texto       | ✅               | **PK.** Único, inmutable tras publicar                              |
| `name`               | texto       | ✅               |                                                                     |
| `category_slug`      | texto       | ✅               | **FK → `categories.slug`**                                          |
| `seo_title`          | texto       | ❌               |                                                                     |
| `seo_description`    | texto       | ✅               |                                                                     |
| `description`        | texto largo | ✅               | 150–300 palabras únicas                                             |
| `price`              | número      | ✅               | Número puro, sin símbolo ni formato                                 |
| `availability`       | lista       | ✅               | `InStock` \| `PreOrder` \| `OutOfStock` (validación desde `_enums`) |
| `brand`              | texto       | ❌               |                                                                     |
| `sku`                | texto       | ✅               | Único                                                               |
| `registro_sanitario` | texto       | ✅ para publicar | Vacío ⇒ producto oculto (R2)                                        |
| `clase_riesgo`       | texto       | ❌               | `I`, `IIa`, etc.                                                    |
| `titular_registro`   | texto       | ❌               |                                                                     |
| `featured`           | booleano    | ✅               | Candidato a destacado (R4)                                          |
| `active`             | booleano    | ✅               | `FALSE` ⇒ oculto (R1)                                               |
| `updated_at`         | fecha-hora  | ✅               | Lo llena el script al guardar                                       |

> Las imágenes, specs y FAQ **no** van aquí: están en hojas hijas.

### 3.3 `product_images`

| Columna        | Tipo   | Oblig. | Notas                    |
| -------------- | ------ | ------ | ------------------------ |
| `product_slug` | texto  | ✅     | **FK → `products.slug`** |
| `position`     | entero | ✅     | 1 = imagen principal     |
| `image_url`    | URL    | ✅     | URL pública              |
| `image_alt`    | texto  | ✅     | Texto alternativo        |

Regla: todo producto publicable debe tener **mínimo 1 imagen** (la de
`position = 1` es la principal).

### 3.4 `product_specs`

| Columna        | Tipo   | Oblig. | Notas                          |
| -------------- | ------ | ------ | ------------------------------ |
| `product_slug` | texto  | ✅     | **FK → `products.slug`**       |
| `position`     | entero | ✅     | Orden de aparición en la ficha |
| `spec_key`     | texto  | ✅     | Ej. `Material`                 |
| `spec_value`   | texto  | ✅     | Ej. `Neopreno`                 |

La API reconstruye el objeto `specs` (clave → valor) respetando `position`.

### 3.5 `product_faq`

| Columna        | Tipo        | Oblig. | Notas                                       |
| -------------- | ----------- | ------ | ------------------------------------------- |
| `product_slug` | texto       | ✅     | **FK → `products.slug`**                    |
| `position`     | entero      | ✅     | Orden                                       |
| `question`     | texto       | ✅     | Clave JSON `question` (sin renombrar a `q`) |
| `answer`       | texto largo | ✅     | Clave JSON `answer` (sin renombrar a `a`)   |

### 3.6 `site_config` (singleton, formato clave/valor)

Columnas: `key` · `value` · `type` · `note`.
Una fila por campo. Las claves anidadas se aplanan con guion bajo.

| `key`                 | Tipo                          | Oblig. | Equivale a           |
| --------------------- | ----------------------------- | ------ | -------------------- |
| `name`                | texto                         | ✅     | `name`               |
| `url`                 | URL                           | ✅     | `url`                |
| `description`         | texto                         | ✅     | `description`        |
| `phone`               | texto (E.164)                 | ✅     | `phone`              |
| `whatsapp`            | texto (solo dígitos, sin `+`) | ✅     | `whatsapp`           |
| `email`               | texto                         | ✅     | `email`              |
| `address_street`      | texto                         | ✅     | `address.street`     |
| `address_city`        | texto                         | ✅     | `address.city`       |
| `address_region`      | texto                         | ✅     | `address.region`     |
| `address_postal_code` | texto                         | ✅     | `address.postalCode` |
| `address_country`     | texto (ISO alpha-2)           | ✅     | `address.country`    |
| `geo_lat`             | número                        | ✅     | `geo.lat`            |
| `geo_lng`             | número                        | ✅     | `geo.lng`            |
| `currency`            | texto (ISO 4217)              | ✅     | `currency`           |

> **Importante:** formatear las columnas `value` como **Texto plano** para que
> Sheets no convierta teléfonos (`+51…`) o códigos postales en números/fechas.

### 3.7 `site_hours`

| Columna    | Tipo          | Oblig. | Notas                                           |
| ---------- | ------------- | ------ | ----------------------------------------------- |
| `position` | entero        | ✅     | Orden de los tramos                             |
| `days`     | texto         | ✅     | Lista separada por comas: `mon,tue,wed,thu,fri` |
| `opens`    | texto `HH:mm` | ✅     | Formato texto plano                             |
| `closes`   | texto `HH:mm` | ✅     | Formato texto plano                             |

La API convierte `days` en el arreglo `days[]` del contrato.

### 3.8 `site_social`

| Columna    | Tipo   | Oblig. | Notas                                   |
| ---------- | ------ | ------ | --------------------------------------- |
| `position` | entero | ✅     |                                         |
| `url`      | URL    | ✅     |                                         |
| `network`  | texto  | ❌     | Etiqueta interna (instagram, facebook…) |

### 3.9 `legal_config` (singleton, clave/valor)

Columnas: `key` · `value` · `type` · `note`.

| `key`                    | Tipo     | Oblig. | Notas                                                               |
| ------------------------ | -------- | ------ | ------------------------------------------------------------------- |
| `legal_name`             | texto    | ✅     | Razón social                                                        |
| `trade_name`             | texto    | ✅     | Nombre comercial                                                    |
| `ruc`                    | texto    | ✅     | **Texto**, 11 dígitos, validado                                     |
| `fiscal_address`         | texto    | ✅     | Domicilio fiscal                                                    |
| `email`                  | texto    | ✅     | Contacto legal                                                      |
| `phone`                  | texto    | ✅     |                                                                     |
| `reclamos_email`         | texto    | ✅     | Libro de reclamaciones                                              |
| `reclamos_response_days` | número   | ✅     | Días hábiles                                                        |
| `prices_include_igv`     | booleano | ✅     |                                                                     |
| `currency`               | texto    | ✅     | ISO 4217                                                            |
| `last_updated`           | fecha    | ✅     | Lo actualiza el script al guardar; la API lo devuelve ya formateado |

### 3.10 `_enums`

Una columna por lista de valores permitidos, usada para validación de datos en
Sheets (desplegables) y para validar en el script:

| Columna                 | Valores                                         |
| ----------------------- | ----------------------------------------------- |
| `availability`          | `InStock`, `PreOrder`, `OutOfStock`             |
| `risk_class` (opcional) | `I`, `IIa`, `IIb`, `III`                        |
| `days`                  | `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun` |

> El documento original menciona un enum `condition` en R7 pero **no existe**
> en el modelo de Product. Decidir si se incluye (`New`/`Used`) o se elimina de R7.

### 3.11 `_placeholders` (para R8)

Una columna `pattern` con valores o patrones prohibidos al guardar `/site` y
`/legal`: `example.com`, `000 000 000`, `TODO`, `lorem`, RUCs de prueba
(`00000000000`, `12345678901`), etc.

### 3.12 `_media` (opcional)

| Columna         | Notas                   |
| --------------- | ----------------------- |
| `file_id`       | ID del archivo en Drive |
| `image_url`     | URL pública resultante  |
| `original_name` | Nombre original         |
| `uploaded_at`   | Fecha-hora              |

### 3.13 `_audit_log` (opcional pero recomendado)

| Columna      | Notas                                      |
| ------------ | ------------------------------------------ |
| `timestamp`  | Fecha-hora                                 |
| `actor`      | Quién hizo el cambio                       |
| `action`     | `create` / `update` / `delete` / `reorder` |
| `entity`     | Hoja afectada                              |
| `entity_key` | Slug o clave afectada                      |
| `summary`    | Resumen del cambio                         |

---

## 4. Relaciones

```
categories (slug) 1 ───────< N products (category_slug)

products (slug) 1 ───────< N product_images (product_slug)
products (slug) 1 ───────< N product_specs  (product_slug)
products (slug) 1 ───────< N product_faq    (product_slug)

site_config   (singleton)  ──┬── site_hours  (N tramos)
                             └── site_social (N URLs)

legal_config  (singleton)
```

Reglas de integridad (las valida el script al escribir, porque Sheets no tiene
claves foráneas):

1. `products.category_slug` debe existir en `categories.slug` **y** estar `active`.
2. `product_*.product_slug` debe existir en `products.slug`.
3. No se puede borrar una categoría con productos asociados (o se bloquea, o se
   desactiva).
4. `slug` único por hoja y no editable una vez publicado.
5. `sku` único en `products`.
6. `position` denso (1..N) por categoría de orden, y por producto en las hojas hijas.

---

## 5. Reglas de negocio → dónde se aplican

| Regla | Qué hace                                                                               | Hojas involucradas                             |
| ----- | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| R1    | Excluir `active = FALSE`                                                               | `categories`, `products`                       |
| R2    | Excluir productos con `registro_sanitario` vacío (solo en público)                     | `products`                                     |
| R3    | Devolver categorías ordenadas por `position`, sin exponer el campo                     | `categories`                                   |
| R4    | Destacados: activos + publicables + `featured`, máx. 6                                 | `products`                                     |
| R5    | Relacionados: misma categoría, excluye el propio, máx. 4                               | `products`                                     |
| R6    | Auditoría: productos ocultos + motivo (`inactive` / `missing_health_registry` / ambos) | `products`                                     |
| R7    | Integridad referencial, enums, slug inmutable                                          | todas                                          |
| R8    | Rechazar placeholders al guardar site/legal                                            | `site_config`, `legal_config`, `_placeholders` |

Además, un producto solo es **publicable** si: `active`, tiene
`registro_sanitario`, su categoría está `active` y tiene ≥ 1 imagen.

---

## 6. Estructura del proyecto Apps Script

Un solo proyecto, publicado como **Web App**, organizado en archivos por responsabilidad:

| Archivo      | Responsabilidad                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `Config`     | IDs (spreadsheet, carpeta de Drive), nombres de hojas, límites (6 destacados, 4 relacionados), TTL de caché                           |
| `Router`     | Punto de entrada GET/POST: lee la ruta, valida método, delega al controlador                                                          |
| `Auth`       | Validación del token de admin en rutas `/admin/*` y `/upload`                                                                         |
| `Repository` | Lectura/escritura genérica de hojas: convierte filas ↔ objetos usando los encabezados                                                 |
| `Services`   | Reglas R1–R6: filtros, orden, destacados, relacionados, ocultos                                                                       |
| `Assemblers` | Ensamblan `Product` completo (une `products` + imágenes + specs + faq) y `SiteConfig`/`Legal` (clave/valor → objeto, horarios, redes) |
| `Validators` | R7 y R8: integridad, enums, slugs, placeholders, RUC                                                                                  |
| `Admin`      | CRUD, reorder de categorías (con bloqueo), edición de site/legal                                                                      |
| `Media`      | Subida de imágenes a Drive y devolución de URL pública                                                                                |
| `Cache`      | Caché de lecturas e invalidación al escribir                                                                                          |
| `Audit`      | Escritura en `_audit_log`                                                                                                             |

### Mapeo de endpoints

Apps Script solo entiende GET y POST sobre una única URL. Dos opciones:

- **Opción A (recomendada):** una sola URL con parámetro `path`
  (`?path=/products/featured`). Para PUT/DELETE se usa POST con un campo
  `method` en el cuerpo.
- **Opción B:** poner un proxy delante (Cloudflare Worker, Netlify/Vercel
  rewrite) que traduzca rutas REST limpias a la Opción A.

El resto del contrato (§4 del doc original) se mantiene tal cual.

---

## 7. Limitaciones de Sheets/Apps Script y cómo mitigarlas

| Limitación                                            | Mitigación                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web App no permite fijar códigos HTTP (siempre 200)   | Responder con `{ "error": { "status": 404, "message": "…" } }`; el front (o el proxy de la Opción B) interpreta ese objeto. Documentarlo en el contrato |
| No hay control de cabeceras (`ETag`, `Cache-Control`) | Cachear dentro del script (`CacheService`) y que el front memoice por build, como ya hace                                                               |
| Sin claves foráneas ni transacciones                  | Validación en `Validators` + `LockService` en toda escritura (sobre todo reorder de `position`)                                                         |
| Lecturas lentas si se leen celdas una por una         | Leer siempre el rango completo de cada hoja de una vez y trabajar en memoria                                                                            |
| Cuota de ejecución (≈6 min) y de lecturas             | Pocas hojas, caché de 5–15 min, invalidar al escribir                                                                                                   |
| Un editor puede romper encabezados                    | Proteger la fila 1 de cada hoja y usar validación de datos (desplegables, casillas)                                                                     |
| CORS                                                  | Consumir la API en **build time** (servidor), no desde el navegador                                                                                     |
| Autenticación admin                                   | Token en _Script Properties_; nunca en la hoja ni en el repositorio                                                                                     |
| Imágenes                                              | Subir a una carpeta de Drive con acceso "cualquiera con el enlace" y guardar solo la URL pública en `image_url`                                         |
| Seguridad de datos                                    | La hoja **no se comparte** públicamente; solo el script (corriendo como el propietario) la lee                                                          |

---

## 8. Checklist de implementación

1. Crear el Spreadsheet con las hojas 1–11 y los encabezados exactos de §3.
2. Aplicar formato de **Texto plano** a columnas sensibles (`phone`, `ruc`, `opens`, `closes`, `value`).
3. Configurar validación de datos: desplegables (`availability`, `days`), casillas (`active`, `featured`), unicidad de `slug`/`sku`.
4. Proteger fila 1 y las hojas `_*`.
5. Crear carpeta de Drive para imágenes y anotar su ID.
6. Crear el proyecto Apps Script ligado al Spreadsheet con los archivos de §6.
7. Guardar IDs y token admin en _Script Properties_.
8. Implementar en orden: `Repository` → `Assemblers` → `Services` → endpoints públicos → `Validators` → `Admin` → `Media`.
9. Publicar como Web App (ejecutar como propietario; acceso: cualquiera, con token en rutas admin).
10. Probar el contrato público contra el front y los casos de R2/R8 (producto sin registro sanitario, dominio `example.com`).
11. Cargar datos reales (resolver los TODO de `site.ts`) antes de salir a producción.
