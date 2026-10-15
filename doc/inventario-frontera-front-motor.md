# Inventario de frontera — motor de render Angular vs consumidor (F1)

> Espejo de `doc/inventario-frontera-motor-consumidor.md` (F0, backend).
> Objetivo: extraer el motor de render a la librería `@tinya-code/gas-admin-ui`
> (repo `front-gas`), dejando este repo como **consumidor** que sólo declara
> schema y wiring de app. Conteos verificados 2026-10-14.

## 1. Frontera

| Zona                                                                             | Ficheros (no-spec) | Specs  | Lado                             |
| -------------------------------------------------------------------------------- | ------------------ | ------ | -------------------------------- |
| `src/app/fields/` (22 tipos + host)                                              | 56                 | 8      | **motor**                        |
| `src/app/widgets/`                                                               | 15                 | 8      | **motor**                        |
| `src/app/views/` (list/detail/composer/kanban/calendar…)                         | 8                  | 7      | **motor**                        |
| `src/app/actions/`                                                               | 3                  | 4      | **motor**                        |
| `src/app/columns/`                                                               | 10                 | 2      | **motor**                        |
| `src/app/core/` (RenderHost, registries, services, guards, interceptors, models) | 23                 | 17     | **motor**                        |
| `src/app/shell/` (sidebar/topbar/navegación)                                     | 4                  | 2      | **motor**                        |
| **Total motor**                                                                  | **119**            | **48** |                                  |
| `src/app/schemas/*.schema.ts` (8 recursos)                                       | 8                  | 2      | **consumidor**                   |
| `src/app/schemas/registry.ts` (array catálogo)                                   | 1                  | —      | consumidor (hoy) → API del motor |
| `src/app/{app.ts,app.config.ts,app.routes.ts}`                                   | 3                  | 1      | **consumidor**                   |
| `src/styles.css` + `src/styles/{base,theme}.css` (tokens Tailwind v4)            | 3                  | —      | consumidor (tema) — ver G-F3     |
| Specs de integración de app (p. ej. `view-composition.integration.spec`)         | —                  | ~4     | **consumidor**                   |

> La suite actual es 66 ficheros / 604 tests. Se mueven al motor ~48 specs;
> quedan en el consumidor los de integración app + schemas de dominio.

## 2. Decisiones G-F*

| #    | Decisión              | Recomendación                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Estado            |
| ---- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| G-F1 | Repo y paquete        | Repo `front-gas` + `@tinya-code/gas-admin-ui` (separado del CLI: éste no tiene deps Angular; `peerDependencies @angular/* ^22`)                                                                                                                                                                                                                                                                                                                                                                | elegida (usuario) |
| G-F2 | API pública           | `provideGasAdmin({ schemas, campos?, widgets?, vistas?, acciones?, columnas? })` + tipos (`ResourceSchema`, `FieldSchema`, `WidgetSchema`, `ResourceAction`) + registro público de componentes custom. Todo lo demás privado (FESM minificado, sin deep imports).                                                                                                                                                                                                                              | propuesta         |
| G-F3 | Estilos (Tailwind v4) | **Opción A:** la librería compila su propio CSS (tokens = custom properties en `theme.css`; utilities precompiladas en `gas-admin-ui.css` entregado con el paquete). El consumidor importa el CSS de la lib y usa tokens para su tema. **Opción B:** templates sin compilar + `@source` en el consumidor apuntando a `node_modules` (tema unificado, pero acopla el build del consumidor al contenido de la lib). Recomendación: **A** (contrato de theming por CSS vars, sin acoplar builds). | pendiente         |
| G-F4 | Cambio de estado      | Verificar si la app es zoneless/OnPush actualmente; la librería debe declararlo en sus componentes desde el día 1 (señales).                                                                                                                                                                                                                                                                                                                                                                   | verificar         |
| G-F5 | Codegen de schemas    | **No en F1**: los schemas del consumidor siguen siendo TS a mano (tipados, autocomplete); la sincronización back↔front sigue vía contract-check del CLI del backend. Codegen de un solo origen = futuro.                                                                                                                                                                                                                                                                                       | decidido          |
| G-F6 | Loop dev              | `npm pack` en `front-gas` → install acá → `ng serve` (mismo patrón F0).                                                                                                                                                                                                                                                                                                                                                                                                                        | decidido          |
| G-F7 | Specs de motor        | Se mueven con su código al repo de la librería (vitest + Angular del lib project).                                                                                                                                                                                                                                                                                                                                                                                                             | decidido          |

## 3. Riesgos conocidos

- **Dynamic imports del composer** (`view-composition`): los descriptors hacen
  `import()` dinámico de vistas; en la librería deben resolverse contra
  exports del paquete, no rutas internas de la app.
- **Tailwind content scanning** (G-F3): Tailwind v4 ignora `node_modules` por
  defecto → con opción B haría falta `@source` explícito; con A no aplica.
- **Contrato back↔front**: el contract-check (CLI backend) compara
  `api/schema/resources/*.js` ↔ `src/app/schemas/*.schema.ts`; tras la
  extracción el path del consumidor no cambia, pero verificar rutas.
- **Setup inicial de la librería**: ng-packagr + vitest para specs Angular
  requiere tsconfig propio (no hay atajos: es trabajo de setup real).

## 4. Fases F1

1. **Inventario** (este documento) + decisiones G-F* cerradas.
2. **Repo `front-gas`**: workspace con proyecto librería (ng-packagr),
   mover ficheros del motor, specs del motor, primer `dist` verde,
   CI (test + build + pack dry-run).
3. **Consumidor**: este repo instala tarball, importa tipos +
   `provideGasAdmin`, elimina ficheros del motor; gates 604→(n) verdes.
4. **Publicación**: `npm publish --tag alpha` → migrar consumidor al
   registry → deprecar tarball local.
