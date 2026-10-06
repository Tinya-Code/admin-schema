/**
 * Resuelve una plantilla de texto reemplazando marcadores `{key}` o `{nested.key}`
 * con los valores presentes en el objeto `data` o en el contexto adicional `extraContext`.
 *
 * Si un valor es `null` o `undefined`, se reemplaza por una cadena vacía.
 * No arroja excepciones ante claves no encontradas ni ante objetos nulos.
 */
export function interpolateTemplate(
  template: string,
  data: Record<string, unknown> = {},
  extraContext: Record<string, unknown> = {},
): string {
  if (!template) return '';

  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (match, key: string) => {
    const val = getDeepValue(data, key) ?? getDeepValue(extraContext, key);
    if (val === null || val === undefined) {
      return '';
    }
    return String(val);
  });
}

function getDeepValue(obj: Record<string, unknown>, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export interface ParsedRoute {
  path: string;
  queryParams: Record<string, string>;
}

/**
 * Descompone una ruta relativa o absoluta en path y queryParams para routerLink.
 */
export function parseNavigationUrl(url: string): ParsedRoute {
  if (!url) return { path: '', queryParams: {} };
  const [path, queryString] = url.split('?');
  const queryParams: Record<string, string> = {};
  if (queryString) {
    const params = new URLSearchParams(queryString);
    params.forEach((value, key) => {
      queryParams[key] = value;
    });
  }
  return { path: path || '', queryParams };
}
