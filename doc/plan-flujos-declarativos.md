# Plan de Implementación: Flujos Declarativos, Vistas y Dashboard Operativo

> **Plan de Ejecución Quirúrgico por Fases**
>
> **Principio rector (Viabilidad A6):**
> _"El schema es el único plano de control. El motor es un intérprete agnóstico: ningún componente de frontend o backend debe contener lógica cableada ni nombres específicos de negocio (`orders`, `pickpass`, etc.). Cualquier flujo se expresa mediante declaraciones en el schema."_

**Leyenda**

| Marcador | Significado                                                                 |
| :------- | :-------------------------------------------------------------------------- |
| 🔵       | **Componente o Registro genérico** — cero lógica hardcodeada en el motor    |
| 🟡       | **Toca el motor / despacho** $\rightarrow$ se escribe test antes del cambio |
| 🔴       | **Bloqueante** de una fase posterior                                        |

---

## 🛡️ Directivas, Restricciones y Reglas de Oro para el Agente

> ⚠️ **LECTURA OBLIGATORIA ANTES DE ESCRIBIR CÓDIGO**

1. **Regla de Generalidad Absoluta (A6 / §11.1):**
   - **PROHIBIDO** escribir palabras de dominio específico (`orders`, `pickpass`, `pedidos`, `autorizado`, `pin`, etc.) dentro de `src/app/core/`, `src/app/views/`, `src/app/widgets/`, `src/app/shared/`, `api/core/`, `api/engine/` o `api/primitives/`.
   - Los nombres de recursos y campos solo viven en `src/app/schemas/`, `api/schema/resources/` y en los tests con datos sintéticos.
   - Cualquier componente nuevo (`DetailView`, `RecordList`, `PostCreateModal`) debe funcionar con cualquier recurso futuro (ej. `invoices`, `tickets`, `users`) basándose únicamente en su schema.

2. **Convenciones de Componentes Angular (Angular 22.2):**
   - **Nombre de archivo simple:** `src/app/<ruta>/<nombre>/<nombre>.ts` (ej. `record-list.ts`). **NUNCA** usar `.component.ts`.
   - **Clase sin sufijo:** `PascalCase` limpio (ej. `RecordList`, `DetailView`, `PostCreateModal`). **NUNCA** `RecordListComponent`.
   - **Cero boilerplate:** No colocar `standalone: true` ni `changeDetection:` (implícitos en Angular 22).
   - **Reactividad por Signals:** Usar `input()`, `input.required()`, `output()`, `computed()`, `signal()`. Prohibido `@Input()` o `@Output()` decoradores.
   - **Control Flow Nativo:** Usar `@if`, `@for`, `@switch`, `@case`. Prohibido `*ngIf`, `*ngFor`.

3. **Prohibición Estricta de Barrels (`index.ts`):**
   - **NO crear archivos `index.ts`**. Las importaciones deben hacerse siempre por la ruta directa al archivo (ej. `import { CopyShare } from '../../shared/components/copy-share/copy-share';`). Los barrels rompen la separación de chunks y el `@defer`.

4. **Disciplina de Test-First y Paridad:**
   - Al tocar el backend (`api/`): escribir el test primero en `api/__tests__/` antes de tocar handlers o primitivas.
   - Ejecutar `npm run api:check` tras cada modificación: debe mantenerse **100% VERDE** (paridad estricta de campos y recursos).
   - Ejecutar `npm test` y `npx ng build` para garantizar que la suite unitaria pase y no haya errores de compilación TypeScript.

5. **Actualización Obligatoria de Checkboxes:**
   - Cada vez que se complete una subtarea, actualizar inmediatamente su `- [ ]` a `- [x]` en este documento para mantener la trazabilidad.

---

## 📋 Inventario Exhaustivo de Archivos Afectados

```
src/app/
├── core/
│   ├── models/schema.model.ts                   ← Tipos del DSL (ResourceSchema, WidgetSchema, ActionSchema, etc.)
│   └── utils/template-interpolator.ts           ← Helper genérico de resolución de templates {ref}, {url}, etc.
│   └── utils/template-interpolator.spec.ts      ← Test unitario del interpolador
├── widgets/
│   ├── widget-host/widget-host.ts               ← Despachador de widgets con soporte de grid y anchos (4, 6, 8, 12)
│   ├── widget-host/widget-host.spec.ts          ← Spec del despachador
│   ├── record-list/record-list.ts               ← Widget: tabla embebida de registros con navegación
│   ├── record-list/record-list.spec.ts          ← Spec del widget record-list
│   ├── quick-actions/quick-actions.ts           ← Widget: grid de botones de accesos directos
│   ├── quick-actions/quick-actions.spec.ts      ← Spec del widget quick-actions
│   ├── status-progress/status-progress.ts       ← Widget: barra de distribución porcentual de estados
│   └── status-progress/status-progress.spec.ts  ← Spec del widget status-progress
├── views/
│   ├── list-view/list-view.ts                   ← Intercepta click de fila para emitir viewRecord si detail está activo
│   ├── list-view/list-view.spec.ts              ← Spec actualizado de ListView
│   ├── form-view/form-view.ts                   ← Soporte para readonlyOn: 'update' y hook post-create
│   ├── form-view/form-view.spec.ts              ← Spec actualizado de FormView
│   ├── detail-view/detail-view.ts               ← Nueva vista: Ficha de lectura estructurada con secciones y acciones
│   └── detail-view/detail-view.spec.ts          ← Spec de DetailView
├── shared/components/
│   ├── post-create-modal/post-create-modal.ts   ← Modal de éxito con resumen e incrustación de CopyShare
│   └── post-create-modal/post-create-modal.spec.ts
├── pages/
│   ├── resource-page/resource-page.ts           ← Orquestador de modos ('list' | 'detail' | 'form') con deep-linking
│   ├── resource-page/resource-page.spec.ts      ← Spec del orquestador de páginas
│   └── dashboard/dashboard.ts                   ← Dashboard reactivo con grid responsive de 12 columnas
└── schemas/
    ├── dashboard.schema.ts                      ← Schema ampliado del dashboard con widgets operativos
    └── orders.schema.ts                         ← Schema de orders con detail, postCreate, actions y readonlyOn

api/
├── primitives/handlers/dashboard.js             ← Soporte para vistas tabulares (arrays) y agregados escalares
├── schema/resources/orders.js                   ← Vistas adicionales en orders (pendientes_recientes)
└── __tests__/
    ├── dashboard-handler.spec.js                ← Test del handler de dashboard enriquecido
    └── views.spec.js                            ← Verificación de vistas y límites
```

---

# Fase 1 — Modelos, Tipos y Utilidades del DSL (`schema.model.ts`) 🔴

> **Objetivo:** Definir con rigor matemático el contrato TypeScript y la utilidad de interpolación para que toda la arquitectura esté respaldada por tipos estáticos.

### 1.1 Utilidad de Interpolación de Plantillas (`template-interpolator.ts`) 🔵

- [x] Crear `src/app/core/utils/template-interpolator.ts`
- [x] Implementar función pura `interpolateTemplate(template: string, data: Record<string, unknown>, extraContext?: Record<string, unknown>): string`
  - Reemplaza `{key}` y `{nested.key}` por su valor en `data` o `extraContext`.
  - Si el valor no existe o es `null`/`undefined`, reemplaza por cadena vacía o mantiene la plantilla limpia sin romper.
  - Escapa caracteres sensibles si es requerido para URLs.
- [x] Crear test `src/app/core/utils/template-interpolator.spec.ts` (6 casos: interpolación simple, valores nulos, claves anidadas, caracteres especiales de URL, texto sin placeholders, contexto extra).

### 1.2 Tipos de Acciones de Registro (`schema.model.ts`) 🔵

- [x] Añadir interface base `ResourceActionBase`:
  ```typescript
  export interface ResourceActionBase {
    id: string;
    label: string;
    icon?: string;
    variant?: 'primary' | 'secondary' | 'outline' | 'danger';
    visibleWhen?: { field: string; op: 'eq' | 'neq' | 'in'; value: unknown }[];
  }
  ```
- [x] Añadir `CopyShareAction`:
  ```typescript
  export interface CopyShareAction extends ResourceActionBase {
    type: 'copy-share';
    urlTemplate: string;
    shareTextTemplate?: string;
  }
  ```
- [x] Añadir `NavigateAction`:
  ```typescript
  export interface NavigateAction extends ResourceActionBase {
    type: 'navigate';
    routeTemplate: string;
  }
  ```
- [x] Añadir `TriggerAction`:
  ```typescript
  export interface TriggerAction extends ResourceActionBase {
    type: 'trigger-endpoint';
    endpoint: string;
    method?: 'POST' | 'PUT';
    confirmMessage?: string;
  }
  ```
- [x] Exportar unión discriminada: `export type ResourceAction = CopyShareAction | NavigateAction | TriggerAction;`

### 1.3 Tipos para Post-Creación y Ficha de Detalle 🔵

- [x] Añadir interface `PostCreateSchema`:
  ```typescript
  export interface PostCreateSchema {
    mode: 'modal' | 'toast' | 'redirect_detail' | 'stay';
    title?: string;
    description?: string;
    summaryFields?: string[];
    actions?: ResourceAction[];
  }
  ```
- [x] Añadir interface `DetailViewSchema`:
  ```typescript
  export interface DetailViewSchema {
    enabled: boolean;
    headerFields?: string[];
    sections?: {
      id: string;
      label: string;
      fields: string[];
    }[];
    actions?: ResourceAction[];
    allowEdit?: boolean;
    allowDelete?: boolean;
  }
  ```

### 1.4 Tipos de Ciclo de Vida de Campo (`readonlyOn`) 🔵

- [x] Extender `FieldBase` en `schema.model.ts`:
  ```typescript
  export interface FieldBase {
    // ... campos existentes ...
    readonlyOn?: 'create' | 'update' | 'always';
  }
  ```

### 1.5 Tipos de Widgets Operativos de Dashboard 🔵

- [x] Añadir interface `RecordListWidget`:
  ```typescript
  export interface RecordListWidget {
    type: 'record-list';
    key: string;
    label: string;
    resource: string;
    columns: string[];
    action?: {
      label: string;
      routeTemplate: string;
    };
    width?: number; // 1-12 columnas
  }
  ```
- [x] Añadir interface `QuickActionsWidget`:
  ```typescript
  export interface QuickActionsWidget {
    type: 'quick-actions';
    key: string;
    label: string;
    actions: {
      label: string;
      icon?: string;
      navigateTo: string;
      variant?: 'primary' | 'secondary' | 'outline';
    }[];
    width?: number;
  }
  ```
- [x] Añadir interface `StatusProgressWidget`:
  ```typescript
  export interface StatusProgressWidget {
    type: 'status-progress';
    key: string;
    label: string;
    segments: {
      key: string;
      label: string;
      color: 'success' | 'warning' | 'danger' | 'neutral';
    }[];
    width?: number;
  }
  ```
- [x] Actualizar la unión `WidgetSchema` para incluir `RecordListWidget | QuickActionsWidget | StatusProgressWidget`.
- [x] Actualizar `ResourceSchema` con `detail?: DetailViewSchema; postCreate?: PostCreateSchema; actions?: ResourceAction[];`.

### 1.6 Verificación de Fase 1

- [x] `npm test` $\rightarrow$ verde (98/98 tests pasando)
- [x] `npx ng build` $\rightarrow$ compila sin errores de tipos (dist generado)
- [x] `npm run api:check` $\rightarrow$ 3/3 verde (7 recursos, 83 campos)

---

# Fase 2 — Widgets Operativos del Dashboard 🔵

> **Objetivo:** Implementar los componentes visuales de los nuevos widgets y el sistema de grid de 12 columnas en `WidgetHost`.

### 2.1 Componente `record-list` (Tabla Embebida) 🔵

- [x] Crear `src/app/widgets/record-list/record-list.ts` (selector `app-record-list`, clase `RecordList`).
- [x] Inputs con Signals:
  - `widget = input.required<RecordListWidget>()`
  - `data = input<Record<string, unknown>[] | null>(null)`
- [x] Template & Estilos:
  - Tarjeta con borde y fondo uniforme (`bg-surface rounded-xl border border-neutral/20 p-4`).
  - Cabecera con título del widget y badge de conteo de registros.
  - Tabla compacta con scroll horizontal si es necesario, columnas especificadas en `widget.columns`.
  - Formateo de celdas según valor (fechas en formato legible, badges para estados conocidos, texto normal).
  - Columna de acción rápida con botón/enlace si `widget.action` existe (con soporte de `queryParams`).
  - `<app-empty-state>` cuando `data` es `[]` o `null`.
- [x] Crear `src/app/widgets/record-list/record-list.spec.ts` (4 tests: render de filas, render de columnas declaradas, click en acción con ruta interpolada, estado vacío).

### 2.2 Componente `quick-actions` (Accesos Directos) 🔵

- [x] Crear `src/app/widgets/quick-actions/quick-actions.ts` (selector `app-quick-actions`, clase `QuickActions`).
- [x] Inputs:
  - `widget = input.required<QuickActionsWidget>()`
- [x] Template:
  - Tarjeta contenedora con título `widget.label`.
  - Grid de botones o enlaces con iconos Lucide correspondientes (`Plus`, `Settings`, `FileText`, `ExternalLink`, `Zap`).
  - Navegación reactiva con `routerLink` y `queryParams`.
- [x] Crear `src/app/widgets/quick-actions/quick-actions.spec.ts` (3 tests: render de acciones, presencia de iconos, navegación correcta).

### 2.3 Componente `status-progress` (Distribución Porcentual) 🔵

- [x] Crear `src/app/widgets/status-progress/status-progress.ts` (selector `app-status-progress`, clase `StatusProgress`).
- [x] Inputs:
  - `widget = input.required<StatusProgressWidget>()`
  - `data = input<Record<string, number> | null>(null)`
- [x] Lógica:
  - Cálculo de `total = sum(data[segment.key])`.
  - Cálculo de porcentaje por segmento: `total > 0 ? (data[key] / total) * 100 : 0`.
  - Colores semánticos mapeados a tokens (`bg-emerald-500`, `bg-amber-500`, `bg-rose-500`, `bg-neutral/40`).
- [x] Template:
  - Barra de progreso multi-segmento continua con `overflow-hidden rounded-full h-3 flex`.
  - Leyenda inferior con badges y valores absolutos/porcentuales.
- [x] Crear `src/app/widgets/status-progress/status-progress.spec.ts` (4 tests: porcentajes correctos, suma 100%, manejo de total 0 sin división por cero, render de leyenda).

### 2.4 Actualización de `WidgetHost` y Grid de 12 Columnas 🔵

- [x] En `src/app/widgets/widget-host/widget-host.ts`:
  - Registrar los 3 nuevos tipos en `SUPPORTED_WIDGET_TYPES`.
  - Añadir `@case ('record-list')`, `@case ('quick-actions')`, `@case ('status-progress')`.
  - Añadir clase CSS dinámica según `widget.width` (`col-span-12`, `col-span-8`, `col-span-6`, `col-span-4`, `col-span-3`).
- [x] En `src/app/pages/dashboard/dashboard.ts`:
  - Cambiar el contenedor de widgets a `grid grid-cols-12 gap-4`.
- [x] Actualizar `widget-host.spec.ts` (9 tests cubriendo todos los widgets y el cálculo de anchos).

### 2.5 Verificación de Fase 2

- [x] `npm test` verde (112/112 tests pasando en 23 archivos)
- [x] `npx ng build` verde
- [x] `npm run api:check` verde

---

# Fase 3 — Backend: Vistas Tabulares para Dashboard 🟡

> **Objetivo:** Permitir que `handleDashboard` ejecute y devuelva tanto vistas escalares (`aggregate`) como vistas de lista de registros (`record-list`) con orden y límites.

### 3.1 Test Primero en `api/__tests__/dashboard-handler.spec.js` 🟡

- [x] Crear / actualizar `api/__tests__/dashboard.spec.js` con harness de pruebas.
- [x] Casos de prueba cubiertos:
  - 1. Devuelve escalares para vistas con `aggregate: 'count'`.
  - 2. Devuelve array de objetos para vistas con `where` + `sort` + `limit` (sin `aggregate`).
  - 3. Devuelve array vacío si no hay coincidencias.
  - 4. No falla si un recurso no tiene vistas declaradas.

### 3.2 Actualizar `api/primitives/handlers/dashboard.js` 🔵

- [x] Confirmar iteración de `resource.views`: escalares ante `view.aggregate`, y array proyectado de filas ante vistas tabulares (`record-list`).
- [x] Validar que `applyDeclaredView_` aplique `where`, `sort` (`dir: 'desc'`) y `limit` correctamente.

### 3.3 Declarar Vistas en `api/schema/resources/orders.js` 🔵

- [x] Añadir vista `pendientes_recientes`:
  ```javascript
  pendientes_recientes: {
    where: [{ field: 'status', op: 'eq', value: 'PENDIENTE' }],
    sort: [{ field: 'created_at', dir: 'desc' }],
    limit: 5,
  }
  ```

### 3.4 Verificación de Fase 3

- [x] `npm run test:api` verde (118/118 tests pasando en 12 archivos)
- [x] `npm run api:check` verde (3/3 verificaciones)

---

# Fase 4 — Componente `PostCreateModal` y Flujo Post-Creación 🔵

> **Objetivo:** Mostrar una tarjeta modal al crear un registro con resumen de datos y botón de WhatsApp / Copiar Enlace (`CopyShare`).

### 4.1 Crear Componente `PostCreateModal` 🔵

- [ ] Crear `src/app/shared/components/post-create-modal/post-create-modal.ts` (selector `app-post-create-modal`, clase `PostCreateModal`).
- [ ] Inputs y Outputs:
  - `schema = input.required<ResourceSchema>()`
  - `config = input.required<PostCreateSchema>()`
  - `record = input.required<Record<string, unknown>>()`
  - `configValues = input<Record<string, unknown>>({})` (valores de configuración global como `public_base_url`, `share_message_template`)
  - `closed = output<void>()`
- [x] Template & Composición:
  - Utilizar `<app-modal>` como contenedor base.
  - Icono de éxito ilustrado (`LucideCheckCircle2` o `LucidePartyPopper`).
  - Título y descripción dinámicos usando `interpolateTemplate(config.title, record)`.
  - Grid de datos de resumen especificando `config.summaryFields` (ej. Ref, Cliente, Fecha).
  - Renderizado de acciones: si hay acción `copy-share`, renderiza `<app-copy-share>` interpolando su `urlTemplate` y `shareTextTemplate` contra `record` y `configValues`.
  - Botón de cierre primario "Entendido / Continuar".
- [x] Crear `src/app/shared/components/post-create-modal/post-create-modal.spec.ts` (4 tests: render de título interpolado, lista de resumen, render de CopyShare con valores correctos, emisión de evento `closed`).

### 4.2 Integrar Hook Post-Creación en `FormView` / `ResourcePage` 🟢

- [x] En `FormView` (`src/app/pages/form-view/form-view.ts`):
  - Al recibir respuesta exitosa en creación (`api.create`):
    - Si `schema.postCreate?.mode === 'modal'`: emitir evento `createdWithSummary = output<Record<string, unknown>>()` con la respuesta del backend.
    - Si no está configurado: mantener toast y emitir `saved = output<void>()`.
- [x] En `ResourcePage` (`src/app/pages/resource-page/resource-page.ts`):
  - Capturar `createdWithSummary` $\rightarrow$ mostrar `<app-post-create-modal>`.
  - Al cerrar el modal $\rightarrow$ navegar a la Ficha de Detalle del nuevo registro o volver a la lista.
- [x] Actualizar specs correspondientes en `form-view.spec.ts` y `resource-page.spec.ts`.

### 4.3 Verificación de Fase 4

- [x] `npm test` verde
- [x] `npx ng build` verde

---

# Fase 5 — Ficha de Detalle (`DetailView`) y Bloqueo de Campos (`readonlyOn`) 🟢

> **Objetivo:** Proveer una vista de lectura estructurada para consultar registros antes de editar y bloquear campos inmutables durante la actualización.

### 5.1 Soporte `readonlyOn: 'update'` en `FormView` 🟢

- [x] En `FormView` (`src/app/pages/form-view/form-view.ts`):
  - Al inicializar el formulario en modo edición (`isEdit === true`):
    - Identificar campos donde `field.readonlyOn === 'update'` o `field.readonlyOn === 'always'` o `field.readonly === true`.
    - Deshabilitar el control correspondiente en el `FormGroup` (`control.disable()`) y/o pasar señal de solo lectura a `FieldHost`.
  - En modo creación (`isEdit === false`):
    - Los campos con `readonlyOn === 'update'` permanecen editables.
- [x] Añadir tests en `form-view.spec.ts` (3 tests: campo bloqueado en edit, campo editable en create, campo bloqueado en always).

### 5.2 Componente `DetailView` (Ficha de Registro) 🟢

- [x] Crear `src/app/pages/detail-view/detail-view.ts` (selector `app-detail-view`, clase `DetailView`).
- [x] Inputs y Outputs:
  - `schema = input.required<ResourceSchema>()`
  - `record = input.required<Record<string, unknown>>()`
  - `edit = output<Record<string, unknown>>()`
  - `back = output<void>()`
  - `delete = output<Record<string, unknown>>()`
- [x] Template:
  - Cabecera: Título del registro (`record[schema.titleField]`), badges de estado según `schema.detail.headerFields`, botón "Volver" y botón "Editar Registro".
  - Secciones estructuradas: Render de campos en tarjetas según `schema.layout.sections` o `schema.detail.sections`.
  - Soporte para subtablas/listas anidadas (como `history` de orders) mostradas como timeline o tabla estilizada de solo lectura.
  - Soporte para imágenes mostradas como thumbnails con vista previa.
  - Barra de acciones de registro (`schema.actions`): renderiza botones de acción y `CopyShare`.
- [x] Crear `src/app/pages/detail-view/detail-view.spec.ts` (4 tests: render de cabecera con badges, render de secciones e historial, emisión de evento edit, emisión de evento back).

### 5.3 Orquestación de Vistas en `ResourcePage` y `ListView` 🟢

- [x] En `ListView` (`src/app/pages/list-view/list-view.ts`):
  - Añadir output `viewRecord = output<Record<string, unknown>>()`.
  - Al pulsar una fila: si `schema.detail?.enabled === true` emite `viewRecord`, de lo contrario emite `editRecord`.
- [x] En `ResourcePage` (`src/app/pages/resource-page/resource-page.ts`):
  - Estado reactivo `currentView = signal<'list' | 'detail' | 'form'>('list')`.
  - Estado reactivo `selectedRecord = signal<Record<string, unknown> | null>(null)`.
  - Template con `@switch (currentView())`:
    - `@case ('list')`: `<app-list-view>`
    - `@case ('detail')`: `<app-detail-view [record]="selectedRecord()!" (edit)="switchToEdit($event)" (back)="switchToList()">`
    - `@case ('form')`: `<app-form-view [record]="selectedRecord()" (saved)="switchAfterSave($event)" (cancelled)="switchToList()">`
  - Sincronización con query params URL (`?id=...&view=detail`).
- [x] Actualizar spec de `resource-page.spec.ts` (5 tests de transición entre vistas).

### 5.4 Verificación de Fase 5

- [x] `npm test` verde
- [x] `npx ng build` verde

---

# Fase 6 — Declaración en Schemas Reales y Verificación E2E 🟢

> **Objetivo:** Configurar `orders.schema.ts` y `dashboard.schema.ts` con todas las nuevas capacidades y validar la suite completa.

### 6.1 Declarar en `src/app/schemas/orders.schema.ts` 🟢

- [x] Añadir `readonlyOn: 'update'` en el campo `ref`.
- [x] Configurar `detail`:
  ```typescript
  detail: {
    enabled: true,
    headerFields: ['ref', 'status', 'auth_state'],
  },
  ```
- [x] Configurar `postCreate`:
  ```typescript
  postCreate: {
    mode: 'modal',
    title: '¡Pedido Registrado con Éxito!',
    description: 'El pedido {ref} fue generado. Podés compartir el enlace de retiro con el cliente.',
    summaryFields: ['ref', 'customer_name', 'pickup_date', 'status'],
    actions: [
      {
        id: 'share_order',
        type: 'copy-share',
        label: 'Compartir con Cliente',
        urlTemplate: '{public_base_url}/p/{ref}',
        shareTextTemplate: '{share_message_template}',
      },
    ],
  },
  ```
- [x] Configurar `actions` de registro para la ficha de detalle (botón `copy-share`).

### 6.2 Declarar en `src/app/schemas/dashboard.schema.ts` 🟢

- [x] Configurar widgets operativos:
  ```typescript
  widgets: [
    { type: 'metric-card', key: 'pendientes', label: 'Pedidos Pendientes', hint: 'Por entregar', width: 4 },
    { type: 'metric-card', key: 'entregados', label: 'Entregados', hint: 'Retirados con éxito', width: 4 },
    { type: 'metric-card', key: 'cancelados', label: 'Cancelados', hint: 'Anulados', width: 4 },
    {
      type: 'record-list',
      key: 'pendientes_recientes',
      label: 'Pedidos que Requieren Atención',
      resource: 'orders',
      columns: ['ref', 'customer_name', 'pickup_date', 'auth_state'],
      action: { label: 'Ver Ficha', routeTemplate: '/admin/orders?id={ref}&view=detail' },
      width: 8,
    },
    {
      type: 'status-progress',
      key: 'pipeline_entregas',
      label: 'Pipeline de Cumplimiento',
      segments: [
        { key: 'pendientes', label: 'Pendientes', color: 'warning' },
        { key: 'entregados', label: 'Entregados', color: 'success' },
        { key: 'cancelados', label: 'Cancelados', color: 'neutral' },
      ],
      width: 4,
    },
    {
      type: 'quick-actions',
      key: 'acciones_rapidas',
      label: 'Acciones Frecuentes',
      actions: [
        { label: '+ Nuevo Pedido', navigateTo: '/orders/new', variant: 'primary' },
        { label: 'Ver Todos los Pedidos', navigateTo: '/orders', variant: 'secondary' },
      ],
      width: 12,
    },
  ],
  ```

### 6.3 Batería de Cierre y Verificación

- [x] `npm run test:api` $\rightarrow$ **Backend 100% verde** (118 tests)
- [x] `npm test` $\rightarrow$ **Frontend 100% verde** (128 tests en 26 archivos)
- [x] `npx ng build` $\rightarrow$ **Compilación de producción limpia**
- [x] `npx prettier --check src/` $\rightarrow$ **Formato de código impecable**
