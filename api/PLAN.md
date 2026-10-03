# `api/PLAN.md` — Plan de implementación del backend (por fases)

> Ejecutar las fases **en orden**. Cada fase termina con su criterio de salida.
>
> - **Autoridad:** `doc/baseapi.md` (v2) — corrige `doc/api.md` y `api/README.md` v1.
> - **Contrato de datos:** `doc/api.md` §3 (13 hojas, columnas exactas).
> - **Front consumidor:** `src/app/` (ajustes en Fase 10).
>
> **Convenciones del agente (GAS):** sin `import`/`export` ni `class`; object
> literals; funciones globales; secretos/IDs sólo en Script Properties; cada
> archivo nuevo se agrega a `filePushOrder` en `.clasp.json` (orden de
> dependencia); nada de código de negocio en `setup/` ni de hojas en `core/`.
> Verificación del front: spec efímera → `ng test` → borrar → prettier → build.
>
> **Verificación remota (decisión del usuario):** toda corrida real en Apps
> Script (`clasp run`, seeds, drift, E2E) se hace **al final, en la Fase 11,
> todo en conjunto**. Entre fases: verificación lógica local efímera
> (harness con stubs GAS, fuera del repo) + `clasp push` sin errores.

---

## Estado de las mejoras (`PLAN-MEJORAS.md`)

| Fase                                                         | Estado                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F0–F7** (directriz: backend GAS 100% dirigido por esquema) | ✅ completadas — `schema/` es fuente única, `core/`/`engine/` genéricos, políticas declarativas, `/admin/schema` público y front alineado (evidencia fase a fase en `PLAN-MEJORAS.md`)                                                                  |
| **P** (prueba de éxito §12)                                  | ✅ completada — recurso nuevo `orders` creado con **1 solo archivo**, hoja por `setupDrift`, smokes 13/13 + audit directo, **cero ediciones fuera** (manifest 131→132→131); recurso retirado por decisión del usuario → deploy **v17**, regresión 11/11 |
| Guía de uso backend ↔ frontend                               | ✅ `doc/guia.md`                                                                                                                                                                                                                                        |

> Las fases 0–11 de este plan describen la implementación original. El
> plan de mejoras (F0–F7 + P) ejecutó sobre esa base la reescritura
> dirigida por esquema; las diferencias de alcance (p. ej. `rules/`
> eliminada en F4-5, `upload` limitado por endpoint en F6-3) están
> anotadas en el **Registro de decisiones** de `PLAN-MEJORAS.md`.

---

## Fase 0 — Preparación del entorno

**Objetivo:** proyecto clasp vivo, Cloudinary y documentos alineados a v2.

- [x] Sincronizar `api/README.md` con `baseapi.md` §2 y §13: auth por cuerpo
      (no `Bearer` header), `/admin/*` todo POST, sin `/upload`, `filePushOrder`
      en vez de orden alfabético, Cloudinary en vez de Drive, carpeta
      `schema/` como fuente única, `13-props`.
- [ ] Crear cuenta/_cloud_ de Cloudinary (una por entorno si es posible).
- [x] `clasp init` en `api/`: `appsscript.json` (V8, webapp, America/Lima),
      `.claspignore` (whitelist: sólo `appsscript.json`, `*.js`, `*.html`),
      `.clasp.json` local con `filePushOrder: []` — **no se commitea**
      (agregado a `.gitignore`: `.clasp*.json`; el `scriptId` vive sólo ahí);
      `clasp push --force` OK (script dev creado en la cuenta del usuario).
- [ ] Cargar manualmente en Script Properties (proyecto dev):
      `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`,
      `CLOUDINARY_BASE_FOLDER`, `ENV=dev`.

**Criterio:** `clasp push` sube sin errores; las 5 propiedades manuales existen.

---

## Fase 1 — Propiedades: manifiesto y acceso

**Objetivo:** todo valor sensible pasa por un único módulo (§10).

- [x] `00-config`: **manifiesto** de propiedades (nombre, `required`, `secret`,
      `source: manual|generated` + validación simple). Sólo nombres, **jamás
      valores**. (+ `CONFIG`: paso 1000, destacados 6, relacionados 4, TTL 300 s)
- [x] `core/13-props`: **único** punto de acceso a `PropertiesService`; lee
      una vez por ejecución y cachea en memoria; si falta una requerida →
      error 500 «falta configurar X» sin revelar valores.
- [x] `setup/00-check-properties`: lee el manifiesto → verifica `manual`
      (lista cuáles faltan y se detiene) → genera `generated` si no existen
      (**idempotente**: no regenera el token) → resumen sin secretos.
- [x] Función manual `rotar-token`: regenera token (se muestra **una vez** en
      el log), guarda sólo `ADMIN_TOKEN_HASH`.

**Criterio:** ~~check-properties corre en verde; segunda corrida no regenera
nada; borrar una propiedad manual → mensaje claro que nombra la propiedad.~~
Lógica verificada con harness efímero local (14/14: detiene con las 5 manuales,
genera token 1×, idempotente, rotación, sin secretos en salida). **Pendiente
corrida real:** `clasp run` exige proyecto GCP adjunto + props manuales de
Cloudinary.

---

## Fase 2 — `schema/`: fuente única de recursos

**Objetivo:** datos declarativos que gobiernan hojas, CRUD, validación, rutas,
orden y exposición (§3–§5, §15).

- [x] `schema/01-types`: los 20 tipos del catálogo (idénticos a la unión
      `FieldSchema` del front, `base.md` §5) + metadatos de almacenamiento.
- [x] `schema/02-enums`: `availability`, `risk_class`, `days` +
      `PLACEHOLDER_PATTERNS` (R8, seed de `_placeholders`).
- [x] `schema/03-resources-categories`: colección, `slug` inmutable,
      `ordering: positioned`, `onDelete: restrict`, `imageFolder: categories`.
- [x] `schema/03-resources-products`: colección con hijos (`images` list mín 1,
      `specs` key-value, `faq` list), `relation` → categories (sólo activas),
      `activeField`, reglas nombradas, `listProjection` (+ `listPick: images → primary`).
- [x] `schema/03-resources-site`: singleton KV, grupos `address`/`geo`
      aplanados, `hours` list, `social` string-list, regla `no-placeholders`.
- [x] `schema/03-resources-legal`: singleton KV, `last_updated` computado,
      reglas `no-placeholders` + `ruc-valid`.
- [x] `schema/04-registry`: índice de recursos → rutas `/admin/{id}`
      (resolución perezosa vía `getResourceSchema`).

**Criterio:** agregar un recurso estándar = 1 archivo + 1 línea de registro,
**0** código nuevo. Verificado con harness efímero local (~210 checks):
columnas exactas de `api.md` §3 en las 9 hojas, tipos ∈ catálogo, enums/FK/
registry válidos, hojas únicas, cero referencias cruzadas al cargar.

---

## Fase 3 — `setup/`: libro, hojas y evolución

**Objetivo:** libro correcto a partir del schema; re-corrido seguro (§13, §14).

- [x] `schema/05-aux-sheets`: columnas de `_enums` / `_placeholders` /
      `_audit_log` (fuente única; `_media` no existe con Cloudinary, §11.7).
- [x] `setup/01-setup-spreadsheet`: crea el libro (o reutiliza si ya hay
      `SPREADSHEET_ID`) — idempotente.
- [x] `setup/02-setup-sheets`: itera el registry → crea hojas con cabeceras
      desde `schema/` (columnas **nunca** hardcodeadas), Formato Texto plano en
      columnas sensibles (`value`, `phone`, `ruc`, `opens`, `closes`, slugs),
      validaciones de datos (enums, casillas), protege fila 1 — idempotente.
      Trae los helpers compartidos (`getSheetSpecs_`, `ensureSheet_`,
      `applyColumnStyle_`…) que usan 03 y 04.
- [x] `setup/03-setup-drift`: compara schema vs hojas → agrega columnas
      escalares y hojas hijas nuevas; **reporta** renombrados (huérfana + nueva)
      y columna obsoleta; **bloquea** cambio de tipo con datos incompatibles;
      actualiza `SCHEMA_VERSION` + `_audit_log`.
- [x] `setup/04-setup-seed`: puebla `_enums`, `_placeholders` y las filas KV
      de los singletons (14 site / 11 legal; sin carpeta de Drive).

**Criterio:** setup ×2 no duplica nada (criterio 4); campo escalar nuevo =
editar schema + correr setup (criterio 2); drift detecta un renombrado.
~~Verificado con harness efímero local (80/80):~~ Sí: 80 checks verdes tras
Prettier — setup ×2 idempotente (12 hojas, 0 en la 2ª), cabeceras exactas de
`api.md §3`, `@`/CHECKBOX/enum, seeds 14/11 filas, drift (agrega, renombra
→ huérfana, hoja hija nueva/retirada, bloqueo de tipo). **Corrida real
diferida a la Fase 11** (decisión del usuario). El harness encontró y se
corrigió un bug real: escribir el header con `getLastColumn()` post-inserción
sobrescribía la última columna (el índice se calcula antes de insertar).

---

## Fase 4 — `core/`: transporte y autenticación

**Objetivo:** envelope correcto para el navegador sin CORS (§2.1, §8).

- [x] `core/10-router`: `doGet`/`doPost` aceptan **POST** con cuerpo
      `text/plain` → JSON `{ token, method, path, payload }` (sin
      `application/json` ni cabeceras custom ⇒ sin preflight); extrae `method`
      antes de validar payload; resuelve `path` con `{key}` → parámetros y
      delega por tabla de rutas (recursos del registry + `EXTRA_ROUTES`
      `/admin/schema` y `/admin/upload-signature` cuyos handlers llegan en la
      Fase 9).
- [x] `core/11-auth`: hashea el token recibido y compara con
      `ADMIN_TOKEN_HASH` (comparación en tiempo constante); exige para
      `/admin/*` (incluye firma y schema); el token **nunca** va en URL ni a
      logs (se enmascara incluso en los stack traces antes de loguear).
- [x] `core/12-http`: siempre HTTP 200; éxito → JSON plano; error →
      `{ error: { status, message, errors?: [{ path, message }] } }`; estados
      400/401/404/409/422/500; **lista completa** de errores en 422 (criterio 8).
      `apiError_`/`validationError_` son la forma de señalar errores al router.
      (+ `13-props.require` lanza el error con `apiStatus = 500` ⇒ responde
      «Falta configurar la propiedad: X» sin valores.)

**Criterio:** ~~ninguna llamada desde el navegador usa cabeceras personalizadas
ni `application/json` (criterio 11)~~ → la mitad del navegador se cumple en la
**Fase 10** (hoy el front aún manda `Authorization` + `GET`); el backend ya
sólo acepta el contrato v2. **422 con 3 errores devuelve los 3 con ruta ✓**
(verificado con harness efímero local **42/42**: parseo en orden
method→path→payload, 401/500 de auth, rutas `{key}` → params con
decodeURIComponent, normalización de path, delegación por tabla, 409/422/500
sin fugas de token en respuesta ni logs). Corrida real → Fase 11.

---

## Fase 5 — `engine/`: pipelines genéricos

**Objetivo:** un solo motor parametrizado por schema (§8, §9).

- [x] `20-storage-map`: campo → columna (escalares y grupos con prefijo) /
      fila KV (singleton) / hoja hija (`list`, `string-list`, `key-value`).
- [x] `21-repo`: lectura por **rangos completos** y escritura por rangos;
      filas ↔ objetos vía cabeceras (mapping por nombre, orden irrelevante).
- [x] `22-assemble`: objeto anidado desde columnas/filas; hijos siempre con el
      padre; **proyección** de listado (`listProjection`) vs detalle completo.
- [x] `23-validate`: reglas declarativas (requerido, único, inmutable, enum,
      patrón, rangos, palabras, FK + `onlyActive`, mín/máx de lista, `active`) + **origen de imagen** (`https` y prefijo del _cloud_) acumulando **todos**
      los errores con ruta (incluidos items de lista).
- [x] `24-crud`: pipeline de escritura completo §8 (resolver → validar →
      reglas nombradas → lock → releer → fila principal + **reemplazo en lote**
      de hijos → campos de sistema/computados → auditar → invalidar caché →
      responder recurso armado) y de lectura (caché → rangos → armar → ordenar
      → proyectar).
- [x] `25-ordering`: el **backend es dueño de `position`** (§9): front envía
      _intención_ («mover X después de Y» / «al inicio»); dentro del lock
      calcula punto medio (paso 1000) y rebalancea; hijos: verdad = orden del
      arreglo, posiciones las asigna el backend; nuevos al final (última + paso).
- [x] `26-lock-cache`: `LockService` en toda escritura; caché **por recurso y
      troceada** (límite ≈100 KB/valor, TTL corto) con invalidación al escribir.

**Criterio:** guardar con 5 errores de validación devuelve los 5 (criterio 8);
dos escrituras simultáneas de reorder no corrompen `position` (criterio 9).

Verificado con harness efímero local **194/194** (push 26 archivos):
transporte/auth, proyección exacta, 422 con 5 errores y sus rutas, único e
inmutable, default **sólo al crear** (update no reactiva `active`), system
ignorado, reorder (toStart/after/404/400/rebalance a paso·1..N), relaciones
(inexistente/inactiva), 409 restrict con conteo `products (2)`, cascade-children
por padre, singleton KV + horas/redes en lote, saneado de ítems vacíos,
lock ocupado → 409, caché por generación (miss/hit/invalidación) y troceado.
Corrida real → Fase 11.

---

## Fase 6 — `rules/`: reglas nombradas

**Objetivo:** lo singular, declarado por nombre e implementado aparte (§7, §16).

- [x] `30-registry`: registro nombre → función pura (filtro/vista/validador/
      computado); los resources las referencian por nombre.
      **Hooks que el motor ya invoca en runtime** (si no existen, se omite):
      `computeRules_(resource, payload, opts)` con `opts = { isNew }` — derive
      `slug-from` **sólo al crear** (slug es inmutable en update);
      `validateRules_(resource, scalars, ctx)` con
      `ctx = { ss, isNew, key, current, children }` → `[{ path, message }]`.
      Ambas SIEMPRE se ejecutan (acumulan en el mismo 422) y deben tolerar
      payloads rotos.
- [x] `31-catalog-rules`: `publishable` (R1+R2), `featured` (máx 6), `related`
      (máx 4), `hidden-with-reason` (R6).
- [x] `32-validators`: `no-placeholders` (R8 desde `_placeholders`),
      `ruc-valid` (11 dígitos), `slug-from`.

**Criterio:** ninguna regla está escrita dentro del engine; una regla nueva =
1 función + 1 entrada en `30-registry`.

Verificado con harness efímero local **31/31** (push 29 archivos): 7 reglas
resueltas con su kind y 500 por nombre/impl ausente o desconocido, despacho
sólo por kind, `slug-from` sólo al crear con `slugify_` réplica del front,
`no-placeholders` (fallback `PLACEHOLDER_PATTERNS`, hoja `_placeholders`
manda, case-sensitive, rutas `group.key`/`social[i]`/`faq[0].question`/
`specs[0].key`), `ruc-valid` sin duplicar el path del pattern, `publishable`
fail-closed, `featured`/`related` con tope `CONFIG`, `hidden-with-reason`
literal R6 con copias, e integración: UN SOLO 422 declarativo + nombrado en
legal y site. Nota: el docstring de `slugify.ts` (`lomo-saltado-nonio`) es
typo — `Ñoño` → `nono`; la réplica sigue al código, no al comentario.
Corrida real → Fase 11.

---

## Fase 7 — CRUD genérico: `categories` y `site`

**Objetivo:** primeros dos recursos end-to-end por el motor (§17.8).

- [x] El router despacha `/admin/categories` y `/admin/site` al motor
      genérico (`engine/24-crud`, antes planificado como `40-crud`) usando el
      registry (**sin** handlers por entidad).
- [x] `categories`: posición con intención (criterio 9), `slug` inmutable,
      borrar con productos asociados → 409 con motivo (criterio 10).
- [x] `site`: GET armado (KV + `hours[]` + `social[]`), PUT que reescribe en
      lote, `no-placeholders` → 422 con rutas.

**Criterio:** los dos recursos funcionan completos (list/get/create/update/
delete) sólo con sus definiciones de Fase 2.

Verificado con harness efímero end-to-end **32/32** vía `doPost` real con
entorno GAS falso (spreadsheet/caché/lock/props en memoria) y TODO el
`filePushOrder` cargado (28 archivos): superficie (401/400/404), categorías
completas (slug derivado, posiciones 1000·step, proyección exacta, caché,
detalle completo, update, slug inmutable, único, reorder `after`/`toStart`
con posiciones estrictamente crecientes, 409 `products (1)`, delete,
auditoría create/update/reorder/delete), site (GET armado KV+hhijos, PUT en
lote preservando `type`/`note`, caché invalidada, 422 declarativo+R8 con
rutas `name`/`description`/`social[0]`, 400 crear/borrar singleton) y el
criterio estructural: `core/` y `engine/` sin nombres de entidad.
**Fix encontrado:** `cacheInvalidate_` usaba `Date.now()` como generación —
dos escrituras en el mismo milisegundo reusaban la generación y una lectura
posterior devolvía datos obsoletos; ahora la generación es única por
invalidación (timestamp + sufijo). Corrida real → Fase 11.

---

## Fase 8 — `products`: hijos, FK y reglas

**Objetivo:** el recurso con más relaciones (§15).

- [x] `products` CRUD con reemplazo **en lote** de `product_images`,
      `product_specs`, `product_faq` dentro del lock.
- [x] FK `category_slug` → sólo categorías activas (422 con ruta si no).
- [x] Mínimo 1 imagen validado al guardar el padre; `updated_at` computado.
- [x] Reglas `publishable`/`featured`/`related`/`hidden-with-reason` conectadas
      por nombre; listado con **proyección**, detalle completo.

**Criterio:** producto con hijos se guarda en un solo PUT; listado no devuelve
hijas completas; categoría inactiva rechaza con 422 en `category_slug`.

Verificado con harness efímero end-to-end **35/35** vía `doPost` real con
entorno GAS falso y TODO el `filePushOrder` cargado (setup incluido:
`setupSheets()` deriva las cabeceras del schema). Cubre: hojas creadas desde
schema, proyección exacta del listado (sin hijas completas, `images` con
`listPick`), detalle completo, caché, vistas/filtros por nombre
(`filter: publishable` → conjunto exacto · `view: featured` tope 6 sobre 7
candidatos · `view: related` con `key` tope 4/sin self/`[]`/404 ·
`hidden-with-reason` con motivos literales · 400 por nombre no declarado o
kind equivocado), crear con hijos en lote + slug derivado + `updated_at`
computado, 422 con ruta (slug duplicado, imagen de otro cloud, sin imágenes,
categoría inactiva/inexistente, `description` minWords), PUT quirúrgico por
hijo con merge de escalares, slug inmutable, auditoría create/update, 409
restrict, site/401/400 de sanidad y criterio estructural (core/engine/rules
sin literals de entidades).

**Hallazgo de diseño:** filter/view operan sobre los Ítems PROYECTADOS —
`featured` no estaba en `listProjection` y R4 devolvía `[]`; añadido al
schema (listProjection es contrato de lectura, no de hoja: sin `setup`) y
documentado el contrato en `rules/31`. Corrida real → Fase 11.

---

## Fase 9 — Rutas propias y auditoría

**Objetivo:** lo no genérico: firma Cloudinary, schema al front, trazas (§11,
§12).

- [x] `routes/40-upload-signature`: autenticado; entrada
      `{ resource }` → fija **el backend** carpeta
      (`CLOUDINARY_BASE_FOLDER` + `imageFolder`), timestamp, formatos
      permitidos; firma con `CLOUDINARY_API_SECRET`; salida `cloud_name`,
      `api_key`, `timestamp`, `signature`, `folder`, `allowed_formats`, URL de
      subida; **nunca** `api_secret`; caducidad corta; rate-limit por caché.
- [x] `routes/41-schema`: proyección del schema por recurso (campos, tipos,
      required, enums, patrones, rangos, relaciones, orden, `listProjection`);
      **jamás** expone hojas, columnas internas, token ni propiedades.
- [x] `50-audit`: append en `_audit_log` de create/update/delete/reorder y
      cambios de `SCHEMA_VERSION`.

**Criterio:** `api_secret` no aparece en respuesta, log, hoja ni repo
(criterio 5); `/admin/schema` sólo devuelve campos públicos de UI.

**Notas de la corrida:** firma = `{allowed_formats, folder, timestamp}`
ordenados alfabéticamente + secreto → SHA-1 hex; carpeta normalizada en ambos
extremos; rate-limit por recurso 10/min en caché (ventana de 60 s, después de
validar el recurso). `/admin/schema` usa lista blanca explícita de claves
(18 por campo; `enum` de string → array vía `SHEET_ENUMS`; `relation` plano).
`appendAuditRow_`/`nowStamp_` reubicadas de `setup/03` a `50-audit.js`.
Harness efímero: 208 checks (estructura + setup idempotente + firma
verificada con node crypto + 400/401/429 + proyección + CRUD audité +
fugas de secretos) → borrado; prettier limpio; `clasp push` ✓. Corrida real
→ Fase 11.

---

## Fase 10 — Ajustes del front Angular

**Objetivo:** el admin habla el contrato v2 (§2.3, §17.10).

- [x] `api.service.ts`: enviar **todo** `/admin/*` por POST con cuerpo
      `text/plain` (JSON `{ token, method, path, payload }`); `method: 'GET'`
      también para lecturas; token desde `ADMIN_TOKEN` al cuerpo (quitar header
      `Authorization` del `auth.interceptor` — borrado; método genérico
      `request()` para reorder/schema/firma).
- [x] `upload.service.ts` + campo `image`: **borrar** subida multipart a
      `/upload`; flujo en dos pasos → pedir firma a
      `/admin/upload-signature` → subir directo a Cloudinary → guardar
      `secure_url`; miniaturas por transformación de URL. El campo recibe el
      recurso vía input `resource` (hilo por `FieldHost`/`FormView`).
- [x] `list-view.ts` reorder: enviar **intención** («X después de Y» / «al
      inicio») en vez de posiciones calculadas: `{ reorder: { key, after |
  toStart | toEnd } }`, UNA sola escritura, respuesta = listado fresco del
      backend; `gap-sorting` quedó sólo en campos con listas locales.
- [x] Opción `/admin/schema`: fetch + merge por `key` con la capa de
      presentación local (fallback: schema local si falla) — `SchemaService`
      en el initializer de `app.config` (timeout 4 s), señal en `registry`,
      `schema-merge.ts` local-driven (no agrega campos del backend).
- [x] Verificación efímera: specs temporales de contrato (envelope, 422 con
      rutas, subida en dos pasos, merge de schema, intención de reorder)
      → 24/24 en verde → borrados → prettier ✓ → `ng test` ✓ → build dev ✓.

**Criterio:** el admin funciona contra el backend real con estas 4 reglas; sin
especificaciones `application/json` ni cabeceras custom en las llamadas.

---

## Fase 11 — Publicación y verificación E2E

**Objetivo:** web app en producción y criterios aceptados (§17.11).

- [ ] `.clasp.json` final con `filePushOrder` completo (uno por entorno);
      `clasp push` + `clasp deploy` (web app: ejecutar como propietario,
      acceso cualquiera; token sólo en el cuerpo).
- [ ] Setear `API_URL` en el front (build) apuntando a la web app; probar
      **desde el navegador** (CORS real): carga, guardado, 422, 409, subida a
      Cloudinary.
- [ ] Entorno prod: proyecto Apps Script + libro + Script Properties
      **separados**, `ENV=prod`, clasp config propio (criterio 12).
- [ ] Verificar y marcar los **12 criterios de aceptación** (abajo).
- [ ] Cierre: `mem_save` + `mem_session_summary`.

**Criterio:** los 12 criterios marcados; el admin opera de punta a punta.

---

## Criterios de aceptación (`baseapi.md` §17.2)

- [ ] 1. Recurso estándar nuevo = 1 archivo en `schema/` + registro; sin código.
- [ ] 2. Campo escalar nuevo = editar schema y correr setup.
- [ ] 3. Setup falla con mensaje claro si falta una propiedad `manual`, sin valores.
- [ ] 4. Re-ejecutar setup no regenera token ni duplica nada.
- [ ] 5. `API secret` de Cloudinary no aparece en respuesta, log, hoja ni repo.
- [ ] 6. Imagen desde el admin llega directo a Cloudinary y el campo guarda `secure_url`.
- [ ] 7. `image_url` de otro dominio/_cloud_ → 422 con ruta del campo.
- [ ] 8. 422 con todos los errores con ruta, incluidos items de lista.
- [ ] 9. Reorder con dos admins simultáneos no corrompe `position`.
- [ ] 10. Borrar categoría con productos → 409 con motivo.
- [ ] 11. Ninguna llamada del navegador usa cabeceras custom ni `application/json`.
- [ ] 12. Dev y prod con proyectos, libros y propiedades separados.
