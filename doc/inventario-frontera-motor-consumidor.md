# Inventario de frontera: motor (npm) ↔ consumidor (este repo)

> Contexto: split en dos repos. El **repo del motor** publica `@tinya-code/gas-admin`
> en npm (runtime GAS materializable + CLI + validador). Este repo (`admin-schema`)
> pasa a ser el **consumidor**: conserva el front Angular, declara su dominio en
> `schema/` y recibe el runtime por `generate`. Los tests se quedan en el repo del
> motor y **no se publican** en npm (sólo entra el whitelist de `files`, verificable
> con `npm pack --dry-run`).
>
> Documento generado 2026-10-14 como F0 reorientado (reemplaza la propuesta
> frontend-first de 4 paquetes: ver `propuesta-libreria-npm-generador-appsscript.md`,
> hoy desactualizada).

## Criterio de clasificación

1. **¿Se puede reusar tal cual en otro proyecto GAS?** Sí → motor.
2. **¿Hardcodea un dato/entidad de este admin** (`products`, `orders`, `pickpass`,
   `availability`, `America/Lima`, rutas `/p/orders/…`)? → consumidor.
3. **¿Es una declaración dirigida por el dominio** (un endpoint que lista `resource:
['orders']`)? → consumidor; el motor provee el mecanismo.
4. **¿Necesita secretos/scriptId de este proyecto?** → consumidor (nunca npm).

## A. Runtime del motor (publica npm · `generate` lo materializa)

| Archivo                                                                                                                                                                   | Clase | Por qué                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-registry.js`                                                                                                                                                          | motor | `REGISTRY` global + auto-registro: la raíz del mecanismo.                                                                                                                     |
| `00-config.js`                                                                                                                                                            | motor | `CONFIG` (límites: KDF, TTL, upload) + `PROP_MANIFEST` con 13 props, **todas infra** (Sheets, auth, Cloudinary, ENV, KDF, triggers, admin) — verificado sin props de dominio. |
| `50-audit.js`                                                                                                                                                             | motor | Auditoría de escrituras, dirigida por `REGISTRY`.                                                                                                                             |
| `core/10-router.js`                                                                                                                                                       | motor | Tabla de rutas derivada 100 % de `REGISTRY` (Fase 2).                                                                                                                         |
| `core/11-auth.js`                                                                                                                                                         | motor | Sesión, tokens, KDF.                                                                                                                                                          |
| `core/12-http.js`                                                                                                                                                         | motor | Helpers HTTP/envelope.                                                                                                                                                        |
| `core/13-props.js`                                                                                                                                                        | motor | Carga de ScriptProperties según `PROP_MANIFEST`.                                                                                                                              |
| `engine/20-storage-map.js` … `36-notifications.js` (17)                                                                                                                   | motor | Todo dirigido por declaraciones: la Fase 1–9 demostró cero cambios de motor al añadir/quitar recursos.                                                                        |
| `capabilities/00-register.js`, `adapters.js`, `hooks.js`, `operators.js`, `validators.js`, `computed.js`, `fieldTypes.js`, `checks.js`                                    | motor | Vocabularios y mecanismos parametrizados por declaration.                                                                                                                     |
| `capabilities/handlers/` → `audit-prune`, `auth`, `dashboard`, `events`, `pin-regenerate`, `pin-verify`, `public-order`, `schema`, `sheet-drift`, `upload-signature` (10) | motor | Genéricos: leen `endpointDecl`/`resource`/`audiences` declarados (p. ej. `public-order` sólo expone lo que el recurso declara).                                               |
| `schema/05-aux-sheets.js`                                                                                                                                                 | motor | Fuente única de columnas de hojas auxiliares (`_enums`, `_placeholders`, `_audit`).                                                                                           |
| `schema/validate-registry.js`                                                                                                                                             | motor | Validador de declaraciones del consumidor (base de `validate`).                                                                                                               |
| `setup/00-check-properties.js` … `07-setup-triggers.js` (8)                                                                                                               | motor | Setup idempotente dirigido por `REGISTRY`; el seed puebla singletons desde las declaraciones del consumidor.                                                                  |

## B. Código del consumidor (queda en este repo)

| Archivo                                                                                            | Por qué                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema/resources/*.js` (8: categories, dashboard, legal, orders, pickpass, products, site, users) | El dominio de este admin — exactamente lo que el consumidor "sólo declara".                                                                                                                                    |
| `schema/enums/02-enums.js`                                                                         | Vocabulario de dominio (`availability`, etc.).                                                                                                                                                                 |
| `capabilities/handlers/hidden-list.js`                                                             | Escape hatch §6: hardcodea la OR `active`/`registro_sanitario` de **products**. Es el patrón de "código propio del consumidor" (ver G-2).                                                                      |
| `schema/endpoints/dashboard.js`                                                                    | Declara `resource: ['orders']` — datos de dominio (el handler es genérico).                                                                                                                                    |
| `schema/endpoints/public-order.js`                                                                 | Ruta `/p/orders/:ref` y audiencia de **orders** — datos de dominio.                                                                                                                                            |
| `schema/endpoints/pin-verify.js`                                                                   | **Movido a consumidor por E2E del paquete (F0-B)**: hardcodea `resource: 'orders'` y define `grantProfiles.pickupGrant`. El handler `pin-verify` es genérico (motor); el binding de dominio es del consumidor. |
| `schema/endpoints/upload-signature.js`                                                             | **Movido a consumidor por E2E del paquete (F0-B)**: define `uploadProfiles.pickupPhoto` con `resource: 'orders'`. El handler es genérico (motor).                                                              |
| `appsscript.json`                                                                                  | Instancia del proyecto GAS (el `timeZone: America/Lima` es de esta app). El motor provee un template (G-4).                                                                                                    |
| `.claspignore`, `.clasp.json` (gitignored), `.gas-smoke.env` (gitignored)                          | Configuración/secretos locales del proyecto.                                                                                                                                                                   |
| `doc/api-endpoints.md`, `doc/orders-endpoints.md`                                                  | Doc generada del schema propio de este admin.                                                                                                                                                                  |
| `src/` (front Angular completo), `.github/workflows/ci.yml`                                        | El otro motor y su CI — fuera del alcance del split back.                                                                                                                                                      |

## C. Tests del motor (repo del motor · **fuera de npm**)

| Archivo                                                                       | Por qué                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| `__tests__/*.spec.js` (59) + `_harness.js`, `_auth-fixtures.js`, `_sheets.js` | Prueban el runtime del motor con fixtures propias.      |
| `fixtures/*.json` (11)                                                        | Oro de respuestas del motor (er-4xx, schema-get, etc.). |
| `scripts/api-regression.sh`                                                   | Runner local de regresión del motor.                    |

## D. Tooling → `bin/` del paquete npm

| Script actual                                   | Verbo futuro               | Notas                                                                     |
| ----------------------------------------------- | -------------------------- | ------------------------------------------------------------------------- |
| `scripts/contract-check.mjs` (+ `api-check.sh`) | `gas-admin validate`    | Validador offline ya existente; corre en el consumidor contra su schema.  |
| `scripts/api-doc.mjs`                           | `gas-admin doc` (G-6)   | Genera la doc de endpoints desde el registro del consumidor.              |
| `scripts/sheet-drift-check.mjs`                 | `admin-schema drift`       | Compara la hoja viva vs el schema; usa credenciales del consumidor.       |
| `scripts/smoke-auth.mjs`                        | `admin-schema smoke` (G-5) | Smoke contra el GAS desplegado; necesita scriptId + creds del consumidor. |
| `scripts/audit-prune.mjs`                       | `admin-schema audit` (G-5) | Runner local de la auditoría con credenciales.                            |

## E. Docs de desarrollo del motor (repo del motor)

`api/MAPA.md`, `api/PLAN.md`, `api/PLAN-MEJORAS.md`, `api/mejoras.md`, `api/README.md`.

## G. Indeterminados — a decidir en F0

| #   | Tema                                                                                                                                                   | Opciones                                                                                                                                                              | Recomendación                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-1 | **Endpoints infra built-in** (`schema/endpoints/{auth,schema,audit-prune,sheet-drift}.js` — sólo4 tras el E2E): ¿quién los trae?                       | A) El motor los shipea como defaults y el consumidor puede borrar/sobrescribir. B) El motor los publica como template y el consumidor los copia en `init`.            | **A**, validado en F0-B: el E2E con `pin-verify`/`upload-signature` demostró que un "built-in" con `resource: 'orders'` rompe el validador de registry en un consumidor limpio ⇒ los endpoints con binding de dominio **no** son built-ins (van al consumidor). |
| G-2 | **Código propio (escape hatch)**: `hidden-list` hoy vive en `capabilities/handlers/` y se auto-registra. ¿Ese es el patrón público?                    | A) El consumidor pone sus handlers en `capabilities/handlers/` (carpeta ownable) y el mecanismo de registro del motor los levanta. B) Carpeta dedicada `extensions/`. | **A** por ahora (cero cambios de motor necesarios); documentarlo como contrato §6 del paquete.                                                                                                                                                                  |
| G-3 | **`PROP_MANIFEST` extensible**: hoy las 13 props son todas infra. Si el consumidor necesita props propias (p. ej. una API key suya), ¿cómo se agregan? | A) El consumidor concatena su manifest tras la del motor. B) El motor expone `addProperties([...])`.                                                                  | **A** (simple, sin API nueva).                                                                                                                                                                                                                                  |
| G-4 | **`appsscript.json`**: template vs instancia.                                                                                                          | A) El motor publica template; `init` crea la instancia del consumidor (timeZone, etc. editables). B) Se queda sólo en el consumidor sin template.                     | **A**.                                                                                                                                                                                                                                                          |
| G-5 | **`smoke`/`audit` como bin**: corren con secretos reales.                                                                                              | A) Verbos del paquete que leen `.gas-smoke.env` local del consumidor. B) Scripts que se quedan en el repo del consumidor.                                             | **A**: son genéricos; el consumidor no debe reimplementarlos.                                                                                                                                                                                                   |
| G-6 | **`api-doc` como verb**: la doc generada es del schema del consumidor.                                                                                 | A) Verbo del paquete (`gas-admin doc`). B) Tool del repo del motor.                                                                                                | **A**.                                                                                                                                                                                                                                                          |
| G-7 | **Loop de desarrollo motor→consumidor**: cada cambio de motor requiere publicación.                                                                    | A) `npm pack` + tarball local (iteración rápida sin publicar). B) `file:../motor-gas`. C) Publish semver por cada cambio.                                             | **A** + publishes para releases; `file:` rompe la validación del contrato público real.                                                                                                                                                                         |

## Resumen de conteos

| Clase                                 | Archivos              |
| ------------------------------------- | --------------------- |
| Runtime del motor (publicables)       | 56 (manifest)         |
| Consumidor (este repo)                | ~20 + `src/` completo |
| Tests + fixtures (repo motor, no npm) | 73                    |
| Tooling → bin paquete                 | 7 + loader            |
| Docs de desarrollo motor              | 5                     |

## Evidencia F0-B (E2E con tarball)

`npm pack` (71 archivos, 207 kB, sin tests/resources/secrets) + instalación
por tarball en un proyecto scratch: `init` materializa 56 archivos + templates,
`validate` en consumidor bare y con recurso propio, `doc` genera
`doc/api-endpoints.md`; ciclo completo exit 0. El E2E destapó 3 bugs reales
que el split causaría en producción: `prettier` debía ser dependencia de
runtime del paquete; el cargador del backend (`_load-backend.mjs`, antes
`__tests__/_harness.js`) es infraestructura del paquete, no de tests; y
`pin-verify`/`upload-signature` no pueden ser built-ins mientras hardcodeen
`resource: 'orders'`.

## Próximo paso (F0-B)

1. ✅ Crear el repo del motor y mover: C (tests) + E (docs) + A (runtime) + D (tooling),
   con su CI propia (949 tests + regresión).
2. ✅ `package.json` del paquete: `files: [bin, scripts, templates, manifest]`,
   `bin: { admin-schema }` con7 verbos.
3. ✅ Transformar este repo en consumidor (2026-10-14): validación previa
   (generate sobre copia de `api/` = idéntico byte a byte) → corte →
   `api/` = 18 ficheros de dominio + runtime regenerado (git limpio para el
   runtime), scripts → verbos del CLI, CI reducida (sin tests back), suite
   front 604/604, `api:check` vía `gas-admin validate --with-front` verde,
   prettier baseline **9** (la deuda de `api/fixtures` y `api/PLAN*` se fue
   con el motor).
4. Pendiente: primer prerelease (`npm publish`) — requiere login npm + scope
   `@tinya-code`; loop local con `npm pack`.
