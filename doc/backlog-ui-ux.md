# Backlog de controles UI/UX pendientes

> **Origen:** §7 «Qué NO hacemos» (histórico: `plan-mejoras-ui-ux.md`),
> confirmada por el mantenimiento el 2026-10-04.
>
> **Regla de admisión:** un ítem sale de este documento y entra en un plan
> **cuando un requisito real lo pide**, con el schema que lo declara en la mano.
> Este archivo es un recordatorio con contexto, no una hoja de ruta: nada de lo
> que hay aquí está comprometido.

---

## 1. Por qué existe

El panel es **schema-driven**: dibuja lo que el schema declara, y esa es toda su
arquitectura. Es lo que hace que un recurso nuevo del backend aparezca con cero
cambios en `src/`.

La guía `doc/ui-ux.md`, en cambio, es normativa y describe _todo_ lo que un
panel de campos podría mostrar. La mayor parte de eso **ningún schema de este
proyecto lo declara**. Construirlo de todas formas significa mantener caminos de
código que nadie puede ejercitar: sin schema que lo declare, sin test contra un
caso real, y con una forma probablemente distinta a la que se pedirá cuando
aparezca el primer caso.

Así que se descarta **con el motivo escrito**. Este documento conserva ese
motivo y, de paso, el de otros componentes que se identificaron como posibles.

---

## 2. El schema de prueba: cómo se implementa y se prueba un control nuevo

La forma de ensayar un control **antes de que ningún recurso real lo necesite**
ya existe en el proyecto y es el mecanismo clave de este backlog:

**`form-view.a11y.spec.ts` declara `ALL_TYPES_SCHEMA`** (`id: 'all-types'`, en la
línea 299) — un schema sintético con los 20 tipos actuales, **sin `layout`** para
que todos los campos se monten de una sola vez, se empuja al catálogo en el
`beforeEach` y se retira en el `afterEach`. El helper `assertFieldA11y` comprueba
para cada campo que tenga etiqueta asociada, `aria-describedby` cuando hay ayuda
o error, y `aria-invalid` coherente.

**Para probar un control nuevo se añade su campo a ese schema de prueba** y se
corre la batería. Un schema de prueba declarado en un spec **no toca `registry.ts`
ni el backend**: vive y muere en el test.

Cuando el control pasa a usarse de verdad, la cosa cambia de carácter — ver §3.

---

## 3. Pipeline de incorporación

Checklist completo para promover un ítem de este backlog a implementación:

1. **Modelo** — interfaz nueva en `core/models/schema.model.ts` y alta en la
   unión `FieldSchema` (línea 246). Todas extienden `FieldBase<T>`; las que
   admiten opciones usan `ListOptions`.
2. **Componente** — `src/app/fields/<tipo>/`, selectado `Field<Tipo>`. Dibuja
   **sólo el control**: el rótulo, la ayuda, el error y los `aria-*` los pone
   `field-host`.
3. **Dispatch** — en `fields/field-host/field-host.ts`: import del componente,
   entrada en `SUPPORTED_FIELD_TYPES` (línea 54) y `@case` en el `@switch`
   (línea 166).
4. **Schema de prueba** — añadirlo a `ALL_TYPES_SCHEMA` y verificar con
   `assertFieldA11y`. Si el control tiene estados (dependencias, condicionales),
   cubrirlos con un caso en `form-view.spec.ts`.
5. **Uso real** — sólo aquí: declararlo en un schema de producción
   (`src/app/schemas/*.schema.ts`), **registrarlo en `schemas/registry.ts`**
   (lo exige la regla 5 de `api:check`) y que el backend lo emita (lo exige el
   contract check back↔front).
6. **Verificación** — `npm test`, `npm run build`, `npx prettier --check "src/**"`
   y `npm run api:check`, más smoke visual.

**Frontera importante:** los pasos 1–4 son **internos** y no requieren backend.
El paso 5 es el que abre el contrato con la API.

---

## 4. Controles que el modelo no puede expresar hoy

| Control                     | Qué es                                                               | Qué falta                                                                        | Cuándo se justifica                                                                           |
| --------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Texto enriquecido**       | Editor WYSIWYG (negritas, listas, enlaces) en lugar de un `textarea` | Tipo `richtext`, componente, decisión de sanitizado y de dónde se guarda el HTML | Un schema necesite contenido con formato y el backend ya sepa recibirlo                       |
| **Contraseña**              | Campo con revelar/ocultar, no autocompleteado                        | Tipo `password` + componente                                                     | Un schema declare credenciales. **Hoy no existe ningún campo `password` en el modelo**        |
| **Fortaleza de contraseña** | Medidor débil/media/fuerte bajo el campo                             | Depende del paso anterior: sin campo `password` no hay nada que medir            | Junto con el anterior, nunca antes                                                            |
| **Color**                   | Selector de color con valor hexadecimal                              | Tipo `color` + componente                                                        | Un schema pinta algo (tema, etiqueta) y el usuario debe elegirlo                              |
| **Geolocalización / mapa**  | Selector de punto en un mapa                                         | Tipo `geo`, componente de mapa, dependencia externa y clave de servicio          | Un schema maneje coordenadas. Hoy ninguno lo hace                                             |
| **Slider / rango numérico** | Control deslizante en vez de escribir el número                      | Tipo `range` con `min`/`max`/`step`                                              | Un campo numérico tenga una escala física acotada (no es el caso de precio, stock o posición) |

---

## 5. Controles de escala — ya resueltos por otra vía

| Control                                | Qué es                                                             | Por qué no aplica                                                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wizard por pasos**                   | Formulario en pantallas secuenciales (Paso 1 → Siguiente → Paso 2) | La guía lo recomienda desde ~40 campos; el techo real es **19** (`products`). Eso cae en la banda 9–20, donde **secciones y pestañas ya resuelven** (Fase 5). Añadirlo sería estado nuevo —¿en qué paso estoy?, validación por paso, navegación atrás— para un caso inexistente |
| **Índice lateral + pestañas a la vez** | Pestañas arriba **y** índice lateral pegado                        | En `mode: 'tabs'` las pestañas **ya son** el índice; mostrar las dos es dibujar lo mismo dos veces. El índice lateral existe, pero sólo en `mode: 'sections'`, donde no hay pestañas                                                                                            |
| **Stepper `+/-`**                      | Numeral con flechitas de «cantidad»                                | Ningún campo numérico tiene esa semántica: precio, stock y posición se renderizan como número simple                                                                                                                                                                            |
| **Editor de dos calendarios**          | Selector de rango inicio/fin con atajos                            | Ningún schema declara un rango de fechas. Cuando aparezca uno, conviene reutilizar `date` doble en vez de inventar un cuarto componente                                                                                                                                         |

---

## 6. Pendiente de decisión de producto

| Ítem                                       | Qué es                                                      | Qué falta decidir                                                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Autocompletado / defaults inteligentes** | Sugerir valores de entradas anteriores o prellenar al crear | **De dónde salen los defaults**: ¿del schema, del backend, del historial de la tabla? Es una decisión de producto, no de UI, y no la resuelve un componente |

---

## 7. Otros componentes identificados

Candidatos detectados durante las fases 1–9, con la evidencia que los motiva.
Ninguno está comprometido; se promueven por el mismo criterio de §1.

| Candidato                                            | Evidencia concreta                                                                                                                                                                   | Se justifica cuando…                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **Paginación de la lista**                           | `list-view` **no tiene ninguna** — cero rastros de `page`, `offset`, `limit` o `slice` (hallazgo de la tarea 9.4). Hoy el listado pinta todos los registros que devuelve el endpoint | Un recurso crezca hasta que el listado completo sea lento o no quepa en pantalla |
| **Deshacer tras eliminar**                           | El diálogo de confirmación advierte explícitamente «no se puede deshacer»                                                                                                            | Se pidan borrados accidentales recuperables; exige soporte en el backend         |
| **Selección múltiple / acciones en lote**            | La lista sólo actúa registro por registro                                                                                                                                            | Un recurso necesite publicar, archivar o borrar de a muchos                      |
| **Columnas configurables**                           | `listColumns` es fijo en el schema; no hay forma de mostrar/ocultar columnas en runtime                                                                                              | Diferentes roles quieran vistas distintas del mismo recurso                      |
| **Exportar a CSV**                                   | No existe ninguna salida de datos                                                                                                                                                    | Se necesite sacar datos del panel a una hoja de cálculo                          |
| **Búsqueda difusa**                                  | Hoy la búsqueda y los filtros usan `String.includes` literal: «categoría» no encuentra «categorias»                                                                                  | Los usuarios empiecen a quejarse de búsquedas que «deberían encontrar»           |
| **Vista alternativa de la lista** (kanban / galería) | `layout.mode` ya distingue `sections`/`tabs` **para formularios**; la lista sólo tiene tabla                                                                                         | Un recurso sea inherentemente visual (tareas, catálogo) y la tabla lo dificulte  |
| **Historial / auditoría**                            | No hay rastro de quién cambió qué ni cuándo                                                                                                                                          | Se exija trazabilidad de cambios                                                 |
| **Importación CSV/Excel**                            | Sólo existe subida de imágenes (`upload.service`)                                                                                                                                    | Se necesite cargar datos existentes de golpe                                     |
| **Filtros por fecha rápidos**                        | `filters` es genérico (`=` / `in`); no hay «hoy», «últimos 7 días»                                                                                                                   | El usuario deje de filtrar rangos a mano                                         |

---

## 8. Criterio general

> Si la guía describe un control que ningún schema declara, **no se construye**.
> El panel dibuja lo que el schema dice — esa es su arquitectura, y anticipar
> controles la rompe.

Se incumple una sola vez que se mantenga un componente sin un schema real que lo
declare: ahí empieza el código que nadie prueba y que el primer requisito real
obliga a reescribir.
