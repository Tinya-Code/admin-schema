# Propuesta: motor instalable desde npm y generador de backend para Apps Script

La meta es que otro proyecto pueda instalar desde npm el motor declarativo
completo: **los contratos y utilidades de schemas, el runtime Angular que
renderiza formularios/vistas con los componentes existentes, y las
herramientas para validar y extenderlos**. Además, cuando el consumidor use
Google Apps Script, una CLI debe generar un backend autónomo compatible con
ese entorno. El renderer Angular y el runtime GAS son runtimes distintos:
comparten contratos donde corresponda, pero uno no se ejecuta dentro del otro.

> **No asumir que Apps Script puede ejecutar el paquete npm directamente.**
> El runtime V8 de Apps Script no ofrece el sistema de módulos Node/ESM que
> usa un paquete npm. El generador debe convertir/ensamblar el runtime y la
> configuración declarativa a archivos `.js` globales, ordenados y listos
> para desplegar con clasp.

## Resultado deseado

Un proyecto consumidor debería poder:

1. Instalar desde npm el contrato y los paquetes de runtime que necesite.
2. Usar en una aplicación Angular el motor de renderizado y los componentes
   declarativos existentes, sin copiar `src/app` al proyecto consumidor.
3. Crear schemas, configuración y extensiones en su propio proyecto.
4. Validar localmente esos schemas y recibir errores accionables.
5. Si usa Apps Script, generar el backend en una carpeta local del proyecto.
6. Configurar su proyecto de clasp y sus secretos por separado.
7. Ejecutar `clasp push`, versionar y desplegar bajo su control.
8. Actualizar los paquetes npm y recibir un diff revisable, sin perder
   código propio ni sobrescribir secretos.

Flujo ilustrativo; los nombres de paquete y comandos son provisionales:

```sh
npm install @tinya-code/admin-schema
npm install @tinya-code/admin-schema-angular
npx admin-schema init
npx admin-schema validate
npx admin-schema generate appsscript --outDir api
```

En Angular, el consumidor configura el renderer y declara sus propios schemas;
la librería aporta los hosts, el registro y los componentes que los descriptores
resuelven. Esta forma de uso es conceptual hasta que se diseñe y pruebe la API
pública:

```ts
// Ejemplo conceptual: nombres/exportaciones pendientes de diseño.
import { provideSchemaRenderer } from '@tinya-code/admin-schema-angular';

bootstrapApplication(App, {
  providers: [provideSchemaRenderer()],
});
```

La aplicación consumidora conserva sus rutas, autenticación, temas y reglas de
negocio. La librería ofrece los componentes declarativos reutilizables; no
obliga a adoptar la aplicación de muestra completa.

Un proyecto consumidor podría conservar una estructura semejante a esta:

```text
mi-proyecto/
├── admin-schema.config.ts       # configuración del generador
├── schemas/                     # schemas propios de la aplicación
├── src/                         # app Angular y configuración del consumidor
│   └── app/
│       ├── app.config.ts        # integra el renderer publicado
│       └── schemas/             # schemas UI de la app, si se mantienen aquí
├── api/                         # salida GAS generada y configuración local
│   ├── appsscript.json
│   ├── .claspignore
│   ├── .clasp.json              # local; contiene scriptId y no se publica
│   ├── core/
│   ├── engine/
│   ├── capabilities/
│   ├── schema/
│   └── setup/
└── package.json
```

## Cómo separar las piezas

| Pieza                    | Se instala/ejecuta dónde                               | Responsabilidad                                                                        |
| ------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Contrato de schemas      | Node, TypeScript y herramientas consumidoras           | Tipos, versiones de contrato, validación y utilidades puras.                           |
| Runtime Angular          | Dependencias npm de la app Angular                     | Hosts/renderers, registro, componentes de campos, vistas, layouts, widgets y formatos. |
| Componentes Angular      | Se importan desde el paquete en la app consumidora     | UI declarativa existente; ampliable con componentes registrados por el consumidor.     |
| Runtime backend          | Se genera como archivos fuente dentro del proyecto GAS | Router, CRUD, validación, capacidades y setup compatibles con GAS.                     |
| CLI/generador            | Node local del proyecto consumidor o CI                | Inicializar, validar, generar, comparar y diagnosticar salidas.                        |
| Schemas de la aplicación | Proyecto consumidor                                    | Recursos, endpoints, permisos, vistas y opciones particulares.                         |
| Despliegue               | Cuenta del propietario vía clasp                       | Push, versiones, deployments, properties y operación de GAS.                           |

### Paquetes npm posibles

La recomendación es mantener un solo repositorio/workspace de desarrollo, pero
publicar paquetes con fronteras de runtime claras. El contrato no debe arrastrar
Angular; el renderer Angular declara Angular como `peerDependencies`; y ni la
CLI ni el paquete GAS deben ser dependencias de runtime de la aplicación
Angular. Así el consumidor instala sólo las piezas que usa y las versiones
pueden evolucionar sin mezclar requisitos incompatibles.

| Nombre ilustrativo                    | Alcance posible                                            | Condición                                                                            |
| ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `@tinya-code/admin-schema`            | Contratos, validadores y utilidades neutrales a framework. | Base compartida; no importa Angular ni APIs GAS.                                     |
| `@tinya-code/admin-schema-angular`    | Runtime Angular, renderer, hosts y componentes de UI.      | Angular como `peerDependency`; incluye exports públicos explícitos.                  |
| `@tinya-code/admin-schema-cli`        | CLI que valida/genera y usa el contrato.                   | Puede comenzar junto al generador y separarse si lo requieren releases/dependencias. |
| `@tinya-code/admin-schema-appsscript` | Runtime/plantillas GAS ensamblables.                       | Salida autónoma; no requiere instalar npm en Apps Script.                            |

Los nombres no quedan decididos en esta propuesta. F0 debe confirmar si el
runtime Angular se publica como paquete propio (recomendado por su dependencia
de Angular), acordar compatibilidad entre versiones Angular soportadas, alcance
público/privado, organización npm y versionado antes del primer release.

## Arquitectura propuesta

### 1. Paquete de contrato compartido

- Definir una API pública estable para `ResourceSchema`, `EndpointSchema`,
  `UiViewDescriptor`, relaciones y capacidades declarables.
- Mantener separados los contratos de frontend, backend, generador y runtime
  donde sus necesidades no sean idénticas.
- Exportar tipos TypeScript y, cuando haga falta, validadores runtime sin
  depender de Angular ni de Google Apps Script.
- Versionar el formato de schema explícitamente (`schemaVersion` o una
  estrategia equivalente); validar migraciones y compatibilidad.
- No hacer que el paquete acceda a archivos del repo, variables de entorno,
  cuenta GAS, credenciales ni Script Properties al importarse.

### 2. Runtime de renderizado y componentes Angular

- Extraer del frontend actual la API estable del renderer: contratos de
  descriptores, registro, resolución de componentes, hosts y providers de
  inicialización, conservando su comportamiento declarativo y lazy loading.
- Distribuir como parte del paquete Angular los componentes reutilizables ya
  existentes en `fields/`, `columns/`, `widgets/`, `views/` y `layouts/`, más
  los componentes de formulario/lista/detalle/dashboard que se decida soportar.
- Mantener los schemas de cada aplicación en el proyecto consumidor. El paquete
  trae el catálogo/renderers predeterminados, no los schemas privados ni las
  rutas, permisos o datos de la aplicación de muestra.
- Definir una API de registro/extensión para que un consumidor añada sus propios
  campos, widgets, formatos, vistas y layouts sin editar el paquete ni sus
  hosts. Los componentes adicionales deben declarar inputs, tipo, versión y
  superficies soportadas conforme al contrato público.
- Separar la UI genérica de piezas acopladas a este producto (shell, sidebar,
  autenticación, servicios API concretos, branding y flujos propios). Sólo
  incluirlas como adaptadores opcionales si se diseña un contrato portable.
- Declarar Angular y las dependencias Angular compatibles como
  `peerDependencies`; evitar incluir otra copia de Angular en el bundle.
- Publicar exports explícitos y soportar tree-shaking/lazy loading; comprobar
  que importar un componente no carga todos los componentes de UI.
- Probar el paquete dentro de una aplicación Angular limpia, con schemas propios,
  y verificar renderizado, validación, accesibilidad y registro de extensiones.

### 3. Runtime GAS generado

- Mantener una fuente de runtime GAS con convenciones que Apps Script soporte:
  funciones globales, ausencia de `import`/`export`/`require` en la salida y
  carga segura en el orden requerido.
- Incluir sólo módulos/capacidades seleccionados por la configuración del
  proyecto, si el diseño permite resolver dependencias sin romper registros.
- Producir archivos `.js`, `appsscript.json`, `.claspignore` y el orden de
  carga (`filePushOrder`) de forma reproducible.
- Generar los schemas de la app dentro de la carpeta `schema/` GAS mediante
  una transformación explícita desde el contrato de origen.
- Asegurar que la salida no dependa de `node_modules` ni de importar el paquete
  npm durante la ejecución de Apps Script.
- Respetar límites de Apps Script (cuotas, tiempo, tamaño, APIs y modelo de
  despliegue); no prometer soporte Node en GAS.

### 4. CLI y ciclo de vida del proyecto

Comandos ilustrativos — se definirán durante la fase de diseño:

| Comando               | Acción                                                                                                  | No debe hacer                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `init`                | Crear estructura mínima e integrar contratos/renderer Angular si se solicita, más configuración y guía. | Crear un deployment real o inventar credenciales.       |
| `validate`            | Validar schemas, referencias, tipos, plugins y compatibilidad.                                          | Escribir archivos ni ocultar advertencias.              |
| `generate appsscript` | Emitir runtime y schemas GAS reproducibles.                                                             | Generar o sobrescribir el frontend Angular.             |
| `diff`                | Comparar salida generada actual con la que produciría la versión instalada.                             | Aplicar cambios automáticamente.                        |
| `doctor`              | Verificar Node, clasp/config local, manifiesto y requisitos de generación.                              | Imprimir secretos o valores de configuración sensibles. |
| `upgrade`             | Migrar la versión del schema/plantillas con diff y aprobación.                                          | Reemplazar personalizaciones sin conflicto visible.     |

Cada comando debe usar mensajes claros, códigos de salida no-cero ante errores
y un modo `--dry-run` donde tenga sentido.

## Modelo de propiedad de archivos

La actualización npm no debe convertir la regeneración en una sobrescritura
insegura. Cada archivo de salida necesita una política visible:

| Clase de archivo                | Dueño                        | Comportamiento al regenerar                                          |
| ------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| Runtime generado                | Paquete                      | Regenerar entero; personalizaciones viven fuera de él.               |
| Schema GAS generado             | Config/schema del consumidor | Regenerar a partir de fuentes declarativas versionadas.              |
| Archivos del usuario            | Consumidor                   | Nunca reemplazar.                                                    |
| Archivos locales de clasp       | Operador                     | No generar credenciales; preservar `scriptId` y configuración local. |
| Extensiones propias             | Consumidor                   | Cargarlas mediante puntos de extensión registrados y validados.      |
| Manifiestos/catálogo de módulos | Generador + config           | Regenerar determinísticamente y mostrar diffs.                       |

Opciones a evaluar para proteger esta frontera:

- Separar con claridad `generated/` de `custom/`.
- Añadir cabeceras de archivo generado y un manifest con hashes/versiones de
  origen.
- Comparar el contenido existente antes de regenerar y fallar si el usuario
  modificó una salida administrada sin registrar esa personalización.
- Ofrecer `diff` y `--force` explícito; `--force` nunca borra carpetas ajenas.
- Mantener hooks/plugins como API versionada, no como edición directa de
  `engine/` generado.

## Schemas y fuentes de verdad

La librería no debe imponer un único repositorio o arquitectura de aplicación.
El diseño debe fijar qué archivos declara cada consumidor y cuál es la fuente
autoritativa:

```ts
// Ejemplo conceptual. No es todavía una API aprobada.
export default defineApplication({
  schemaVersion: 1,
  resources: [/* schemas del proyecto */],
  endpoints: [/* endpoints declarativos */],
  capabilities: [/* extensiones habilitadas */],
  appsscript: {
    timeZone: 'America/Lima',
    entryPoints: ['doGet', 'doPost'],
  },
});
```

Decisiones requeridas antes de implementar:

- TypeScript, JavaScript, JSON o más de un formato de entrada.
- Si el generador lee schemas desde módulos TS compilados o desde formatos
  serializables sin ejecutar código arbitrario.
- Cómo se validan funciones personalizadas: deben registrarse como capacidades
  explícitas, no evaluarse como texto desde un schema.
- Cómo se generan los recursos GAS sin duplicar manualmente el schema fuente.
- Compatibilidad entre schemas de frontend y backend, que pueden tener
  audiencias distintas y no deben exponerse mutuamente secretos/configuración.

## Seguridad y operación

- Secrets, IDs de spreadsheet y `scriptId` nunca se emiten dentro del paquete,
  ejemplos comprometidos o archivos versionados por defecto.
- La configuración sensible permanece en Script Properties o en un almacén
  local excluido de git; el CLI no imprime valores sensibles en logs.
- El generador no realiza despliegues implícitos. Push/deploy son acciones
  explícitas del usuario, con proyecto y entorno visibles.
- `appsscript.json`, `filePushOrder`, `.claspignore` y rutas generadas se
  validan antes de dar éxito.
- Los plugins/extensiones se consideran código confiable con privilegios
  declarados; validar schema no vuelve seguro un plugin malicioso.
- El paquete debe tener SBOM/dependencias auditables, provenance de release,
  política de publicación y protección de tokens npm en CI.
- Distinguir validación estática local de verificación real contra la cuenta
  GAS. Ninguna generación local prueba por sí sola un deployment funcional.

## Plan por fases

### F0 — Inventario y límites

- [ ] Inventariar runtime, schemas, scripts de validación, orden de carga,
      dependencias y configuración clasp existentes; incluir el renderer
      Angular y los catálogos actuales de fields, columns, widgets, views y layouts.
- [ ] Clasificar los componentes Angular en reutilizables, específicos de la
      aplicación de muestra y dependientes de servicios/configuración locales.
- [ ] Identificar qué módulos pueden distribuirse y cuáles dependen del repo,
      entorno Angular, APIs, secretos o globals de Apps Script.
- [ ] Definir consumidores objetivo por runtime: Angular/TypeScript, proyectos
      JS para tooling, CLI y GAS.
- [ ] Definir rango de versiones Angular compatible y el soporte inicial para
      standalone components, lazy loading y SSR (si se ofrece).
- [ ] Elegir primera meta soportada y declarar explícitamente lo no soportado.
- **Salida:** matriz de dependencias y límites, inventario de componentes
  publicables y ejemplos reales de uso Angular y GAS.

### F1 — Contrato público de schemas

- [ ] Extraer los tipos estables sin arrastrar imports privados ni Angular.
- [ ] Separar contratos de schema/descriptor de las clases de componentes
      Angular para que el paquete base pueda consumirse sin framework.
- [ ] Definir versión del schema, semántica de defaults, extensiones y
      compatibilidad.
- [ ] Implementar validación runtime para schemas externos y errores con
      archivo/ruta/campo.
- [ ] Añadir fixtures de schemas válidos, inválidos y versiones anteriores.
- **Salida:** un consumidor puede tipar y validar sus schemas importando el
  contrato npm, sin importar fuentes internas del monorepo.

### F2 — Publicar el renderer y los componentes Angular

- [ ] Extraer el runtime del registro/render y los componentes genéricos desde
      `src/app/` a un paquete Angular independiente, manteniendo la app actual
      como consumidor de ese paquete durante la transición.
- [ ] Publicar como API soportada los hosts, providers y descriptores; no
      exponer accidentalmente servicios, modelos internos o rutas privadas.
- [ ] Mover/reusar campos, formatos de columna, widgets, vistas y layouts
      existentes; determinar explícitamente si list/detail/form/dashboard son
      componentes públicos o composiciones de ejemplo.
- [ ] Declarar `@angular/core`, `@angular/common`, `@angular/forms` y cualquier
      otro peer dependency requerido con rangos compatibles; probar que npm no
      instala duplicados incompatibles de Angular.
- [ ] Permitir que la app consumidora registre componentes propios conforme al
      contrato, sin modificar hosts, registros internos ni fuentes del paquete.
- [ ] Verificar imports públicos, tree-shaking, lazy loading, estilos/assets,
      accesibilidad y compatibilidad con builds Angular de producción.
- [ ] Instalar el tarball en una app Angular aislada y renderizar schemas
      propios; probar también una extensión de consumidor.
- **Salida:** una aplicación Angular independiente usa los componentes y el
  motor publicados sin importar rutas internas ni copiar archivos del repo.

### F3 — Empaquetar el runtime GAS como artefacto autónomo

- [ ] Decidir fuente de distribución: plantillas empaquetadas, bundle
      compatible con GAS o combinación verificable.
- [ ] Resolver el orden de carga determinísticamente desde dependencias
      declaradas; comprobar referencias globales antes de generar.
- [ ] Generar `core/`, `engine/`, capabilities, setup y schemas de app con
      estructura consistente con Apps Script.
- [ ] Probar que la salida no contiene módulos Node/ESM sin transformar ni
      dependencias externas requeridas en runtime.
- [ ] Preservar `filePushOrder`, `.claspignore`, manifiesto GAS y exclusiones
      de tests/docs como artefactos explícitos y comprobables.
- **Salida:** carpeta generada que se puede inspeccionar, probar localmente y
  subir con clasp sin consultar el repo del motor.

### F4 — CLI `init`, `validate` y `generate`

- [ ] Diseñar CLI con mensajes, opciones, códigos de salida y rutas previsibles.
- [ ] Implementar inicialización/integración con un frontend Angular existente
      sin asumir que toda aplicación debe generarse desde cero.
- [ ] Ofrecer scaffolding Angular opcional con los paquetes, providers y
      ejemplos mínimos, sin incluir credenciales ni despliegues.
- [ ] Mantener la generación GAS como comando opcional e independiente del
      build/serve del frontend.
- [ ] Validar configuración, schemas, referencias y extensiones antes de
      modificar archivos.
- [ ] Generar output estable y repetible; dos ejecuciones con mismas entradas
      producen diff vacío.
- [ ] Añadir `--outDir`, `--dry-run` y manejo fail-loud de rutas no válidas.
- **Salida:** proyecto de ejemplo completo generado mediante comandos.

### F5 — Frontera entre generado y personalizado

- [ ] Clasificar todos los archivos como generados, configuración local o
      código del usuario.
- [ ] Añadir manifest/hashes de generación y cabeceras legibles en artefactos.
- [ ] Implementar detección de modificaciones locales y conflictos antes de
      sobrescribir.
- [ ] Definir puntos de extensión para handlers/capabilities, sin editar
      runtime generado.
- [ ] Probar regeneración sobre un proyecto modificado y recuperación segura.
- **Salida:** actualizar el paquete no destruye cambios del consumidor.

### F6 — Plugins/capacidades extensibles

- [ ] Definir API/versionado de plugins para capabilities, tipos de campo,
      validadores, computed, handlers y descriptores Angular de widgets,
      formatos, vistas y layouts.
- [ ] Validar ids, dependencias, versiones y conflictos de nombres.
- [ ] Determinar qué plugins pueden compilarse a GAS y cuáles sólo corren en
      Node/frontend.
- [ ] Crear plugin de prueba que se registra sin modificar el núcleo.
- [ ] Documentar límites de confianza, permisos y requisitos de compatibilidad.
- **Salida:** extensión de ejemplo compatible se valida, genera y ejecuta sin
  cambiar el motor base.

### F7 — Proyecto de referencia y prueba de extremo a extremo

- [ ] Crear un consumidor de prueba fuera del árbol de fuentes del paquete.
- [ ] Instalar el paquete como lo haría un usuario npm (incluido tarball `npm
pack`, no sólo imports desde el monorepo).
- [ ] En una app Angular limpia, instalar los tarballs, configurar el renderer,
      declarar una vista/form propio y agregar un renderer de ejemplo.
- [ ] Como flujo independiente del frontend, declarar un recurso mínimo,
      validar, generar `api/` y ejecutar tests/harness contra la carpeta generada.
- [ ] Verificar carga, setup, schema, handlers, orden global y ausencia de
      secretos en artefactos.
- [ ] Hacer smoke opcional contra un Apps Script de prueba con autorización y
      proyecto de usuario; nunca en cada fase si no corresponde.
- **Salida:** guía reproducible desde repo vacío hasta backend generado y
  validado localmente.

### F8 — Versionado y publicación npm

- [ ] Decidir nombre/owner de paquete, licencia, visibilidad, soporte y
      estrategia de releases.
- [ ] Definir semver y matriz de compatibilidad Angular para contrato, paquete
      Angular, CLI y runtime GAS; explicar qué incompatibilidad eleva major.
- [ ] Generar changelog/notas, probar `npm pack`, instalar el tarball en un
      proyecto limpio y verificar exports/archivos incluidos.
- [ ] Añadir CI con tests, build, validación del paquete, provenance y
      publicación protegida con aprobación.
- [ ] Publicar primero prerelease/tag de prueba; documentar rollback y
      deprecación.
- **Salida:** release instalable que funciona fuera del repositorio fuente.

### F9 — Upgrade y migración segura

- [ ] Implementar `diff` entre artefacto existente y versión nueva.
- [ ] Migrar versiones de schema con pasos explícitos y reversibles cuando
      sea viable; no cambiar datos productivos automáticamente.
- [ ] Rechazar upgrade ambiguo o con conflictos sin aprobación; ofrecer
      informe legible por archivo y recurso.
- [ ] Probar N→N+1, N→N+2 si se soporta, personalizaciones y downgrade/
      rollback de runtime.
- [ ] Documentar límites de migración de GAS y separación entre regenerar,
      `clasp push`, crear versión y re-apuntar deployment.
- **Salida:** consumidor puede actualizar dependencia, revisar diff, aplicar
  migración y desplegar bajo control explícito.

## Matriz de validación de extremo a extremo

| Capa            | Evidencia mínima                                                                         |
| --------------- | ---------------------------------------------------------------------------------------- |
| API pública npm | Import desde TS/JS de proyecto limpio; exports sólo los intencionados.                   |
| Contrato        | Schemas y descriptores tipados/validados sin dependencia obligatoria de Angular.         |
| Angular         | App limpia instala el tarball, renderiza campos/vistas y registra un componente propio.  |
| Compatibilidad  | Build Angular de producción; peer dependencies sin copias incompatibles del framework.   |
| Validador       | Casos válidos/inválidos con diagnóstico exacto y exit code adecuado.                     |
| Generación      | Determinista, sin secretos, rutas seguras y archivos completos.                          |
| GAS             | Sin `import`/`export`/`require`; `filePushOrder` correcto; funciones globales presentes. |
| Tests           | Pruebas Angular sobre el paquete y harness GAS sobre la salida generada.                 |
| Seguridad       | Escaneo de secretos; `.clasp.json` local/excluido; logs redacted.                        |
| Actualización   | Diff de versión, conflicto detectado y archivos propios preservados.                     |
| Publicación     | `npm pack` instalable; workflow/version/tag reproducible y aprobable.                    |
| Despliegue      | `clasp push` / version / deploy separados y explícitos; smoke bajo proyecto autorizado.  |

## Riesgos que el diseño debe resolver

| Riesgo                                          | Mitigación requerida                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Confundir instalación npm con runtime GAS       | Documentar la frontera: npm ejecuta CLI/tooling; GAS recibe código generado.              |
| Publicar Angular acoplado a la app de muestra   | Extraer contratos y componentes genéricos; aislar shell, auth y servicios específicos.    |
| Duplicar Angular o romper compatibilidad        | `peerDependencies`, matriz de versiones y pruebas en app Angular consumidora limpia.      |
| Perder lazy loading/estilos al empaquetar UI    | Verificar exports, assets, tree-shaking, compilación AOT y carga diferida en producción.  |
| Distribuir fuentes internas acopladas al repo   | Publicar sólo API soportada; tests del tarball y consumidor externo.                      |
| Regenerar encima de personalizaciones           | Separar ownership, manifest, diff y parada ante conflictos.                               |
| Divergencia entre schema TS y schema global GAS | Un único origen declarativo + pruebas de equivalencia/round-trip.                         |
| Orden de carga incorrecto                       | Grafo de dependencias validado y generación determinista de `filePushOrder`.              |
| Generador que evalúa código no confiable        | Entrada serializable/registrada; no `eval` de schemas ni plugins no confiables.           |
| Cambios incompatibles en upgrades               | Versiones coordinadas, migraciones explícitas y política SemVer.                          |
| Falsa confianza por tests Node                  | Ejecutar harness sobre salida generada y reservar smoke GAS real para entorno controlado. |
| Filtrado accidental de secretos                 | Allowlist de artefactos y test de escaneo/redacción.                                      |
| Prometer capacidades que GAS no soporta         | Matriz de plataforma, límites medidos y aceptación condicionada a pruebas.                |

## Fuera de alcance inicial

- Desplegar automáticamente a una cuenta GAS/NPM sin autorización explícita.
- Sincronizar deployments o Script Properties entre cuentas.
- Compilar cualquier código Node a GAS de forma mágica.
- Permitir que schemas ejecuten JavaScript arbitrario.
- Garantizar que el usuario nunca necesite conocer clasp o configurar permisos.
- Publicar sin clasificación todos los archivos actuales, incluidos shell,
  autenticación, servicios y flujos específicos de la app de muestra.
- Migrar automáticamente datos reales de Sheets al actualizar el paquete.

## Criterio de éxito

Un proyecto Angular limpio instala los paquetes publicados, declara schemas
propios, renderiza formularios/vistas con los componentes distribuidos y puede
añadir un componente sin editar el motor. Si el proyecto usa GAS, también
valida sus schemas y genera una carpeta `api/` independiente del repo fuente,
ejecuta las pruebas contra esa salida y puede desplegarla con clasp de forma
explícita. Al actualizar versiones npm, el consumidor ve un diff, conserva sus
personalizaciones y entiende cualquier cambio de contrato antes de aplicarlo.

## Próximo paso recomendado

Iniciar F0 con dos pruebas pequeñas y separadas: (1) instalar un tarball del
renderer y algunos componentes Angular en una app aislada, renderizar un schema
y registrar un componente del consumidor; (2) generar un backend GAS mínimo a
un directorio temporal y cargarlo con el harness existente. No publicar ni
mover todo el repositorio a workspaces hasta demostrar ambas fronteras.

Referencias actuales:

- `api/README.md` — estructura/limitaciones del backend GAS.
- `api/MAPA.md` — carga global, `filePushOrder` y despliegue con clasp.
- `api/PLAN.md` — plan del backend actual.
- `doc/plan-refactor-motor.md` — fases de desacoplamiento y extensibilidad del motor.
