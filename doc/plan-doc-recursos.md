# Plan — Documentación de recursos y endpoints generada desde los schemas

> Estado: **fases 1-3 implementadas** (commit de este cambio); fases 4-5 pendientes.
> Fuente de verdad de este plan: `scripts/api-doc.mjs`, `scripts/contract-check.mjs`,
> `api/schema/resources/*.js` y `api/schema/endpoints/*.js`.

## 1. Objetivo

Generar documentación API **completa y verificable** a partir de los schemas
programáticos que ya existen en el back, sin escribir nada a mano:

- **Por recurso** (hoy falta): operaciones CRUD con `method` + `path`, request
  (campos, tipos, obligatoriedad, validadores, enums, defaults, hijos), response
  (proyección efectiva), políticas de acceso y campos generados.
- **Por endpoint custom** (hoy existe): fichas `input`/`output` con el mismo
  vocabulario que valida el router — ya lo genera `scripts/api-doc.mjs`.

La hipótesis del plan es correcta: si los schemas son construcción programática,
la documentación también puede derivarse de ellos. De hecho **el repo ya lo hace
parcialmente** — el trabajo es cerrar la brecha hacia los recursos CRUD.

## 2. Estado actual

| Pieza                                                | Existe | Cubre                                                                                                                                                            |
| ---------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/api-doc.mjs`                                | ✅     | Envelope, estándar de listados (`R6.4`), resumen y fichas de `REGISTRY.endpoints` (endpoints custom: dashboard, events, schema, upload-signature, auth, público) |
| `doc/api-endpoints.md`                               | ✅     | Salida commiteada, byte a byte con prettier                                                                                                                      |
| Gate `api:doc --check` dentro de `npm run api:check` | ✅     | ROJO si el doc está desincronizado del registro                                                                                                                  |
| **Documentación por recurso** (`REGISTRY.resources`) | ❌     | **No documenta** `GET/POST/PUT/DELETE /admin/<recurso>` con sus campos — el 100 % del CRUD                                                                       |

Es decir: la máquina existe, la fuente correcta también (`REGISTRY.resources`
declara `fields`, `operations`, `policies`, `listProjection`, `children`,
`computed`), sólo falta escribir el renderer por recurso y enchufarlo al mismo
pipeline con gate.

## 3. Reglas de la fuente

1. **El back manda.** La doc se genera desde `api/schema/resources/*.js`. El
   schema del front no aporta a esta documentación (su contract ya lo valida
   `contract-check.mjs` contra el back).
2. **Rutas reales, no hardcodeadas.** Usar las operaciones **proyectadas** del
   mismo modo que `contract-check.mjs` (`projectResourceSchema_(resource).operations`
   y `RUTAS_SERVIDAS`): una operación apagada (`operations.remove: false`) o un
   `405` deben reflejarse en la doc, no inventarse.
3. **Secrets jamás.** `type: 'secret'` (`pass_hash`, `pass_salt`,
   `token_version`) no aparece en request, response ni ejemplos (R7.6 — el doc
   no puede enseñar lo que la API nunca devuelve).
4. **Computados y `system: true`** se documentan como **campos generados por el
   back**: `computed: 'now'`, `create.computed[]` (`slugify`, `token`, `pin`,
   `copy`) — distinto de un campo que el cliente envía.
5. **Formato idéntico al actual.** Reutilizar `fieldRows_`/`rules_`/`esc` de
   `api-doc.mjs` (tabla Campo · Tipo · Obligatorio · Reglas) y pasar todo por
   prettier: la consistencia del doc es parte del producto.

## 4. Secciones que genera el documento por recurso

Para cada entrada de `REGISTRY.resources` (orden alfabético):

```text
## <id> — <título>

| kind | sheet | keyField | titleField | activeField | audiencia |
Identidad y metadatos del recurso.

### Operaciones
| Método | Path | Notas |
(list/get/create/update/remove + si create lleva computed, si remove es
soft vía activeField o hard, si reorder está apagado)

### Request — POST/PUT (campos del payload)
Tabla de fields del recurso: type · required · unique/immutable · reglas ·
default · enum/options. Hijos/children como subtabla con su key de
relación. Campos secret: OMITIDOS. Campos con computed: marcados
«generado por el back — el cliente no lo envía».

### Response — proyección efectiva
`listProjection` para listados y `fields − secret` para get. Nota del
envelope estándar (ya documentado arriba en el doc).

### Política
`policies.access` (read/write), `cache`, `audit`, `lock`, `exposeToFront`.
Si hay `audiences.public`, marcarlo.

### Errores típicos
422 por validadores con `VALIDATION_*` presentes en este recurso
(derivado del vocabulario, no inventado), 401/403 por política.
```

Ejemplo de esperanza (users, hoy):

- `create` aparece **sin** `computed` para `id` → el doc muestra `id`
  como obligatorio del cliente, lo cual haría visible la incoherencia actual
  del alta (ver §7).

## 5. Integración y gates

1. `scripts/api-doc.mjs` crece un bloque `buildResourceDocs(REGISTRY.resources)`
   que **antecede** a las fichas de endpoints custom en `doc/api-endpoints.md`
   (un solo documento: envelope arriba, recursos al medio, custom abajo).
2. `npm run api:doc` regenera; `node scripts/api-doc.mjs --check` ya corre dentro
   de `npm run api:check` → la doc nueva queda protegida contra drift con el
   mismo rojo que hoy.
3. Formateo con prettier dentro del script (byte a byte, como ya hace).
4. Verificación final: `npm run api:check` verde + diff del doc revisado a mano
   una primera vez.

## 6. Fases de implementación

1. ✅ **Renderer de recurso** — `resourceBlock_(resource)` en
   `scripts/api-doc.mjs`: identidad en una línea, operaciones proyectadas
   (mismo `projectResourceSchema_` que sirve `/admin/schema`), tabla de
   campos (cabecera `FIELD_HEADER` compartida), listProjection y política.
2. ✅ **Computados y children** — `generatedBy_()` marca
   `generado: create · uuid` / `generado: now` / `sistema`;
   `itemFields` (type: list) anida con prefijo `hijo.` (`history.at`).
   Los `secret` se filtran con `readable_()` (FIELD_TYPES.readable).
3. ✅ **Costura en el doc** — `resourceSection_()` con índice enlazado
   (`[id](#id)`, heading `### \`id\``), orden alfabético, entre
«Listados de recurso» y «Resumen»; regenerado y gate verdes
(4 tests nuevos en `api/**tests**/api-doc.spec.js`).
4. ⬜ **Errores por recurso** — derivar los `VALIDATION_*` aplicables de los
   validadores declarados en sus fields.
5. ⬜ **(Opcional) Ejemplos** — un `JSON` de request y uno de response por
   recurso, sintetizados de fields + defaults (siempre sin secrets).

Cada fase termina con `npm run api:doc --check` + `npm run api:check` verdes.

## 7. Decisiones abiertas

1. ✅ **Estructura** (decidido): un solo `doc/api-endpoints.md` — un solo
   contrato, un solo gate `--check`.
2. **OpenAPI 3.x exportable**: ¿sólo Markdown (recomendado por ahora) o además
   `openapi.json` para Swagger UI/Postman? Añade un segundo artefacto que
   también hay que sincronizar.
3. ✅ **Hallazgo resuelto ANTES de generar la doc** (commit `fix(users): ...`):
   el recurso `users` declaraba
   `create` sin `computed` para `id`, pero el front lo tiene
   `readonlyOn: 'always'` → el alta de usuarios hoy exige un `id` que nadie
   puede proveer (422 `required` en `24-crud.js:463`). Corregirlo ANTES de
   generar la doc evita documentar un contrato roto:
   - back: `create: { computed: [{ field: 'id', transform: '<nuevo: uuid>' }] }`
     (como `slug` en products/categories; hoy sólo existen `slugify`, `token`,
     `pin`, `copy` — habría que sumar `uuid` en `api/capabilities/computed.js`);
   - front: `hiddenOn: 'create'` para que el id no aparezca en el alta (mismo
     patrón que `ref`/`pin` en orders, ver comentario en
     `src/app/pages/form-view/form-schema.ts`).

## 8. Riesgos y gotchas

- **Drift**: cualquier doc generada vive o muere por el `--check`; nunca
  commitear la salida de una generación sin correr el gate.
- **Vocabulario `FIELD_TYPES`**: el renderer sólo puede imprimir tipos que el
  router valida; si aparece un tipo nuevo en resources, el doc debe mostrarlo
  tal cual (el validador de vocabulario de contract-check ya vigila el lado de
  validadores).
- **Rutas proyectadas**: derivar paths de `projectResourceSchema_`, no de
  `resource.id` a mano — hay operaciones con rutas propias (panel) y
  endpoints custom atados a recursos.
- **Prettier**: el doc se formatea en el generador; un formatter corrido a
  mano sobre el archivo genera ruido de diff.
