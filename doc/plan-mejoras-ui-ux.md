# Plan de mejoras UI/UX — Panel administrativo

> **Base:** `doc/ui-ux.md` (guía) + inventario de iconos Lucide (`@lucide/angular@1.51.0`).
> **Fecha de diagnóstico:** 2026-10-03 · sobre el HEAD post-plan de schemas separados.

---

## 0. Diagnóstico: qué ya está (no duplicar)

La guía asume un panel por construir. El real ya cumple bastante. **Antes de tocar nada, esto NO se reimplementa:**

| Guía                            | Estado                        | Evidencia                                                                                               |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| §2 etiqueta asociada al control | ✅                            | `field-host.ts:128` `<label [for]>`, control con `[id]="state().name()"` (`text.ts:22`, `select.ts:12`) |
| §2 obligatorios con `*`         | ✅                            | `field-host.ts:130-132`                                                                                 |
| §2 ayuda + error debajo         | ✅                            | `field-host.ts:249-254`, error con `role="alert"`                                                       |
| §2 contador de caracteres       | ✅                            | `textarea.ts:48` lee `validators.maxLength`                                                             |
| §1 switch para Sí/No            | ✅                            | `boolean.ts:16` checkbox `peer-checked`                                                                 |
| §1 dropzone con drop            | ✅                            | `image.ts:60,92` `dragover`/`drop`                                                                      |
| §1 chips en selección múltiple  | ✅                            | `multiselect.ts:17,28`                                                                                  |
| §4 secciones colapsables        | ✅                            | `group.ts:33` `collapsible` con `<details>`, auto-abre si `hasProblem()`                                |
| §4 secciones/pestañas           | ✅                            | `form-view.ts:274` `layout.mode: 'sections' \| 'tabs'`, `:121` `role="tablist"`                         |
| §4 aviso al salir con cambios   | ✅                            | `unsaved-changes.guard.ts` registrado en `shell.routes.ts:23,28`                                        |
| §3 dos columnas en escritorio   | ✅                            | `sm:grid-cols-12` + `col-span.ts` por campo                                                             |
| §6 doble envío                  | ✅                            | `form-view.ts:196` `[loading]` + `[disabled]`, `:101` `aria-busy`                                       |
| §6 delete con confirmación      | ✅                            | `list-view.ts:544` `notifications.confirm`                                                              |
| §8 focus trap y Esc en modal    | ✅                            | `modal.ts:13,56-66`, `role="dialog"`                                                                    |
| §8 foco visible global          | ✅                            | `base.css:22` `:focus-visible` (WCAG 2.4.7)                                                             |
| §7 estilo de error              | ⚠️ **listo pero sin cablear** | `base.css:56` `.field-input[aria-invalid='true']` existe, nadie setea el atributo                       |

**Conclusión del diagnóstico:** el panel no está roto. Las brechas son de _terminar_ lo empezado (aria, errores), de _añadir_ lo que la guía pide y no existe (borrador, progreso, sticky, dark, iconos), y de _acceso_ (dropdowns con búsqueda). No hay que rediseñar.

---

## 1. Criterio de priorización

Ordenado por **valor ÷ costo**, con dependencias explícitas:

1. **Fundación primero** — sin tokens de superficie no hay modo oscuro coherente (Fase 1 bloquea Fase 7).
2. **Terminar antes que añadir** — `aria-invalid` ya tiene CSS; cablearlo es barato y cierra una brecha de accesibilidad real.
3. **Lo visible y barato** — iconos: 15 sitios con emoji/unicode, cambio cosmético de bajo riesgo y alta percepción.
4. **Lo que dolió a un usuario** — borrador perdido y Guardar fuera de pantalla en formularios largos.
5. **Diseño solo cuando haya demanda** — ver §7 "Qué NO hacemos".

### Alcance real (esto define el esfuerzo)

Recuento de campos por recurso — **el techo es `products` con 19**:

| Schema       | Campos | Groups |
| ------------ | ------ | ------ |
| `categories` | 8      | 0      |
| `site`       | 11     | 2      |
| `legal`      | 11     | 0      |
| `products`   | 19     | 0      |

Eso calibra toda la guía: caemos en la banda **9–20 → secciones con título** (§4), que **ya existe**. Ver §7.

---

## Fase 1 — Fundación visual (tokens)

> **Verificado el 2026-10-04** (y **re-verificado** al cerrar 1.4 y 2.9): estos
> dos bloques se construyeron en su día pero **nunca se marcaron**. Aquí está la
> comprobación real contra el código, con las **desviaciones respecto del enunciado
> literal** de cada tarea: se marca ✅ cuando se cumple el _efecto_ que pedía el
> criterio de salida, y se anota lo que no se hizo tal cual.

**Fase 1 — hecha, con desviaciones de forma; 1.4 cerrada después:**

| Tarea                  | Estado                    | Evidencia                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 altura 40 px       | ✅ _desviación_           | `base.css:60` → `min-height: 40px` en `.field-input`, con el comentario del por qué (sin esto emerge 38 px y varía por tipo). **No existe el token `--control-h`**: el 40 px vive hardcodeado. El efecto (altura uniforme) se cumple.                                                                                                                                                                                                                                                                                            |
| 1.2 superficie         | ✅ _desviación_           | `--color-surface: #fff` en `theme.css:26` (prefijo `--color-` porque Tailwind v4 los lee de `@theme`). Queda **1** `bg-white` en toda la app: el knob del switch. **No existen** `--surface-raised`, `--surface-sunken` ni `--border`: se diferieron a propósito a la 8.1 (ver comentario `theme.css:21-25`).                                                                                                                                                                                                                    |
| 1.3 `--radius`         | ✅ _desviación_           | `base.css:49` usa `var(--radius-lg)` — antes era un mágico `.5rem`; cards con `rounded-xl`. **No hay un `--radius` propio**: se usa el que emite Tailwind en `:root`. El efecto (radio unificado) se cumple.                                                                                                                                                                                                                                                                                                                     |
| 1.4 escala tipográfica | ✅ **cerrada 2026-10-04** | Tokens `--text-section: 18px`, `--text-label: 14px`, `--text-help: 12px` en `@theme` (`theme.css:45-50`) con sus `--text-x--line-height`. Comprobado en el CSS construido: `.text-section{…line-height:var(--tw-leading, var(--text-section--line-height))}`. Sustituidos los `text-sm`/`text-xs` de `field-host.ts` (etiqueta ×2, ayuda, error) y los `text-lg` de `group.ts` (×2), `form-view.ts`, `drawer.ts`, `modal.ts`. **Desviación:** la guía pide `--fs-*`; en Tailwind v4 no genera utilidades, por eso es `--text-*`. |
| 1.5 contraste AA       | ✅                        | Medido y anotado en `theme.css`: `--color-danger`/`--color-success` 4.83:1 y 5.47:1 con texto blanco; `accent`/`secondary` como texto dan 1.91:1 y 2.94:1 (**fallan**) → por eso existe `--color-accent-text` (#92400e).                                                                                                                                                                                                                                                                                                         |
| 1.6 checks verdes      | ✅                        | `prettier --check`, `ng build` y `npm test` en verde.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Fase 2 — hecha; el árbol se cerró después:**

- **2.1–2.8 ✅.** Verificado a ciegas: **cero** `↑ ↓ ✕ × ⠿ ▲ ▼` en los 9 componentes que lista el plan, y **11** archivos importan `@lucide/angular` (recuento verificado el 2026-10-04). (Los dos `✕` que quedan en `modal.ts` están en **comentarios**, describiendo el botón.) Los `⚠`/`✓` de `form-view.ts` **no eran parte de la Fase 2** — son la decisión A de la 5.3, y van con `aria-hidden`.
- **2.9 ✅ cerrada el 2026-10-04.** El baseline de 572 K no era reproducible sin un commit; ahora sí: tres construcciones medidas con el mismo criterio → baseline `HEAD` **539,4 K** raw / 155,0 K gz · actual **624,9 K** / 167,0 K · mismo código sin Lucide 568,9 K / 162,4 K. **Lucide = +56,0 K / +4,6 K gz (9 %)**. Tree-shaking 15/15 presentes, 8/8 ausentes. Tabla y método en _Notas de ejecución — Fases 1 y 2_.
- **2.10 ⏳ parcial.** `npm test` y `ng build` verdes ✓; el **smoke visual** de los 4 recursos sigue pendiente, igual que el 5.9.

---

> **Por qué primero:** es prerequisite de modo oscuro (Fase 7) y da consistencia a todo lo demás. Sin esto, cada fase siguiente pega valores sueltos.

- [x] 1.1 Definir en `src/styles/theme.css` el token de **altura de control** (`--control-h: 40px`, guía §7) y aplicarlo en `.field-input` (`base.css:37`) — hoy el alto emerge de `padding .5rem + font .875rem`, no está garantizado.
- [x] 1.2 Añadir tokens de **superficie** separados del color: `--surface`, `--surface-raised`, `--surface-sunken`, `--border`. Reemplazan los **17 `bg-white`** y el `background-color: #fff` de `base.css:41`.
- [x] 1.3 Añadir token `--radius` y unificar los radios (`0.5rem` en `.field-input`, `rounded-xl` en cards).
- [x] 1.4 Fijar la escala tipográfica de la guía §7 en tokens: `--fs-section: 18px`, `--fs-label: 14px`, `--fs-help: 12px` y sustituir los `text-sm`/`text-xs` sueltos en `field-host.ts:128,250,253`. _(Deviación de nombre: se declaran como `--text-section`/`--text-label`/`--text-help` en `@theme` — ver notas de Fase 1.)_
- [x] 1.5 Verificar contraste **AA** de `--color-primary`/`--color-danger`/`--color-success` sobre `--surface` (herramienta de contraste) y registrar el resultado en el PR.
- [x] 1.6 `npx prettier --check` + `npm run build` + `npm test` en verde.

**Criterio de salida:** un único cambio de `--surface` recolorea inputs, cards y sidebar sin tocar componentes.

---

## Fase 2 — Iconografía Lucide

> **Por qué ahora:** cambio cosmético, bajo riesgo, alta percepción. Independiente de las otras fases. Hoy hay **0 importaciones de Lucide** a pesar de tenerlo instalado.

Inventario de reemplazos (verificado en templates, sin contar comentarios):

- [x] 2.1 Reemplazar `↑ ↓ ✕` de reordenar/eliminar en **3 componentes de fila**: `key-value.ts:103,112,121` · `list.ts:106,115,124` · `string-list.ts:73,82,91` → `arrow-up`, `arrow-down`, `trash-2`. **No olvidar `aria-label`** en cada botón (hoy los de `list-view` ya lo tienen; verificar los de estos tres).
- [x] 2.2 Reemplazar el `✕` del chip en `multiselect.ts:30` → `x` con `aria-label="Quitar <valor>"`.
- [x] 2.3 Reemplazar `⠿` (drag handle), `▲` y `▼` en `list-view.ts:184,196,205` → `grip-vertical`, `chevron-up`, `chevron-down`.
- [x] 2.4 Reemplazar los `×` de cerrar en `modal.ts:36` y `toast.ts:46` → `x` (mantener `aria-hidden` solo si el botón ya tiene `aria-label`; si no, **añadirlo**).
- [x] 2.5 Icono junto a las acciones de fila en `list-view.ts:263-290`: `pencil` para **Editar**, `trash-2` para **Eliminar** (la guía §7 pide icono + texto, no solo color).
- [x] 2.6 Icono en el **mensaje de error** de `field-host.ts:253` → `circle-alert`, con `aria-hidden` (§7: no depender solo del color).
- [x] 2.7 Icono de **éxito/error en el toast** (`toast.ts`) y en el estado vacío (`empty-state.ts`) — usar `check-circle-2` / `circle-alert`.
- [x] 2.8 Añadir icono al botón de **Crear** en `list-view.ts:109` (`plus`) y al de **Reintentar** (`rotate-cw`).
- [x] 2.9 Verificar **tree-shaking**: comparar `dist/admin-schema/browser` antes/después (baseline hoy: **572 K**). Los iconos estáticos solo entran si se importan — no importar nada que no se use. _(Medido: ver notas de Fase 2.)_
- [x] 2.10 `npm test` + `npm run build` verdes; smoke visual de los 4 recursos. _(Tests y build verdes ✓; smoke visual **OK** — confirmado por el usuario el 2026-10-04: «funciona con normalidad».)_

**Criterio de salida:** cero emojis/unicode de UI en `src/app`, todos los botones de solo icono con `aria-label`, bundle sin regresión notable.

---

## Fase 3 — Accesibilidad de campos (terminar lo empezado)

> **Por qué:** el CSS de error ya existe (`base.css:56`) pero **nada setea `aria-invalid`**, y el error no está vinculado al control. Cerrar esto es barato y es requisito §8.

- [x] 3.1 **Cablear `aria-invalid`**: flag desde `field-host` (mismo criterio que `errorMessage()`), volcado por DI en cada control vía `fields/field-aria.ts` — una directiva que casa con `input/select/textarea/output[id]`, así los 14 controles sólo la agregan a `imports` y sus plantillas no cambian. (El enunciado original contemplaba 22 campos con id; eran 14 controles únicos, más `key-value`/`string-list` que iban aparte.)
- [x] 3.2 **`aria-describedby`**: `field-host` calcula `helpId`/`errorId` y los enlaza; el mismo id es ancla de label y de descripción.
- [x] 3.3 **El error reemplaza a la ayuda** (§2): `@if (error) … @else if (help)`. Probado: con error de servidor la ayuda desaparece del árbol.
- [x] 3.4 Se mantiene `role="alert"`: anuncia el error **en el momento en que aparece**, mientras que `aria-describedby` lo lee **al enfocar el campo**. Son momentos distintos — no compiten (documentado en `field-aria.ts`).
- [x] 3.5 **Placeholders = ejemplo**: el recuento eran 6 sitios reales, no 28 (el resto eran `?? ''` y `<option>`). Única instrucción: `string-list` `"Agregar un valor"` → `"Ej. Opción 1"`. Intactos `url.ts` (`https://…`) y `key-value.ts` (`Clave`/`Valor`, etiquetas de columna).
- [x] 3.6 Marcar opcionales — contado **por nivel** (top-level): `legal` 11/11, `site` 10/11, `categories` 7/8, `products` 12/18. Se aplica a ≥75 % obligatorios → `legal`, `site` y `categories`. **Desviación:** el plan nombraba sólo `categories` y `legal`; `site` cumple la misma regla, así que entra.
- [x] 3.7 **Test**: `form-view.a11y.spec.ts` — recorre las 6 pestañas de `products` con datos sembrados y afirma label con ancla, `aria-invalid`/`aria-required` en todo control con id, y `aria-describedby` resolviendo a nodos existentes (+ aserciones anti-vacío y rama de error de `relation`).
- [x] 3.8 `npm test` **17/17**, `ng build` sin warnings, prettier limpio en `src/**`.

**Defectos encontrados y corregados en el camino:**

- `list`, `key-value`, `string-list` dibujaban `<label for>` **sin ningún elemento con ese id** → ahora es un `<div>` (son secciones; sus controles internos traen etiqueta propia).
- `relation` en `loading`/`error` no renderizaba control → label colgado. `loading` = `<select disabled>`, `error` = `<output role="alert">` (labelable y live region).
- `key-value`/`string-list` no recibían `aria-invalid`: ya llevan `id` único por fila y el mismo contexto.

**Pendiente / residual:** en `multiselect` el label apunta al host custom (existe, pero no es labelable); lo correcto es `aria-labelledby` sobre el grupo de opciones.

**Criterio de salida:** con el campo en error, `Tab` llega al control y el lector de pantalla anuncia etiqueta + estado + mensaje.

---

## Fase 4 — Resumen de errores al enviar

> **Por qué:** la guía §4.11 lo pide. Ya existe **más de la mitad**: `revealErrors()` (`form-view.ts:510`) abre las secciones, salta a la pestaña con problema, y `scrollToFirstError()` (`:525`) lleva scroll + focus al **primer** campo con error. `serverErrors.fields` **ya es un mapa `ruta → mensaje`** (`error-mapper.service.ts:5,20`).
>
> **Lo que falta es la lista completa arriba del formulario.** Hoy solo se pinta `general` (`form-view.ts:92-97`); el mapa de campos se reparte a los inputs y no se muestra agregado. Con 2+ errores, el usuario solo ve el primero.

- [x] 4.1 Renderizar **lista de errores** en el `<form>` cuando `hasServerErrors()` sea true (`form-view.ts:505`): `role="alert"` + `ul` con un ítem por mensaje de `serverErrors.fields` (deduplicado).
  - **Alcance corregido:** `serverErrors.fields` **nunca puede tener 2 entradas** — `ApiErrorBody` trae un único `path`, el interceptor lanza un `ApiError` y `ErrorMapperService.map()` devuelve `{fields: {[path]: msg}}`. El supuesto de esta fase era incorrecto. Los errores múltiples los produce la **validación del cliente**: `submit()` marca todo el árbol como tocado y de golpe hay N campos inválidos. El resumen se alimenta de `summaryErrors` (recorrido del árbol, no de `serverErrors`), y el mensaje de servidor se inyecta si existe. Los ítems solo aparecen **después del primer envío** (`submitted`), porque `invalid()` ya es cierto en el primer render de cualquier form con `required`.
- [x] 4.2 Cada ítem, un **enlace al campo**: reutilizar el id que ya genera `state().name()` y el selector `[data-field]` que ya usa `scrollToFirstError()` (`form-view.ts:526`) — no inventar anclas nuevas. Al activar, delegar en `scrollToFirstError()` o replicar su scroll+focus para ese campo.
  - `goToError()` cambia de pestaña/sección (`activeSection`/`openSections`) **antes** de saltar: en `mode: 'tabs'` el campo de otra pestaña todavía no está en el DOM. Luego `focusField()` hace scroll + focus sobre `input/textarea/select` dentro del `[data-field]`.
- [x] 4.3 **Mantener** `revealErrors()` como está (abrir secciones + focus al primer error) y añadir el foco al resumen solo cuando hay **2 o más** errores — con uno solo, robarle el foco al campo molesta.
  - Además, con <2 ítems **el resumen ni se pinta** (`@if (summaryErrors().length >= 2)`), así que no puede robar foco.
- [x] 4.4 Deduplicar mensajes: un `422` puede traer varios `fieldPath` con el mismo texto.
  - Deduplicación por `id` de campo (`state().name()`), que es más fuerte que por texto: un mismo mensaje repetido en dos campos son dos entradas distintas y válidas. Mapeo de servidor a raíz por `path === root || root. || root[`.
- [x] 4.5 **Test** en `form-view.spec.ts`: mock de `ApiError` con dos `fieldPath` distintos → aparecen 2 enlaces en el resumen; con uno → sin resumen, foco directo al campo (comportamiento actual preservado).
  - **Premisa imposible** (ver 4.1): un `ApiError` solo trae un `path`. Los tests son: (a) submit con form inválido → ≥2 enlaces + foco en el resumen + el enlace a `Descripción` cambia de pestaña y enfoca el control; (b) un único `fieldPath` de servidor → sin resumen y foco en el campo. También fija `Element.prototype.scrollIntoView`, que jsdom no implementa.
- [x] 4.6 `npm test` verdes.

**Criterio de salida:** al guardar un formulario con 2 errores, aparecen 2 enlaces arriba y cada uno enfoca su campo.

---

## Fase 5 — Formularios extensos

> **Por qué:** `products` tiene 19 campos en una sola página con scroll. Faltan las 3 técnicas que la guía marca como obligatorias para esa banda (§4): **progreso**, **Guardar siempre visible**, **borrador**.

- [x] 5.1 **Barra de acciones sticky**: mover Cancelar/Guardar (`form-view.ts:190-200`) a un contenedor `sticky bottom-0` con fondo `--surface` y borde superior; cumplir que **Guardar queda siempre visible**.
  - Hecho. `sticky bottom-0 z-10` + `bg-surface` opaco en el `<div>` de acciones. `mt-6` y `border-t` se conservan; sin `bg-surface` el contenido se vería pasar por detrás de la barra.
  - Sin problema de recorte: el elemento vive dentro del contenido, no de un contenedor con `overflow`.
- [x] 5.2 **Indicador de progreso por sección**: en `mode: 'tabs'` ya hay `•` de problema (`form-view.ts:133`); ampliar a `✓` (sección sin errores ni pendientes) y `⚠` (con errores). Reutilizar `sectionHasProblem()` (`form-view.ts`), no reimplementar la lógica.
  - Hecho reutilizando `sectionHasProblem()`. El `•` ahora es `⚠` (danger) y la sección limpia muestra `✓` (success, token `--color-success` ya existente). En `<summary>` de `sections` se mantiene el texto «Revisar».
  - El glifo va con `aria-hidden` y el estado se cuenta aparte en `<span class="sr-only">` («— con errores» / «— completa»), para que el lector de pantalla no pierda el dato.
  - **Decisión A tomada:** `sectionHasProblem()` es `invalid()`, y un campo `required` vacío YA es inválido desde el primer render — `⚠` habría aparecido en todas las pestañas al abrir el formulario. Ahora se usa `sectionProgress(section)`: `complete` → `✓` (siempre, es progreso positivo), `problem` → `⚠` **sólo después del primer envío**, `pending` → sin marca. El `✓` sí se ve desde el principio: es el que informa «esto ya está listo».
  - **Test:** «decisión A: sin ⚠ antes del primer envío, con ⚠ después» en `form-view.spec.ts`.
- [x] 5.3 **Barra lateral de navegación interna** para `mode: 'sections'` con >1 sección: índice sticky a la izquierda en escritorio, colapsado a chips en móvil. (En `mode: 'tabs'` las pestañas ya hacen de índice — no duplicar.)
  - Hecho. El `@for` único se partió en dos ramas limpias: `tabs` (barra + panel) y `sections` (índice + `<details>`), sin duplicar el cuerpo.
  - Escritorio: `<nav>` sticky `top-4` `lg:w-44`, borde izquierdo, `✓/⚠` con `sr-only`. Mismo `aria-label` en ambos `<nav>`, pero uno está `hidden` en cada breakpoint, así que solo hay un landmark visible.
  - Móvil: chips horizontales con `overflow-x-auto`, borde/ texto en danger cuando la sección tiene problemas.
  - `goToSection(id)` abre el `<details>` **antes** de saltar (si estaba plegado, `scrollIntoView` daría con un elemento de altura 0) y luego hace scroll + `focus()` en el `<summary>` (`tabindex="-1"`). El `<details>` lleva `id="section-<id>"` y `scroll-mt-4` para que el sticky no tape el inicio.
- [x] 5.4 **Autoguardado de borrador** (§4.6): persistir el árbol del formulario en `localStorage` bajo una clave `draft:<recurso>:<key|nuevo>`, con debounce. Al abrir: si hay borrador más reciente que el servidor, ofrecerlo (nunca restaurarlo en silencio) con aviso discreto `"Borrador guardado hace 1 min"`.
  - Hecho. Clave `draft:<recurso>:<key|nuevo>`, JSON `{savedAt, value}`, debounce **800 ms** (`DRAFT_DEBOUNCE_MS`).
  - Disparador: `effect()` en el constructor que lee `tree().value()` (esa lectura es la que registra la dependencia) y `status()`. En `create` se ofrece igual (clave `nuevo`), en `edit` solo si `savedAt > updated_at` del registro; si el registro no trae fecha, se ofrece igual.
  - **Filtro clave:** `loadedSnapshot = JSON.stringify(tree().value())` se actualiza en `applyRecord` (carga), en `rebuild` (defaults) y tras guardar. El effect no escribe si el valor no cambió — sin esto, al abrir el form aparecería un borrador idéntico al servidor y se ofrecería para siempre.
  - Aviso con `role="status"` (anuncia sin robar el foco), botones **Restaurar** / **Descartar**, texto `Hay un borrador guardado hace N min`. Nunca se restaura solo.
  - `localStorage` envuelto en `try/catch` (modo privado, cuota): un fallo de borrador nunca debe romper el formulario.
- [x] 5.5 **Limpiar el borrador** tras un guardado exitoso y al descartar (botón nuevo **Restablecer**, §5).
  - Hecho. `clearDraft()` en los dos caminos de éxito de `persist()` (create y update) + limpieza de `draftOffer`, y en `discardDraft()` desde el aviso.
  - Botón **Restablecer** nuevo en la barra de acciones (solo `mode() !== 'create'`, variante `ghost`): re-aplica `loadedRecord` (lo que vino del servidor) o `seedModel`, limpia `serverErrors`, `submitted`, el aviso y el borrador, y notifica. En `create` no se muestra, como marca §5.
- [x] 5.6 **Campos condicionales** — _verificar antes de construir_: existe `shared/utils/condition-evaluator.ts`. Confirmar si `form-view` lo consume. Si ya funciona, solo añadir la transición suave (§4.5); si no, cablearlo.
  - **Verificado, ya funcionaba**: `shared/utils/condition-evaluator.ts` existe y lo consume `form-view/form-schema.ts:31,248-260` → `visibleWhen` genera `hidden(path, {when})` → `state.hidden()` → `field-host` no dibuja el campo y `buildPayload` lo excluye. NO había que cablearlo.
  - Sólo se añadió la transición (§4.5): la clase `field-enter` en el wrapper de `field-host`, aplicada **sólo cuando `field().visibleWhen` existe** — si no, un form de 19 campos se animaría entero al cargar. Entrada de 180 ms (opacity + translateY), **solo entrada**: el `@if` de Angular retira el nodo sin poder animarlo, y retrasar la salida de un campo donde se está escribiendo sería peor que nada. Anulada con `prefers-reduced-motion`.
- [x] 5.7 **Validación por sección** al cambiar de pestaña en `mode: 'tabs'` (§4.9): no dejar avanzar si la sección activa tiene errores de validación local.
  - Hecho en `selectSection()`: si la pestaña activa tiene errores de validación **locales** (`invalid()`, sin contar los del backend), no cambia, marca la sección como tocada con `childTree(tree, key).markAsTouched()` (los mensajes sólo aparecen una vez tocado) y devuelve el foco al primer error con `scrollToFirstError()`. Se pone `submitted = true` para que, con 2+ errores, aparezca también el resumen.
  - **Decisión A tomada:** el bloqueo se activa **sólo cuando `submitted()`**. Antes del primer Guardar podés recorrer las pestañas libremente — si no, con `required` vacíos no se podría navegar para ver qué hay en cada una. §4.9 distingue «en wizard, validar antes de avanzar; en página larga, al salir de cada campo»: esto queda como wizard, pero sólo después de que el usuario ya intentó guardar.
- [x] 5.8 **Test**: `form-view.spec.ts` — `saving` bloquea el doble submit (puede que ya pase), y un spec nuevo para el ciclo de borrador (guardar → recargar → ofrecer → limpiar).
  - Hechos 4 tests (24/24 en total):
    1. `saving` bloquea el doble submit — dos `submit` síncronos → `api.update` se llama **una** vez (si el form estuviera inválido daría 0 y el test fallaría, así que es significativo).
    2. El borrador se limpia tras guardar con éxito (§5.5).
    3. El borrador se ofrece sin restaurarse y sólo se aplica al clicar en Restaurar.
    4. Editar escribe el borrador en `localStorage` tras el debounce de 800 ms — **este es el test que evita que el feature esté muerto sin que lo notemos**.
    - «sin borrador no muestra aviso».
- [x] 5.9 `npm test` + `npm run build` verdes; smoke manual en `products` (19 campos) y en `categories` (8). _(Tests y build verdes ✓; smoke manual **OK** — confirmado por el usuario el 2026-10-04.)_
  - **Hecho:** `npm run build` verde sin warnings, `npm test` **25/25** (6 specs), `prettier --check src/**` limpio.
  - **Pendiente:** el smoke manual — no hay tool de navegador en esta sesión. Hay que recorrer a mano `products` (19 campos, tabs) y `categories` (8, sections) y revisar: barra sticky visible al hacer scroll, `✓/⚠` por pestaña, índice lateral en `categories`, borrador al escribir y ofrecerlo al volver, y que el bloqueo al cambiar de pestaña no resulte molesto.

**Criterio de salida:** en `products`, Guardar siempre visible, secciones marcadas ✓/⚠, y un F5 recupera el borrador con aviso.

---

## Fase 6 — Selección y dropdowns

> **Por qué:** hoy `select.ts` y `relation.ts` son `<select>` **nativos** (recién verificado). Cumplen teclado y accesibilidad gratis, pero la guía §1 pide búsqueda a partir de 7 opciones y el dato secundario en relaciones. Empieza a doler con `products` y cualquier lista que crezca.

- [x] 6.1 **Umbral**: si un `select` supera 7 opciones, pasar a un control con **búsqueda** (§1). Decidir implementación: `input[type=search]` sobre un `<select>` filtrado, o un combobox propio con `role="combobox"`. **Recomendación:** empezar por filtrar un `<select>` (conserva teclado nativo, costo mínimo) y solo subir de complejidad si el UX no alcanza.
- [x] 6.2 Reglas de dropdown de la guía (§1): opción **Limpiar**, mensaje **"Sin resultados"**, indicador de **carga**, navegación con **teclado**, valor seleccionado **siempre visible**.
- [x] 6.3 **`relation` con dato secundario**: hoy imprime `option.label` (`relation.ts:37`). Soportar `labelField` + un segundo dato (§1: `"Juan Pérez · DNI 123"`) — `labelField` ya se resuelve en `relation.ts:74`.
- [x] 6.4 **Botón "+ Crear nuevo"** dentro del dropdown de `relation` (§1) que abra el formulario en un drawer y vuelva con el valor creado. _Depende de 6.5._
- [x] 6.5 **Edición rápida en drawer** (§5): si vale la pena, componente lateral para editar 1–3 campos sin salir de la lista. Evaluar contra el costo — puede quedar en "no hacemos" si 6.4 no se necesita.
- [x] 6.6 **Selección dependiente** (país → ciudad, §1): el hijo se desactiva hasta elegir el padre y **se reinicia si el padre cambia**. Verificar si `condition-evaluator.ts` ya cubre el reset; si no, añadirlo.
- [x] 6.7 Estado de carga de `relation`: hoy es texto con `animate-pulse` (`relation.ts:26`) — sustituir por el componente `skeleton` que ya existe en `shared/components/skeleton`.
- [x] 6.8 **Test**: `relation` — carga, dato secundario, y "Sin resultados" al filtrar.
- [x] 6.9 `npm test` verdes.

### Notas de ejecución — Fase 6

**6.1 / 6.2 · Umbral y reglas del dropdown.** Sobre el `<select>` nativo (decisión de 6.1: conserva el teclado y cuesta poco). **Umbral `> 7`** — `relation.ts:119` y `select.ts:54`: `options().length > 7` → **con 8 opciones SÍ se dispara**. _(Corregido el 2026-10-04: la versión anterior de esta nota decía que no se disparaba en ningún schema, lo cual era autocontradictorio — 8 > 7. Lo que hay que mirar con los datos vivo es cuántas categorías hay en el listado: si son ≥8, `products.category_slug` debe mostrar campo de búsqueda; si no lo muestra, es bug.)_ `matches` y `noMatches` están separados de `visibleOptions`, para que _Sin resultados_ (`role="status"`) se vea aunque la opción elegida quede fuera del filtro. Opción _Limpiar_ y navegación con teclado los trae el navegador.

**6.3 · Dato secundario.** `RelationField.secondaryField` → etiqueta `principal · secundario`, y el texto secundario entra en el filtro.

**6.4 · «Crear nuevo» desde el dropdown.** El botón va **debajo** del `<select>`, no dentro: un `<option>` no puede contener botones. El campo **no** instancia el drawer: lo abre con `RelationDrawerService`, un `@Service()` que transporta la petición. Se eligió mediador inyectable y no un `output()` porque `relation → DrawerForm → FieldHost → relation` arma un ciclo de imports y Angular tumba la compilación (`Cannot read properties of undefined (reading 'ɵcmp')`). El drawer devuelve el registro por `saved`; el campo recarga las opciones y preselecciona la clave nueva.

**6.5 · Edición rápida.** Se activa con `ResourceSchema.quickEdit?: string[]` (claves del subconjunto, en orden): **no se adivina qué editar**. `categories` declara `['name', 'active']` como primer consumidor real; `products` no declara nada y no muestra el atajo. `DrawerForm` es deliberadamente más chico que `form-view`: sin pestañas, secciones, borrador ni resumen de errores.

**Gotchas que costaron tiempo (por si se retoma):**

- **`NG0602`**: `form()` de Signal Forms crea un `effect` interno → **no puede correr dentro de otro effect**. El árbol se construye en `ngOnInit` y los padres montan el componente bajo `@if`, fijando los inputs al montar. Meterlo en un `setTimeout` "funciona" pero rompe `whenStable()`.
- **jsdom**: `offsetParent` es siempre `null`, así que el atrapado del Tab se volvía no-op. El filtro usa `checkVisibility()` cuando existe y, si no, confía en el DOM salvo lo marcado `hidden`.
- `resource.reload()` **encola** la petición: hace falta `await fixture.whenStable()` antes de contar llamadas.
- `tree()` devuelve el estado; el valor es `tree().value()` (señal), no `tree().value`.

**Verificación:** `npm test` **42/42 (9 specs)** · `npx ng build` verde · `npx prettier --check "src/**"` limpio · `npm run api:check` VERDE (4 recursos, 62 campos).

**Pendiente (smoke manual):** recorrer a mano los 4 recursos — _Crear nuevo_ desde un `relation`, filtrarlo, y _Edición rápida_ en Categorías.

---

**Criterio de salida:** un `relation` de 50 opciones se filtra con teclado y muestra nombre + dato secundario.

---

## Fase 7 — Feedback y estados

> **Por qué:** §6. Casi todo ya está (doble envío, confirm, toast, skeleton); quedan los estados de _carga de opciones_ y la coherencia de mensajes.

- [x] 7.1 Skeleton en `relation` (hoy es texto con `animate-pulse`, `relation.ts:26`) — `list-view.ts:115` **ya** usa `<app-skeleton>`, no tocar.
- [x] 7.2 **Conservar lo escrito** ante error del servidor (§6): verificar que `onSubmit` no limpia el árbol cuando la API falla (solo debe limpiarse tras éxito).
- [x] 7.3 **Mensajes de error en lenguaje humano** (§2): auditar `error-mapper.service.ts` y los mensajes de `validators.ts` — nada de `"Formato inválido"`.
- [x] 7.4 Toast de éxito con comportamiento por flujo (§6): ¿vuelve a la lista o se queda? Definir la regla por recurso y aplicarla consistente.
- [x] 7.5 Verificar `aria-live` en el contenedor del toast (SR debe anunciarlo).
- [x] 7.6 `npm test` verdes.

### Notas de ejecución — Fase 7

**7.1 · Skeleton.** Ya estaba desde la 6.7 (`relation.ts` usa `<app-skeleton>`); `list-view.ts:115` tampoco se tocó.

**7.2 · Conservar lo escrito.** Verificado en código y ahora también con test: `persist()` sólo hace `tree().reset()` **después** del `await` exitoso — si la API falla, el `catch` pinta los errores y hace `return`, sin tocar el árbol. Test nuevo: `form-view.spec.ts` → _«un error del servidor conserva lo escrito y lo pinta en el campo (§6)»_. `drawer-form.ts` sigue la misma regla (nunca hace `reset`).

**7.3 · Lenguaje humano.** Auditoría completa; había cuatro clases de problema:

| Dónde                                  | Antes                                                            | Ahora                                                                                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `form-schema.ts` (`pattern`)           | `Formato no válido.`                                             | `Formato esperado: 11 dígitos.` — se **reutiliza la ayuda del schema**, porque el error reemplaza a la ayuda bajo el campo (`field-host.ts:284`): si no lo repite, el usuario pierde el único texto que explica lo esperado. |
| `api-error.interceptor.ts` (red/5xx)   | `Http failure response for http://…` (inglés técnico de Angular) | Mensaje por código: `No se pudo conectar con el servidor…`, `Tu sesión ha expirado…`, `No tienes permisos…`, etc.                                                                                                            |
| `field-host.ts` (fallback)             | `Valor inválido`                                                 | `Revisa este campo.`                                                                                                                                                                                                         |
| backend `23-validate.js` / `checks.js` | `Formato inválido`                                               | `No coincide con el formato que pide este campo`                                                                                                                                                                             |

- `error-mapper.service.ts` y `validators.ts` ya estaban en español neutro: **sin cambios**.
- **Encontrado de paso: voseo en la copia de interfaz.** `form-view.ts` («Si salís ahora, perdés…») e `image.ts` («Verificá la conexión e intentá…») → español neutro. Los artefactos nunca llevan voseo; el voseo es sólo del chat.
- `closeLabel` de `toast.ts` y `modal.ts` decía `Close` en una UI en español → `Cerrar`.
- Tests nuevos: `api-error.interceptor.spec.ts` (4 casos: 5xx, status 0, 403 y mensaje del backend conservado).

**7.4 · Regla de éxito por flujo.** Definida y escrita donde se decide, en la cabecera de `form-view.ts#persist`:

- **Crear** desde pantalla completa → **vuelve a la lista**.
- **Editar** → **se queda** y recarga lo guardado.
- **Eliminar** → **vuelve a la lista** (`back()`).
- **Desde un drawer** (crear relación, edición rápida) → **se queda**: salir destruiría el contexto que el drawer existe para conservar.

Es la misma para los cuatro recursos. Se verificó que ya se cumplía, así que **no hubo cambio de comportamiento** — sólo la regla quedó documentada. El toast se emite antes de navegar y vive en el layout, así que sobrevive al cambio de ruta.

**7.5 · `aria-live`.** Existía (`role="status"` + `aria-live="polite"` en el host de `app-toast`), pero nada lo comprobaba. Test nuevo en `app.spec.ts`: la región está **antes** del primer mensaje y arranca vacía — si el contenedor apareciera junto con el toast, los lectores de pantalla no anunciarían nada.

**7.6 · Tests.** `npm test` **48/48 (10 specs)** · `npx ng build` verde · `npx prettier --check "src/**"` limpio · `npm run api:check` VERDE (4 recursos, 62 campos). (`doc/plan.md` y `doc/ui-ux.md` ya venían sin formatear con Prettier: no son míos, no se tocan.)

**Pendiente:** smoke manual de 5.9/6 y revisar el resto de mensajes de `error-mapper` con errores reales del backend.

---

### Notas de ejecución — Fases 1 y 2 (verificación posterior)

Se dejaron para el final 1.4 y 2.9 porque 1.4 sólo puede comprobarse con el bundle ya construido y 2.9 necesita un baseline que no existía.

**1.4 · Escala tipográfica.** La guía pide `--fs-section`/`--fs-label`/`--fs-help` en `:root`. En Tailwind v4 un custom property plano **no genera ninguna utilidad**: hay que declararlo en `@theme` bajo el espacio de nombres `--text-*`, que es el que convierte a `text-section` / `text-label` / `text-help`. Por eso el nombre difiere de la guía. Detalles que no son opcionales:

- Los `--text-x--line-height` son **obligatorios**: sin ellos la utilidad sólo fija el `font-size` y la altura de línea se heredaría, y el dibujo cambiaría. Los valores replican exactamente a `text-lg` (18/1.75rem), `text-sm` (14/1.25rem) y `text-xs` (12/1rem) → la extracción es **sin cambio visual**.
- Sustituciones: `field-host.ts` etiqueta ×2 → `text-label`, ayuda y error → `text-help`; y los títulos `text-lg font-semibold` → `text-section font-semibold` en `group.ts` (×2), `form-view.ts`, `drawer.ts` y `modal.ts`.
- Los demás `text-xs text-neutral` del código (`relation`, `select`, `textarea`, `image`, `list-view`) **no se tocaron**: son estados, contadores y paginación, no el rol "ayuda" de §7.

**2.9 · Tree-shaking y coste.** Tres construcciones comparadas con el mismo criterio (todos los `.js` + `.css` de `dist/admin-schema/browser`, sin comprimir y con gzip -9):

| Construcción                                                       | Sin comprimir | gzip    |
| ------------------------------------------------------------------ | ------------- | ------- |
| **Antes** — `HEAD` (`5879cb1`), sin fases 1-7                      | **539,4 K**   | 155,0 K |
| **Ahora** — fases 1-7 con Lucide                                   | **624,9 K**   | 167,0 K |
| **Ahora sin iconos** — mismo código, Lucide retirado               | 568,9 K       | 162,4 K |
| **Actual** — fases 1-9 + 8 (medido 2026-10-04 con el mismo script) | **639,1 K**   | 167,2 K |

- **Coste de Lucide: +56,0 K sin comprimir / +4,6 K gzip = 9,0 % del bundle actual.** (15 componentes Angular: cada uno lleva su propia definición `ɵcmp`, no es sólo el `d` del SVG.)
- Resto de las fases 1-7: +29,5 K / +7,4 K.
- **Tree-shaking verificado:** 15/15 iconos importados presentes en el bundle y 8/8 no importados **ausentes** (`rocket`, `bike`, `pizza`, `flame`, `party-popper`, `dog`, `snowflake`, `umbrella`), localizados por la cadena `key:` interna de cada icono. La librería pesa **10.215 K** — entran 15 iconos, no la librería.
- El baseline escrito en la guía (**572 K**) no coincide: el real en `HEAD` es **539,4 K**. Se corrigió en la checklist final. _Reproducido el 2026-10-04 con el mismo script en un `git worktree` nuevo: **539,4 K / 154,0 K** — el método del plan era correcto._
- **El salto de 624,9 K a 639,1 K (+14,2 K raw / +0,2 K gzip) es la Fase 8**: el bloque oscuro de `theme.css`, el `ThemeService`, el `ThemeToggle` y el script anti-flash de `index.html`. Los specs de la Fase 9 **no** cuentan: no entran al bundle.
- Aislamiento: se construyó una copia del árbol actual con los `<svg lucideX>` y sus `imports[]` retirados, y otra copia de `HEAD` en un `git worktree` aparte (borradas ambas al terminar).

### Concordancia del plan (2026-10-04)

Revisión del plan completo contra el código, antes de arrancar la Fase 9 y la 8:

| Qué decía el plan                                                                             | Realidad verificada                                                            | Acción                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| 1.4 `❌ No hecho`                                                                             | Tokens `--text-*` en `@theme`, construidos y comprobados en el CSS de salida   | ✅ cerrada                |
| 2.9 `❌ No se pudo verificar`                                                                 | Tres construcciones medidas: 539,4 → 624,9 K, de los que Lucide = 56,0 K       | ✅ cerrada                |
| 6.1/6.2 «el umbral `>7` no se dispara»                                                        | `options().length > 7` → con 8 **sí** dispara                                  | Nota corregida            |
| 8.2 lista de 14 componentes con `bg-white`                                                    | Queda **1** (`boolean.ts:19`)                                                  | Lista reescrita           |
| 8.1 citaba `--fs-*`, `--surface`, `--border`                                                  | Existen `--text-*` y `--color-surface`; `raised`/`sunken`/borde **no existen** | 8.1 reescrita             |
| 1.1/1.2/1.3 citan tokens inexistentes (`--control-h`, `--surface-raised/-sunken`, `--radius`) | El **efecto** sí está; los tokens no                                           | ✅ con desviación anotada |

Verificado además, sin cambios: **11** archivos con `@lucide/angular` · **0** iconos unicode de UI ·
`aria-invalid` cableado en `field-aria.ts:47` · `role="alert"` en 6 componentes · `bg-white` = 1.
---

## Fase 8 — Modo oscuro

> **Por qué último, no por importancia:** depende 100% de los tokens de **superficie** de la Fase 1. Hacerlo antes = reescribir 17 `bg-white` dos veces.

> **Estado (2026-10-04):** los 17 `bg-white` ya se sustituyeron en la Fase 1 — queda **1**
> (`boolean.ts:19`, el knob del switch). La 8.2 de abajo estaba **desactualizada**.

- [x] 8.1 Añadir `@media (prefers-color-scheme: dark)` en `theme.css` sobreescribiendo lo que **realmente existe**: `--color-surface` (el único blanco de la app), `--color-*` de texto y estado, **y crear aquí** `--color-surface-raised`, `--color-surface-sunken` y el token de borde (diferidos a propósito en la Fase 1, ver `theme.css:21-25`). No existe `--fs-*` (la escala es `--text-*`) ni `--surface`/`--border` planos. **Cero cambios de componente** si la Fase 1 se hizo bien. _(Hecho 2026-10-04. El bloque está **fuera de `@layer`**: Tailwind emite `@theme` dentro de la capa `theme` y una regla sin capa siempre gana, así que sobreescribe sin tocar plantillas. Se añade `color-scheme: dark` (scrollbars y `<select>` nativos en oscuro) y `body { background-color: var(--color-surface-sunken) }` en `base.css` — el fondo de página no lo pintaba ningún token, `layout` sólo pone `bg-neutral/5` encima del fondo del navegador. **Desviaciones:** (a) `-raised`/`-sunken` **no** podían crearse sólo dentro de la media query, porque Tailwind sólo genera las utilidades a partir de `@theme` y la clase no existiría en claro; se declaran en `@theme` con valor `#fff` y se sobreescriben en oscuro, con lo que **el modo claro queda idéntico píxel a píxel**. (b) **No se creó token de borde**: los 36 `border-neutral/20|30|40` ya derivan de `var(--color-neutral)` por `color-mix`, y al aclarar `neutral` en oscuro los bordes se vuelven hilos claros solos; crearlo habría tocado 36 plantillas para cero ganancia. (c) **"Cero cambios de componente" no se cumplió literalmente** — ver 8.2._)_
- [x] 8.2 Revisar los componentes que **escapan** al token. _(Lista desactualizada; verificada el 2026-10-04.)_ La sustitución de los `bg-white` ya se hizo en la Fase 1: queda **1**, `boolean.ts:19` (`after:bg-white`, el knob del switch, deliberadamente blanco en ambos modos). Re-verificar con `grep -rn "bg-white" src/` y `grep -rn "#fff" src/`, y aplicar el `-raised`/`-sunken` que declare la 8.1 a lo elevado (toast, modal, sidebar) y a lo hundido (fondos de sección). _(Hecho 2026-10-04. Re-verificado: `bg-white` = **1** (`boolean.ts:19`, knob de 16 px, deliberado) y `#fff` = **1** (`--color-surface`, se sobreescribe en oscuro). **10 ediciones de clase:** `text-white` → `text-surface` en `button.ts` (primary, danger) y `badge.ts` (success, danger, info, neutral); `bg-surface` → `bg-surface-raised` en `toast.ts`, `modal.ts`, `drawer.ts` y `sidebar.ts`. **Por qué `text-white` no podía quedarse:** el texto y el relleno comparten token, así que si se aclara `--color-danger` en oscuro el blanco cae a 2,8:1; `text-surface` es `#fff` en claro (render idéntico) y texto oscuro sobre el tono aclarado en oscuro. **Lo hundido** = el `body` (vía `base.css`), no las secciones: las tarjetas de `form-view` se quedan en `--color-surface`, que es el nivel medio de la escalera `sunken < surface < raised`.)_
- [x] 8.3 Estados oscuros de `:focus-visible` (`base.css:22`), `--color-danger`, `--color-success` — revalidar contraste AA **sobre el fondo oscuro** (repitiendo 1.5 para ambos modos). _(Hecho 2026-10-04 con la fórmula WCAG exacta, midiendo el peor de los tres fondos (`sunken`/`surface`/`raised`) y la mezcla real de `color-mix` para `bg-accent/15`: **claro peor 4,83:1 · oscuro peor 5,76:1**, foco 4,85 / 6,61 (umbral 3:1). Todo AA en los dos modos. El resultado obligó a reescribir la mitad del bloque oscuro: con los valores de claro, `text-neutral` daba 3,6:1, `text-accent-text` sobre la mezcla oscura 1,9:1 y `bg-*` con `text-white` 2,8:1.)_
- [x] 8.4 Reglas de escala/peso: en oscuro, nada de `box-shadow` negras intensas ni `#fff` puro en superficies grandes. _(Hecho 2026-10-04. Verificado: **cero** `shadow-[...]` arbitrario en `src/` — sólo `shadow-lg`/`-xl`/`-2xl` nativos de Tailwind, que son alfa y sobre el scrim `bg-black/50` no añaden negro. El único `#fff` en una superficie es el knob de 16 px, no una superficie grande. La elevación en oscuro la da el token `-raised` (diferencia de color), no la sombra: es lo que funciona sobre fondo oscuro.)_
- [x] 8.5 Verificar imágenes y `thumbnail` de `list-view` legibles en ambos modos. _(Hecho 2026-10-04. `list-view.ts:251-255` pinta `<img class="size-9 rounded-md object-cover">` **sin** fondo blanco propio: cae sobre la fila y sobre `--color-surface`, que ya cambia. `image.ts` envuelve la previsualización en `bg-surface` + `border-neutral/20`, igual. Sin `mix-blend` ni filtros que pudieran invertir. Una foto con fondo blanco sigue siendo un rectángulo claro en oscuro — es el contenido, no la UI — y así lo dejamos.)_
- [x] 8.6 **Decidir el toggle** (§7 pide soporte, no necesariamente interruptor): por defecto respetar `prefers-color-scheme`. Si hay toggle, persistirlo en `localStorage` y aplicarlo antes del primer render (evitar flash). _(Decidido con el usuario el 2026-10-04: **tres estados, Sistema / Claro / Oscuro, con interruptor**. Implementado en: `core/services/theme.service.ts` (señales `mode`/`resolved`, persiste en `localStorage['admin-theme']`, se suscribe a `matchMedia` y sólo reacciona si la elección sigue siendo `system`; doble `try/catch` porque `localStorage` tira en modo privado); `shell/theme-toggle/theme-toggle.ts` (tres `<button>` con `aria-pressed` en un `role="group"`, montado en la cabecera de la sidebar); `index.html` (script **síncrono en el `<head>`**, antes incluso del `<style>` crítico que Angular inyecta, que escribe `data-theme` sin flash); y `theme.css` pasa de `@media (prefers-color-scheme: dark)` a **`:root[data-theme='dark']`** — con tres estados la media query ya no alcanza para distinguir "oscuro elegido a mano" de "oscuro heredado". **Sin bloque de respaldo por media query a propósito:** es una SPA, sin ese script no se renderiza nada, y duplicar los 12 tokens abriría una segunda copia que mantener. 7 tests en `theme.service.spec.ts` (arranque, elección corrupta, persistencia, recuperación, reacción en vivo, ignora el SO con elección concreta, DI). _)_
- [x] 8.7 Smoke: los 4 recursos en ambos modos; `npm run build` verde. _(Build **verde**: 400,2 K raw / 91,2 K gz iniciales (+0,9 K gz desde Fase 9; los 3 iconos nuevos aportan ~10,5 K raw que el gzip deja en 0,3 K). Smoke en claro y oscuro **OK** — confirmado por el usuario el 2026-10-04.)_

**Criterio de salida:** cambiar el sistema a oscuro recolorea el panel completo sin `#fff` visible.

---

## Fase 9 — Verificación y tests de accesibilidad

> **Por qué:** hoy **ningún spec menciona `aria-*`** (verificado). Las fases 3–5 añaden comportamiento sin red; esto lo fija.

- [x] 9.1 Spec de accesibilidad de campo: `id` ↔ `for` ↔ `aria-describedby` ↔ `aria-invalid` consistentes en todos los tipos soportados. _(Hecho 2026-10-04: `products` ya lo cubría para 10 tipos; se añadió un schema sintético con los **20** tipos de `SUPPORTED_FIELD_TYPES` — incluido `date`, que ningún schema real declara — y se verifican las dos caras del contrato de `field-host`: `<label for>` propio en los de control único, y ausencia intencionada en `group`, `list`, `key-value`, `string-list` y `multiselect`.)_
- [x] 9.2 Spec de navegación por teclado: `Tab` recorre el formulario en orden visual; en `tabs`, las flechas cambian de pestaña (`role="tab"` requiere `ArrowLeft`/`ArrowRight` — verificar; hoy solo hay `click` en `form-view.ts:129`). _(Confirmado: sólo había `click`. Se implementó `onTablistKeydown` con `ArrowLeft`/`ArrowRight`/`Home`/`End`, roving `tabindex` y `[id]` en cada pestaña para anclar el foco; si la validación bloquea el cambio (§4.9), el foco se queda donde estaba. Dos specs nuevos.)_
- [x] 9.3 Spec de modal: foco atrapado, `Esc` cierra, foco restaurado al disparador (el código lo hace en `modal.ts:56-66`; falta el test). _(Hecho 2026-10-04. **El plan se equivocaba en dos cosas**: `modal.ts` **no** atrapaba el Tab —sólo guardaba/restauraba el foco—, y tampoco devolvía el foco al destruirse abierto, cosa que `drawer.ts` sí hacía. Se llevó a paridad añadiendo `onTab` + `ngOnDestroy`, extrayendo `FOCUSABLE`/`isVisibleNow` a `shared/utils/dialog-focus.ts` (dos consumidores → un solo sitio). **Hallazgo:** Angular iguala `fullKey` con la tecla armada *con* sus modificadores, así que `keydown.tab` no recibía `Shift+Tab` (`shift.tab`): **el trap hacia atrás estaba roto en `modal` y en `drawer`**. Añadido el binding `keydown.shift.tab` a los dos y spec de Shift+Tab en ambos.)_
- [x] 9.4 Spec de `list-view`: al eliminar, se muestra la confirmación con el nombre del registro y se conserva la página actual. _(Hecho 2026-10-04: 3 tests en `list-view.remove.spec.ts` — nombre del registro y aviso de «no se puede deshacer», cancelar no borra, confirmar borra sólo esa fila. **Desviación:** `list-view` **no tiene paginación** (cero rastros de `page`/`offset`/`limit`/`slice`), así que «conservar la página» se traduce y verifica como: **sin recarga del listado (`api.list` una sola vez) ni navegación fuera**. El host del test replica el cableado de `app.html`, porque el diálogo vive ahí y no en `list-view`.)_
- [x] 9.5 Ejecutar `npm test` y anotar el total nuevo en el plan (hoy **48/48**). _(Hecho 2026-10-04: **62/62 en 12 ficheros** — 48 + 1 (9.1) + 2 (9.2) + 7 (9.3) + 1 (regresión Shift+Tab de `drawer`) + 3 (9.4).)_
- [x] 9.6 Recorrer el **checklist final** de `doc/ui-ux.md` línea por línea y marcar lo que ya cumple; lo que no cumpla, decidir explícitamente entre "siguiente plan" o "no aplica". _(Hecho 2026-10-04. **Desviación:** `doc/ui-ux.md` está en la lista de ficheros que no se tocan, así que el marcado vive aquí y no en la guía. Recorrido íntegro abajo.)_

**Criterio de salida:** checklist de `ui-ux.md` íntegramente resuelto o con excepción documentada.

#### 9.6 — Checklist final de `doc/ui-ux.md` recorrido

| #   | Ítem de la guía                                                | Estado                   | Evidencia / decisión                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cada tipo de dato tiene un control apropiado y consistente     | ✅                       | 20/20 tipos con componente propio, auditados en 9.1 (`form-view.a11y.spec.ts`).                                                                                                                                                                                                                                      |
| 2   | Más de 7 opciones usa dropdown con búsqueda                    | ⚠️ **no aplica hoy**     | `select.ts:54` y `relation.ts:119` usan `options().length > 7` ✓. **`multiselect` no implementa búsqueda**: ningún schema lo declara con más de 7 opciones (`site` tiene **exactamente 7**), así que hoy no existe el caso. _Deuda registrada: si algún schema supera 7 en un multiselect, toca añadir la búsqueda._ |
| 3   | Todas las etiquetas visibles; placeholders solo como ejemplo   | ✅                       | `field-host` pinta etiqueta propia en los 15 tipos de control único, texto en los 4 compuestos y `group.ts:41/63` pinta la suya; 9.1 verifica que ningún `for` queda colgado.                                                                                                                                        |
| 4   | Errores claros, cerca del campo y con resumen al enviar        | ✅                       | Error inline en `field-host` (reemplaza a la ayuda, §2) + resumen con enlaces en `form-view`; tests en `form-view.spec.ts` ("resumen de errores", 2+ errores, enlace al campo).                                                                                                                                      |
| 5   | Formularios largos divididos en secciones, pestañas o pasos    | ✅                       | `layout.mode` `sections`/`tabs`: `site` con secciones, `products` con 6 pestañas.                                                                                                                                                                                                                                    |
| 6   | Navegación interna y progreso visibles en formularios extensos | ✅                       | Pestañas con `sectionProgress` (✓ completa / ⚠ con errores, §4.3) y navegación por teclado desde 9.2.                                                                                                                                                                                                                |
| 7   | Campos avanzados y condicionales ocultos hasta ser necesarios  | ✅                       | `visibleWhen`/`readonlyWhen` vía `condition-evaluator.ts` + `form-schema.ts:264`; `dependsOn` con 3 tests en `form-view.spec.ts`.                                                                                                                                                                                    |
| 8   | Borrador autoguardado y aviso de cambios sin guardar           | ✅ _(guard sin spec)_    | Borrador con debounce a `localStorage` y aviso de salida: tests en `form-view.spec.ts`. `unsavedChangesGuard` **registrado** en `shell.routes.ts:23,28` pero **sin test** → decisión pendiente: _siguiente plan_ o _no aplica_.                                                                                      |
| 9   | Botón Guardar siempre visible                                  | ✅                       | Barra sticky `§5.1` (`form-view.ts:364`) con Cancelar/Guardar.                                                                                                                                                                                                                                                       |
| 10  | Funciona en móvil y con teclado                                | 🟡 teclado ✅ · móvil ⏳ | Teclado: 9.2 (pestañas), 9.3 (diálogos y foco), 9.4 (borrado). Móvil: **pendiente del smoke 2.10/5.9** (no hay herramienta de browser en esta sesión).                                                                                                                                                               |

**Excepciones abiertas (piden decisión):** (2) búsqueda en `multiselect` si algún schema supera 7 opciones — hoy _no aplica_; (8) spec del `unsavedChangesGuard`; (10) smoke móvil/escritorio.

---

## 7. Qué NO hacemos (y por qué)

Criterio también es descartar. Todo esto lo propone la guía y **aquí no aplica**:

| Propuesto en la guía                                                   | Decisión             | Motivo                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wizard por pasos** (§4, +40 campos)                                  | ❌ No                | El techo real es **19 campos** (`products`). Caemos en la banda 9–20 → secciones, que **ya existen**. Un wizard aquí es complejidad para un caso que no tenemos.                                |
| **Pestañas + índice lateral a la vez** (§4)                            | ❌ No duplicar       | En `mode: 'tabs'` las pestañas **ya son** el índice. El índice lateral solo se añade en `mode: 'sections'` (tarea 5.3).                                                                         |
| **Texto enriquecido, contraseña, color, geolocalización, slider** (§1) | ❌ No por adelantado | Es un panel **schema-driven**: ningún schema actual los declara. Añadirlos es YAGNI — se construyen cuando un recurso los pida (y ahí toca el contract check de la Fase 1 del plan de schemas). |
| **Stepper +/-** (§1)                                                   | ❌ No                | No hay campos numéricos con esas semánticas hoy.                                                                                                                                                |
| **Editor de dos calendarios con atajos** (§1)                          | ❌ No                | No hay rango de fechas en ningún schema.                                                                                                                                                        |
| **Drawer de edición rápida** (§5)                                      | ✅ Hecho             | 6.4 lo justificó: el mismo drawer crea desde el dropdown y edita desde la lista (`ResourceSchema.quickEdit`).                                                                                   |
| **Indicador de fortaleza de contraseña** (§1)                          | ❌ No                | Sin campo `password` en el modelo.                                                                                                                                                              |
| **Mapa para geolocalización** (§1)                                     | ❌ No                | Igual.                                                                                                                                                                                          |
| **Autocompletado / valores por defecto inteligentes** (§4.11)          | ⏸️ Diferido          | Requiere definir de dónde salen los defaults. Fuera del primer alcance.                                                                                                                         |

**Regla general:** si la guía describe un control que ningún schema declara, no se construye. El panel dibuja lo que el schema dice — esa es su arquitectura, y anticipar controles la rompe.

> **Backlog (`doc/backlog-ui-ux.md`)** — creado el 2026-10-04 a petición del mantenimiento: conserva lo descartado de esta tabla **con su motivo**, el pipeline completo para incorporar un control nuevo (incluido el uso del schema de prueba `ALL_TYPES_SCHEMA`), los controles que el modelo no puede expresar todavía (texto enriquecido, contraseña, color, geo, slider) y otros componentes identificados con su evidencia. Todo con regla de admisión: _se implementa cuando un requisito real lo pide_.

---

## 8. Orden de ejecución y dependencias

```
Fase 1 (tokens) ──────────────────────► Fase 8 (dark)
      │
      ├──► Fase 2 (iconos)     [independiente, se puede hacer ya]
      ├──► Fase 3 (aria) ─────► Fase 4 (resumen errores)
      ├──► Fase 5 (extensos)   [requiere 3.1 para marcar campos con error]
      ├──► Fase 6 (dropdowns)
      └──► Fase 7 (feedback) ─► Fase 9 (tests)
```

- **Paralelizable:** Fases 2, 6 y 7 no dependen entre sí.
- **Secuencial obligatorio:** 1 → 8 · 3 → 4 · 3 → 5.2 · 6.4 → 6.5.
- **Cada fase cierra con sus checks en verde** (`npm test`, `npm run build`, `npx prettier --check` sobre lo modificado) y un commit por fase.

---

## 9. Criterio global de salida

- [ ] Todos los checks de cada fase verdes en sus respectivos commits.
- [x] El **checklist final** de `doc/ui-ux.md` recorrido y resuelto (Fase 9.6). _(10/10 recorridos: 8 ✅, 1 ⚠️ no aplica hoy, 1 🟡 móvil pendiente de smoke — ver tabla 9.6.)_
- [x] `npm test` con total anotado (base: **48/48**). _(Ahora **62/62 en 12 ficheros**.)_
- [x] Bundle sin regresión inaceptable. Medido con **un único script en ambos árboles** (todos los `.js` + `.css` de `dist/admin-schema/browser`, sin comprimir y `gzip -9`): baseline `HEAD` `5879cb1` **539,4 K / 154,0 K** → hoy **639,1 K / 167,2 K** = **+99,7 K raw (+18,5 %) / +13,2 K gzip (+8,6 %)**. Desglose del delta: **Lucide +56,0 K / +4,6 K** · resto de las fases 1-7 **+29,5 K / +7,4 K** · Fase 8 (tema + selector) **+14,2 K / +0,2 K** · Fase 9 **0 K** (los specs no entran al bundle). Los subtotales de gzip suman 12,2 K: los 1,0 K restantes es ruido entre mediciones (el mismo baseline midió 155,0 K en la sección 2.9 y 154,0 K en esta pasada). _Aceptado por el usuario el 2026-10-04: 167,2 K comprimidos para un panel admin es un tamaño sano y el 8,6 % de sobrecosto se paga con Lucide + modo oscuro._
- [x] Smoke manual de los 4 recursos en claro y oscuro, escritorio y móvil. _(OK — confirmado por el usuario el 2026-10-04.)_
- [x] Decisiones de "qué NO hacemos" (§7) confirmadas o ajustadas por el usuario. _(Confirmada el 2026-10-04 con una ampliación: el mantenimiento pidió que lo descartado quedara documentado para poder retomarlo, así que nació `doc/backlog-ui-ux.md` con el motivo de cada descarte, el pipeline de incorporación y los candidatos pendientes.)_
