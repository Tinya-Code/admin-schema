/**
 * Mensaje completo a copiar o compartir.
 *
 * `shareTextTemplate` es el MENSAJE FORMATEADO por el schema (el que trae
 * saludo, ref, PIN o el enlace ya escrito dentro), mientras que `urlTemplate`
 * es sólo el enlace. Los tres caminos —copiar, compartir nativo y WhatsApp—
 * deben ofrecer el mismo texto: antes `copy()` y la acción del listado sólo
 * escribían `url`, así que el operador se quedaba sin el mensaje.
 *
 * Tres casos, sin perder información y sin duplicar el enlace:
 *  - sin `shareText`            → sólo la URL
 *  - `shareText` con el sitio ya mencionado → el mensaje tal cual
 *  - `shareText` sin el sitio   → mensaje + espacio + URL
 *
 * "Sitio" se decide por ORIGIN, no por la URL exacta: la plantilla puede
 * referenciar sólo la base (`{public_base_url}` → `https://ejemplo.com`)
 * o la URL completa con el path (`…/p/{ref}`); en ambos casos el mensaje
 * YA apunta al sitio y no se le pega nada al final. Antes se comparaba
 * contra la URL completa, así que un mensaje con la base recibía la URL
 * con código duplicada al final.
 *
 * @param url        Enlace resuelto (`urlTemplate`).
 * @param shareText  Mensaje formateado opcional (`shareTextTemplate`).
 */
export function buildShareMessage(url: string, shareText?: string): string {
  const text = (shareText ?? '').trim();
  if (!text) return url;
  if (url && mentionsSite(text, url)) return text;
  return url ? `${text} ${url}` : text;
}

/** ¿El mensaje ya apunta al sitio de `url` (origin o URL exacta)? */
function mentionsSite(text: string, url: string): boolean {
  if (text.includes(url)) return true;
  try {
    const { origin } = new URL(url);
    return origin !== 'null' && text.includes(origin);
  } catch {
    // `url` relativa (`/p/123`): sin origin que comparar, sólo la URL exacta.
    return false;
  }
}

/**
 * Escribe en el portapapeles sin reventar: primero la API moderna, después
 * el `textarea` + `execCommand` (obsoleto, pero sigue siendo el fallback
 * que existe en contextos no seguros).
 *
 * Único punto del admin que sabe cómo copiar: `copy-share`, las acciones de
 * fila del listado y cualquier widget futuro comparten este camino, en vez
 * de reimplementar cada uno sus propios fallbacks.
 *
 * @returns `true` si el texto quedó copiado por alguna de las vías.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Permiso denegado o contexto no seguro: sigue al fallback legado.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return false;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  document.body.removeChild(area);
  return copied;
}
