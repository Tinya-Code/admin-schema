# Estructura base del proyecto Angular

> Define la estructura de carpetas, reglas de dependencia y convenciones del
> admin (`admin-schema`). Derivado de `doc/base.md` (§12), `doc/api.md`,
> la skill `angular-22`, la skill `tailwind-setup` y las Angular Best
> Practices del CLI (Angular 22).
>
> Este documento es **previo a la implementación**: primero se crea el
> esqueleto de carpetas, después se llenan por feature.

---

## 1. Stack

| Elemento        | Decisión                                                        |
| --------------- | --------------------------------------------------------------- |
| Framework       | Angular 22 (standalone, signals, Sin NgModules)                 |
| Forms           | Signal Forms (`@angular/forms/signals`) para formularios nuevos |
| Estilos         | Tailwind v4 (sin `tailwind.config`: tokens en `@theme`)         |
| Formato         | Prettier (`.prettierrc` ya existe)                              |
| Selector prefix | `app` (definido en `angular.json`)                              |

---

## 2. Reglas base de código (Angular 22)

Obligatorias en todo el proyecto:

1. **Componentes standalone sin declarar `standalone: true`** (es default).
2. **Sin `changeDetection: OnPush` explícito** (es default en v22+).
3. **`inject()` siempre**, nunca inyección por constructor.
4. **`input()` / `input.required()` / `output()` / `model()`**, nunca los
   decoradores `@Input()` / `@Output()`.
5. **`@Service()`** en servicios singleton, preferido sobre
   `@Injectable({ providedIn: 'root' })`.
6. **Control flow nativo**: `@if` / `@for` / `@switch` con `track`, nunca
   `*ngIf` / `*ngFor` / `*ngSwitch`.
7. **Bindings nativos**: `[class.x]` y `[style.x]`, nunca `ngClass` / `ngStyle`.
8. **`host` object** en el decorador, nunca `@HostBinding` / `@HostListener`.
9. **Guards funcionales** (`CanActivateFn`) e **interceptors funcionales**
   (`HttpInterceptorFn`).
10. **Rutas con lazy loading** (`loadComponent` / `loadChildren`).
11. **`NgOptimizedImage`** para imágenes estáticas.
12. **Accesibilidad**: pasar checks AXE, mínimo WCAG AA.
13. **TypeScript estricto**: sin `any` (usar `unknown`), tipos explícitos en
    contratos públicos.
14. Estado con **signals**: `signal()` mutable, `computed()` derivado,
    `linkedSignal()` derivado sincronizado. Nunca `.mutate()`.

---

## 3. Estructura de carpetas

La propuesta de `base.md` §12 usa el prefijo `admin/`; en este proyecto la
app **es** el admin, así que esas carpetas viven directamente bajo `src/app/`.

```
src/
├── index.html
├── main.ts
├── styles.css                        # entrada de estilos (la referencia angular.json → styles[])
├── styles/                           # parciales importados desde styles.css
│   ├── theme.css                     # @theme de Tailwind v4 (tokens de color/tipografía)
│   └── base.css                      # reset, estilos base de formularios
│
└── app/
    ├── app.ts / app.html / app.css   # shell raíz (router-outlet + estado global)
    ├── app.config.ts                 # providers: router, http + interceptors, signals forms
    ├── app.routes.ts                 # rutas raíz → lazy load del shell
    │
    ├── core/                         # SINGLETONS de la app. Una sola instancia.
    │   ├── models/
    │   │   ├── schema.model.ts       # ResourceSchema, FieldSchema (uniones discriminadas por `type`)
    │   │   └── api.model.ts          # contratos de la API, ApiError, páginas
    │   ├── services/
    │   │   ├── api.service.ts        # CRUD genérico por endpoint del schema
    │   │   ├── upload.service.ts     # subida de imágenes → URL pública
    │   │   ├── error-mapper.service.ts  # errores 422 → ruta de campo
    │   │   └── notification.service.ts  # toasts / confirmaciones
    │   ├── interceptors/             # HttpInterceptorFn (auth token, manejo de error global)
    │   ├── guards/                   # CanActivateFn
    │   └── tokens.ts                 # InjectionToken (API_URL, etc.)
    │
    ├── shared/                       # REUTILIZABLE y agnóstico de dominio
    │   ├── components/               # button, modal, spinner, empty-state, badge, skeleton...
    │   ├── pipes/
    │   ├── directives/
    │   └── utils/
    │       ├── gap-sorting.ts        # ordenamiento con huecos (base.md §8)
    │       ├── condition-evaluator.ts # visibleWhen / readonlyWhen (base.md §4)
    │       ├── field-path.ts         # leer/escribir valor por ruta (faq[2].answer)
    │       └── validators.ts         # reglas de validación reutilizables
    │
    ├── schemas/                      # un schema por recurso + registro central
    │   ├── registry.ts               # catálogo: alimenta menú y rutas (base.md §2)
    │   ├── categories.schema.ts
    │   ├── products.schema.ts
    │   ├── site.schema.ts
    │   └── legal.schema.ts
    │
    ├── shell/                        # layout de la app autenticada
    │   ├── layout/                   # estructura: sidebar + main + topbar
    │   ├── sidebar/                  # menú lateral generado desde registry
    │   └── shell.routes.ts           # rutas hijas: /resource/:id → resource page
    │
    ├── pages/                        # páginas genéricas (usan los schemas)
    │   ├── resource-page/            # lee el schema → lista, formulario o ambos
    │   ├── list-view/                # tabla, búsqueda, filtros, reordenar
    │   └── form-view/                # construye el formulario desde `fields`
    │
    └── fields/                       # un componente por tipo de campo (base.md §5)
        ├── field-host/               # despachador recursivo por `type`
        ├── text/  textarea/  slug/  number/  currency/  boolean/
        ├── select/  multiselect/  url/  email/  phone/  date/  time/
        ├── readonly-text/  relation/  image/
        └── group/  list/  string-list/  key-value/
```

### Convención de archivos por componente

- Cada componente en **su propia carpeta**: `resource-page/resource-page.ts` +
  `resource-page.html` + `resource-page.css`.
- Sin sufijo `.component` en los nombres (convención del scaffold Angular 22);
  el selector sí lleva prefijo `app-`: `app-resource-page`.
- Templates y estilos externos con **ruta relativa** al archivo `.ts`.

---

## 4. Core vs Shared — regla de dependencia

**No es "uno u otro": son las dos capas, con reglas distintas.**

|                   | `core/`                                                    | `shared/`                                                                                         |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Contenido         | Servicios singleton, modelos, interceptors, guards, tokens | Componentes UI tontos, pipes, directives, utilidades puras                                        |
| Instancia         | Una por app (`@Service()`)                                 | Sin estado de app; entra por `input()`                                                            |
| Conoce el dominio | Sí (schemas, endpoints)                                    | **No** — solo Angular y TS puro                                                                   |
| Regla de oro      | Nunca es "dumb": administra estado o comunica con la API   | Si necesita inyectar un servicio de dominio, **no pertenece a shared** → va a core o a la feature |

**Flujo de imports permitido** (las flechas son "puede importar"):

```
app → shell → pages → fields
                 │       │
                 ├───────┴──→ shared
                 └──────────→ core
schemas → core/models (solo tipos)
shared  → solo Angular        (NO importa core, ni schemas, ni pages)
core    → shared permitido    (NO importa pages, shell, fields, schemas)
```

- **`shared` nunca importa `core`**: eso la acopla al dominio y mata la
  reutilización. Si un componente compartido necesita datos, recíbelos por
  `input()` desde quien sí tiene acceso.
- **`core` nunca importa features**: los servicios de core no conocen a los
  componentes que los usan.
- **`schemas` solo importa tipos de `core/models`**: un schema es datos, no
  comportamiento.

---

## 5. Estilos — Tailwind v4

- **Sin `tailwind.config.js`.** Los tokens viven en `@theme` dentro de
  `src/styles/theme.css`, importado una sola vez desde `src/styles.css`
  (ya registrado en `angular.json → styles[]`; no duplicar el import).
- **Colores planos y semánticos**, sin rampas numéricas:

  ```css
  @theme {
    --color-primary: #...; /* → bg-primary, text-primary, border-primary */
    --color-secondary: #...;
    --color-accent: #...;
    --color-neutral: #...;

    --font-body: /*...*/ , system-ui, sans-serif;
    --font-display: /*...*/ , system-ui, sans-serif;

    --default-font-family: var(--font-body);
  }
  ```

- Exactamente **dos tokens de fuente**: `font-body` y `font-display` (nunca
  `font-sans`).
- Colores extra (`--color-danger`, etc.) **solo si un diseño los pide**, nunca
  inventar escalas `-500/-600` de forma proactiva.
- Estilos de componente en su `.css` con utilidades de Tailwind; si el build
  falla con `Cannot apply unknown utility class`, falta un token o el import.
- Verificación: `npm run build` debe pasar sin esa advertencia.

---

## 6. Estados de UI

- Estados universales (skeleton, vacío, error con reintento, sin permisos) se
  implementan como componentes de `shared/components/` y se reutilizan en
  `pages/`.
- **No se generan archivos de test** en este proyecto.

---

## 7. Orden de creación del esqueleto

1. `src/styles/` con `theme.css` + `base.css` (tokens Tailwind v4).
2. `core/` (models + services mínimos + tokens).
3. `shared/` (utils primero: gap-sorting, condition-evaluator, validators).
4. `schemas/` (tipos + `registry.ts` vacío).
5. `shell/` (layout + sidebar + rutas).
6. `pages/` y `fields/` (los que consumen todo lo anterior).
7. `app.routes.ts` → lazy load del shell.

> Regla: **las dependencias se crean antes que sus consumidores.**
