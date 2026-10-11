import {
  isDevMode,
  makeEnvironmentProviders,
  provideAppInitializer,
  type EnvironmentProviders,
  type TemplateRef,
  type Type,
} from '@angular/core';

import type { RootTree } from '../../fields/field-node';
import type { SeedKind } from '../../shared/utils/seed';
import { columnFormatDescriptors } from '../../columns/descriptors';
import { fieldDescriptors } from '../../fields/descriptors';
import { widgetDescriptors } from '../../widgets/descriptors';
import type { FieldSchema, ListColumn, WidgetSchema } from '../models/schema.model';

/**
 * Registro único de render (R3.1 · `doc/plan-refactor-motor.md` §3.1).
 *
 * Un solo sitio declara qué componentes sabe dibujar la UI: cada tipo de
 * campo, widget, acción o vista aporta un `RenderDescriptor` y el registro
 * lo resuelve por `(kind, type)`. Los hosts dejan de mantener `Set`s de tipos
 * e imports a mano — **en runtime el registro es la única fuente de verdad**.
 *
 * Se carga a scope de módulo y no desde DI: `buildFormSchema()` es una
 * función pura que consulta el registro sin inyectar nada, así que un
 * registro llenado únicamente por un provider dejaría esa consulta correr
 * contra un catálogo vacío. `provideRenderDescriptors()` existe igualmente
 * como punto de entrada explícito para `app.config.ts` (R3.2).
 *
 * Autodescubrimiento (D9-1): se opta por **registro manual** — un manifiesto
 * con una línea por descriptor — porque `import.meta.glob` no está
 * implementada por el bundler de producción (`@angular/build:application`
 * usa esbuild) y la llamada cruda sobreviviría en `dist/`, rompiendo el
 * arranque. Con Vite sólo en el dev-server y en el runner de tests, además,
 * el comportamiento habría diferido entre `npm test` y `npm run build`.
 */

/** Qué clase de cosa se está resolviendo. Identificador único dentro de su `kind`. */
export type RenderKind = 'field' | 'column-format' | 'widget' | 'action' | 'view' | 'layout';

/** Superficies en las que un descriptor puede aparecer. */
export type RenderSurface = 'form' | 'display' | 'list' | 'filter';

/**
 * Qué puede describir un `RenderDescriptor`: un campo del formulario, un
 * widget del dashboard o una columna de listado (R4.3).
 *
 * Es el tipo del input `config` del host. Los descriptores sólo comparten
 * `key` y `label`; lo demás lo decide cada `kind`, y quien necesita el resto
 * lo castea con su propia mirada (`cfgCampo()`, que es lo que el host ya
 * hacía antes de que existieran las columnas).
 */
export type RenderConfig = FieldSchema | WidgetSchema | ListColumn;

/**
 * Contexto de render que el host expone por DI (R3.4 · `doc/plan-refactor-motor.md` §3.4).
 *
 * Los controles viven en un componente distinto por cada tipo, así que en vez
 * de repetir cinco inputs en los 20 el host lo provee una sola vez y cada
 * control lo inyecta si lo necesita — el mismo criterio que ya usaba
 * `FIELD_ARIA`.
 *
 * `tree` viaja en el contexto y no como input suelto porque es **por
 * instancia**: los hijos de un `group` o de un `list` navegan su subárbol, no
 * el del padre.
 *
 * Vive acá y no en `render-host.ts` porque el contrato de los descriptores
 * (`RenderExtras`) necesita nombrarlo: el descriptor de un campo compuesto
 * decide qué se le pasa al componente y eso sólo es escribible conociendo el
 * tipo. `render-host.ts` lo re-exporta para no mover a sus consumidores.
 */
export interface RenderContext {
  /** Árbol del formulario del nivel de este campo. */
  tree: RootTree;
  /** Errores del backend por ruta (`address.street`, `faq[2].answer`). */
  serverErrors: Record<string, string>;
  /** Prefijo de ruta de este campo en el registro raíz (`address.`). */
  pathPrefix: string;
  /** Si el registro ya existe (lo consume `slug` con `lockAfterCreate`). */
  exists: boolean;
  /** Recurso dueño del formulario (lo consume `image` para la firma, §11.2). */
  resource: string;
}

/**
 * Contexto vacío con el que arranca `RenderHost.ctx`.
 *
 * Sólo lo alcanza quien renderiza sin contexto — los widgets, que no forman
 * parte de un formulario. Un campo montado sin `ctx` es un error de
 * programación y `childTree` lo dice con su propio mensaje, igual que lo
 * decía el `input.required` anterior.
 */
export const RENDER_CONTEXT_VACIO: RenderContext = {
  tree: undefined as unknown as RootTree,
  serverErrors: {},
  pathPrefix: '',
  exists: false,
  resource: '',
};

/**
 * Segundo argumento de `RenderDescriptor.inputs`.
 *
 * Aporta lo que el host conoce y el descriptor no: el contexto de formulario
 * (sólo para campos), el payload del dato (sólo para widgets) y los dos
 * templates con los que se componen `group` y `list`.
 */
export interface RenderExtras {
  /** Contexto del nivel; `RENDER_CONTEXT_VACIO` cuando no hay formulario. */
  ctx: RenderContext;
  /** Payload del widget (`<app-widget-host [data]>`); `null` en campos. */
  data: unknown;
  /** Template del contenido de un `group`. */
  groupContent?: TemplateRef<unknown>;
  /** Template de los hijos de un `list`. */
  childTemplate?: TemplateRef<unknown>;
}

/**
 * Declaración de un componente renderizable.
 *
 * No lleva `configSchema`: esa cláusula de `refactormotor.md` no existe en
 * el código y el plan la descartó (D17).
 */
export interface RenderDescriptor<C = unknown> {
  /** Clase de cosa. */
  kind: RenderKind;
  /** Identificador `kebab-case`, único dentro de `kind`. */
  type: string;
  /** Versión del contrato en que apareció (`doc/refactormotor.md`). */
  since: string;
  /**
   * Carga perezosa del componente. El registro se resuelve sin arrastrar el
   * bundle: los descriptores sólo guardan el cierre, no la clase.
   */
  load: () => Promise<Type<any>>;
  /** Superficies en las que se usa. Sólo lo que se pueda evidenciar en el código. */
  surfaces?: RenderSurface[];
  /** Valores por defecto de la configuración del descriptor. */
  defaults?: Partial<C>;
  /**
   * Forma del valor inicial que siembra este campo en el modelo del
   * formulario (D32 · R3.8).
   *
   * **Dato, no función**: un nombre resuelto por `shared/utils/seed.ts`, no
   * una clausura. Así el descriptor sigue siendo puro —`kind`, `type`,
   * `load`, `surfaces`, `seed`— y `seed.ts` es el único dueño de recorrer
   * un árbol de campos. La alternativa (`seed: (cfg) => …`) obligaría a que
   * `group` importara `seedFields`, lo que cerraría un ciclo
   * registro → manifiesto → descriptor → `seed` → registro.
   *
   * Sólo los campos lo declaran. **Obligatorio para `kind: 'field'`** — lo
   * vigila `core/registry/contract.spec.ts`, porque la exhaustividad de una
   * unión de strings no puede imponerse en tiempo de compilación.
   */
  seed?: SeedKind;
  /**
   * Cableado del componente: qué inputs recibe y con qué valor.
   *
   * Es **la** pieza que mantiene el host genérico: sin esto el motor tendría
   * que saber que `metric-card` recibe `label/value/hint` y que `group`
   * necesita además el template de sus hijos, y «añadir un tipo» volvería a
   * tocar `render-host.ts` (R3.8). Cada descriptor declara el suyo y el host
   * sólo hace `ngComponentOutletInputs = descriptor.inputs(config, extras)`.
   *
   * No es obligatorio: el 80 % de los tipos comparten la forma estándar de su
   * `kind` — `{field, tree}` en campos, `{widget, data}` en widgets — y para
   * ellos el host aplica esa forma por defecto. Se declara sólo cuando el
   * componente se desvía de ella.
   */
  inputs?: (config: C, extras: RenderExtras) => Record<string, unknown>;
}

/** Catálogo en memoria: `kind:type` → descriptor. */
const RENDERERS = new Map<string, RenderDescriptor>();

function keyOf(kind: RenderKind, type: string): string {
  return `${kind}:${type}`;
}

/**
 * Registra un descriptor. Idempotente por clave: volver a registrar el mismo
 * `(kind, type)` lo sobrescribe, lo que permite que un módulo se recargue en
 * desarrollo sin duplicar entradas.
 */
export function register(kind: RenderKind, descriptor: RenderDescriptor): void {
  RENDERERS.set(keyOf(kind, descriptor.type), descriptor);
}

/**
 * Quita un descriptor (R7.6). Simétrico a `register`: los specs que
 * registran entradas de prueba deben retirarlas, o el catálogo global queda
 * contaminado para cualquier otro spec que lea `renderKinds()` (flaky por
 * orden de ejecución).
 */
export function unregister(kind: RenderKind, type: string): void {
  RENDERERS.delete(keyOf(kind, type));
}

/** Descriptor declarado para `(kind, type)`, o `undefined` si nadie lo registró. */
export function get(kind: RenderKind, type: string): RenderDescriptor | undefined {
  return RENDERERS.get(keyOf(kind, type));
}

/** ¿La UI sabe dibujar este `(kind, type)`? Reemplaza a los `Set`s de los hosts. */
export function isSupported(kind: RenderKind, type: string): boolean {
  return RENDERERS.has(keyOf(kind, type));
}

/**
 * Componente para `(kind, type)`, o `fallback` si el tipo no está en el
 * catálogo.
 *
 * Es **asíncrona** porque `load()` importa el componente bajo demanda; el
 * `fallback` es síncrono y sólo se usa cuando no hay descriptor. Un fallo de
 * `load()` NO se traga: propagarlo es lo que hace visible un descriptor mal
 * escrito, y la política «nunca pantalla rota» la resuelve el llamante con el
 * `fallback` que ya recibe.
 */
export async function resolve<C = unknown>(
  kind: RenderKind,
  type: string,
  fallback: Type<C>,
): Promise<Type<C>> {
  const descriptor = get(kind, type);
  if (!descriptor) return fallback;
  return (await descriptor.load()) as Type<C>;
}

// Catálogo a scope de módulo: se registra al importar, sin esperar a DI.
for (const descriptor of [...fieldDescriptors, ...widgetDescriptors, ...columnFormatDescriptors]) {
  register(descriptor.kind, descriptor);
}

/**
 * Punto de entrada para `app.config.ts` (R3.2).
 *
 * El catálogo ya quedó cargado al importar este módulo; el provider sirve
 * para que el arranque sea explícito y para avisar en desarrollo si el
 * manifiesto vino vacío — que es exactamente lo que pasaría si alguien
 * borra una línea del manifiesto sin reemplazarla.
 */
export function provideRenderDescriptors(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      if (isDevMode() && RENDERERS.size === 0) {
        console.warn('[render-registry] el catálogo de descriptores vino vacío');
      }
    }),
  ]);
}

/** Cuántos descriptores hay registrados. Sólo para comprobaciones y tests. */
export function renderDescriptorCount(): number {
  return RENDERERS.size;
}

/**
 * `kind`s que hoy tienen al menos un descriptor.
 *
 * Existe para el test de exhaustividad (R3.7): él recorre los schemas de los
 * `kind`s que tienen registro y **falla** si aparece un `kind` con descriptor
 * que nadie recorre — de lo contrario «tener registro» y «estar cubierto»
 * serían dos afirmaciones distintas que nadie reconcilia.
 */
export function renderKinds(): RenderKind[] {
  return [...new Set([...RENDERERS.values()].map((descriptor) => descriptor.kind))];
}
