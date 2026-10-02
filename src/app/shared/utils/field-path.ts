/**
 * Lectura de valores por ruta (ej. `faq[2].answer`, `address.city`) —
 * celdas del listado y valores anidados de los singleton (base.md §10).
 */

/** Segmentos de una ruta: claves de objeto y índices de arreglo. */
export type PathSegment = string | number;

/** `faq[2].answer` → `['faq', 2, 'answer']`. */
export function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  for (const part of path.split('.')) {
    if (part === '') {
      continue;
    }
    const match = /^([^[\]]*)((?:\[\d+\])+)$/.exec(part);
    if (match) {
      const key = match[1];
      if (key !== '') {
        segments.push(key);
      }
      for (const bracket of match[2].matchAll(/\[(\d+)\]/g)) {
        segments.push(Number(bracket[1]));
      }
    } else {
      segments.push(part);
    }
  }
  return segments;
}

/** Lee el valor en `path`; `undefined` si algún tramo no existe. */
export function getValue<T = unknown>(source: unknown, path: string): T | undefined {
  let current: unknown = source;
  for (const segment of parsePath(path)) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[segment];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current as T;
}
