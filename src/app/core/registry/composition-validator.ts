import { getSchema } from '../../schemas/registry';
import type {
  DataSource,
  NavigationTarget,
  ResourceSchema,
  SelectionBinding,
  UiViewDescriptor,
  ViewChildNode,
} from '../models/schema.model';
import { get } from './render-registry';

/**
 * Validador de composición de vistas (R9.9.2 · D2/D3).
 *
 * Una composición (un `uiView` contenedor con `config.children`, p. ej.
 * `tabs`) se valida ANTES del render con esta única función pura y síncrona:
 *
 *  - identidad de hijos (`id` presente y único entre hermanos);
 *  - tipos resueltos con `get('view', type)` — **nunca** `resolve()`, cuyo
 *    `fallback` silencioso dejaría un hijo inválido pintándose de todos modos;
 *  - `ref` rotos y ciclos (directos o transitivos) que los `ref` permiten;
 *  - profundidad y cantidad de nodos con topes configurables;
 *  - destinos de navegación (`resource` + `view` + params) y fuentes de
 *    filas — una URL cruda nunca es un destino válido;
 *
 * El llamante es D3: `resourceRoutes()` en `shell.routes.ts` (fail-loud al
 * arrancar) y el guardián de montaje del composer. Cualquier violación lanza
 * `SchemaCompositionError` con un mensaje legible que nombra recurso,
 * contenedor e hijo: nada se oculta ni se sustituye en silencio.
 *
 * El tipo de una `uiView` RAÍZ no se chequea acá: eso ya lo hace
 * `resourceRoutes()` con su error genérico de descriptor inexistente. Este
 * validador cubre lo que ese recorrido no ve: la estructura de los hijos.
 */

/** Profundidad máxima de anidamiento de contenedores (hijos raíz = 1). */
export const MAX_DEPTH = 3;

/** Cantidad máxima de nodos-hijo declarados en la composición de un schema. */
export const MAX_NODES = 50;

/** Violación del contrato de composición, detectada antes del render. */
export class SchemaCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaCompositionError';
  }
}

/** Estado del recorrido: cuenta de nodos y camino actual (detección de ciclos). */
interface Estado {
  readonly esquema: ResourceSchema;
  nodos: number;
  readonly contados: Set<ViewChildNode>;
  readonly camino: Set<string>;
}

/** `config` de la vista cuando la hay (`tabs` es el único contenedor hoy). */
function configDe(vista: UiViewDescriptor | ViewChildNode): unknown {
  return 'config' in vista ? vista.config : undefined;
}

/** Hijos declarados si la vista es un contenedor; `undefined` si no lo es. */
function hijosDe(vista: UiViewDescriptor | ViewChildNode): ViewChildNode[] | undefined {
  const hijos = (configDe(vista) as { children?: unknown } | undefined)?.children;
  return Array.isArray(hijos) ? (hijos as ViewChildNode[]) : undefined;
}

/**
 * Valida TODA la composición de un schema. Lanza `SchemaCompositionError`
 * en la primera violación; no lanzar significa «apto para renderizar».
 */
export function validateComposition(schema: ResourceSchema): void {
  const estado: Estado = { esquema: schema, nodos: 0, contados: new Set(), camino: new Set() };
  for (const [nombre, vista] of Object.entries(schema.uiViews ?? {})) {
    estado.camino.add(nombre);
    validarContenido(nombre, vista, 1, estado);
    estado.camino.delete(nombre);
  }
}

/**
 * Valida una `uiView` ya resuelta (raíz o referenciada por `ref`): sus
 * bindings, su fuente de filas y —si es contenedor— sus hijos.
 * `profundidadHijos` es la profundidad que tendrán sus hijos directos.
 */
function validarContenido(
  nombre: string,
  vista: UiViewDescriptor,
  profundidadHijos: number,
  estado: Estado,
): void {
  const donde = `${estado.esquema.id}.${nombre}`;
  validarSelect(donde, (vista as { select?: SelectionBinding }).select);
  validarSource(donde, (configDe(vista) as { source?: DataSource } | undefined)?.source);
  const hijos = hijosDe(vista);
  if (!hijos) return;
  validarHijos(nombre, hijos, profundidadHijos, estado);
}

/** Valida la lista de hijos de un contenedor: identidad única entre hermanos. */
function validarHijos(
  contenedor: string,
  hijos: readonly ViewChildNode[],
  profundidad: number,
  estado: Estado,
): void {
  const ids = new Set<string>();
  for (const hijo of hijos) {
    const id = (hijo as { id?: unknown }).id;
    if (typeof id !== 'string' || id === '') {
      throw new SchemaCompositionError(`${estado.esquema.id}.${contenedor}: hijo sin id`);
    }
    if (ids.has(id)) {
      throw new SchemaCompositionError(`${estado.esquema.id}.${contenedor}: id duplicado '${id}'`);
    }
    ids.add(id);
    validarHijo(hijo, contenedor, id, profundidad, estado);
  }
}

/** Valida un hijo: topes de nodos/profundidad, ciclo, ref y tipo inline. */
function validarHijo(
  hijo: ViewChildNode,
  contenedor: string,
  id: string,
  profundidad: number,
  estado: Estado,
): void {
  const donde = `${estado.esquema.id}.${contenedor} → child '${id}'`;

  if (!estado.contados.has(hijo)) {
    estado.contados.add(hijo);
    estado.nodos += 1;
    if (estado.nodos > MAX_NODES) {
      throw new SchemaCompositionError(
        `${estado.esquema.id}: la composición supera el límite de ${MAX_NODES} nodos (observados ${estado.nodos})`,
      );
    }
  }
  if (profundidad > MAX_DEPTH) {
    throw new SchemaCompositionError(
      `${donde}: profundidad ${profundidad} supera el máximo ${MAX_DEPTH}`,
    );
  }

  if ('ref' in hijo) {
    validarRef(donde, (hijo as { ref?: unknown }).ref as string, profundidad, estado);
    return;
  }

  const tipo = (hijo as { type?: unknown }).type as string;
  if (!get('view', tipo)) {
    throw new SchemaCompositionError(`${donde}: tipo desconocido '${tipo}'`);
  }
  validarSelect(donde, (hijo as { select?: SelectionBinding }).select);
  validarSource(donde, (configDe(hijo) as { source?: DataSource } | undefined)?.source);
  /**
   * Contenedor inline: sus propios hijos también se validan. Sin esto, una
   * composición anidada dentro de otro `tabs` inline se renderiza sin haber
   * pasado por topes de profundidad/nodos ni por la detección de ciclos de
   * sus `ref` (D2: invalid branch NUNCA llega al render). La profundidad
   * CONTINUA desde este hijo — no se reinicia — y el camino de ciclo se
   * mantiene intacto, porque un `ref` sólo puede volver a nombres que ya
   * están en él.
   */
  const internos = hijosDe(hijo);
  if (internos !== undefined) {
    validarHijos(id, internos, profundidad + 1, estado);
  }
}

/**
 * Resuelve un hijo `ref` contra `schema.uiViews`: el destino debe existir y
 * no formar parte del camino actual (ciclo directo o transitivo). El
 * contenido del destino se valida en profundidad CONTINUANDO la del ref —
 * un `ref` anida de verdad (R9.9.2).
 */
function validarRef(donde: string, target: string, profundidad: number, estado: Estado): void {
  if (estado.camino.has(target)) {
    throw new SchemaCompositionError(
      `${donde}: ciclo detectado — '${target}' ya está en el camino`,
    );
  }
  const vista = estado.esquema.uiViews?.[target];
  if (!vista) {
    throw new SchemaCompositionError(
      `${donde}: ref '${target}' no existe en ${estado.esquema.id}.uiViews`,
    );
  }
  estado.camino.add(target);
  validarContenido(target, vista, profundidad + 1, estado);
  estado.camino.delete(target);
}

/**
 * Valida el binding de selección de una `uiView` o de un hijo (R9.9.4).
 * Sólo `mode: 'route'` exige destino declarado; `none`/`inline` son locales.
 */
function validarSelect(donde: string, select: SelectionBinding | undefined): void {
  if (select === undefined || select.mode !== 'route') return;
  const target = (select as { target?: unknown }).target;
  if (target === undefined || target === null) {
    throw new SchemaCompositionError(`${donde}: select mode 'route' sin target`);
  }
  if (typeof target === 'string') {
    throw new SchemaCompositionError(
      `${donde}: destino con URL cruda '${target}' — declará resource + view`,
    );
  }
  validarTarget(donde, target as NavigationTarget);
}

/**
 * El destino sólo puede ser un recurso + `uiView` declarados, con los params
 * declarados EXACTAMENTE igual que los params de la ruta del destino: ni
 * params ajenos a la ruta ni params de la ruta sin declarar.
 */
function validarTarget(donde: string, target: NavigationTarget): void {
  const { resource, view, params } = target;
  if (typeof resource !== 'string' || resource === '' || typeof view !== 'string' || view === '') {
    throw new SchemaCompositionError(`${donde}: destino sin resource + view`);
  }
  const destino = getSchema(resource);
  if (!destino) {
    throw new SchemaCompositionError(`${donde}: destino '${resource}' no existe`);
  }
  const vista = destino.uiViews?.[view];
  if (!vista) {
    throw new SchemaCompositionError(
      `${donde}: destino ${resource}.${view} no tiene uiView declarada`,
    );
  }
  const paramsRuta = (vista.path ?? '')
    .split('/')
    .filter((segmento) => segmento.startsWith(':'))
    .map((segmento) => segmento.slice(1));
  const declarados = params ?? [];
  for (const param of declarados) {
    if (!paramsRuta.includes(param)) {
      throw new SchemaCompositionError(
        `${donde}: param '${param}' no existe en la ruta ${resource}.${view}`,
      );
    }
  }
  for (const param of paramsRuta) {
    if (!declarados.includes(param)) {
      throw new SchemaCompositionError(
        `${donde}: falta declarar el param '${param}' de la ruta ${resource}.${view}`,
      );
    }
  }
}

/** Valida la fuente de filas (`config.source`) declarada por una vista (R9.8). */
function validarSource(donde: string, source: DataSource | undefined): void {
  if (source === undefined) return;
  if (typeof source.resource !== 'string' || source.resource === '') {
    throw new SchemaCompositionError(`${donde}: source sin resource`);
  }
  const origen = getSchema(source.resource);
  if (!origen) {
    throw new SchemaCompositionError(`${donde}: source '${source.resource}' no existe`);
  }
  if (source.view !== undefined && origen.views?.[source.view] === undefined) {
    throw new SchemaCompositionError(
      `${donde}: la vista '${source.view}' no existe en ${source.resource}.views`,
    );
  }
}
