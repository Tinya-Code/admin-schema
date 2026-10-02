/**
 * Validadores puros sobre valores (base.md §4): longitud por palabras.
 * Devuelven `null` cuando el valor es válido o cuando no aplica.
 * (Longitud por caracteres, patrón y rango los aplica `@angular/forms/signals`
 * vía `form-schema.ts`: `minLengthRule`/`maxLengthRule`/`patternRule`/`minRule`.)
 *
 * Reglas comunes:
 * - Valor vacío (`undefined` / `null` / `''`) → `null`: la obligatoriedad
 *   la maneja `required` aparte. Solo espacios NO cuenta como vacío.
 * - Valores de otro tipo → `null` (no validan aquí; los cubre el campo).
 *
 * Los mensajes se muestran tal cual bajo el campo (Fase 10), en español.
 */

export function validateMinWords(value: unknown, min: number): string | null {
  const words = wordCount(value);
  if (words === null) {
    return null;
  }
  return words >= min ? null : `Debe tener al menos ${min} palabras.`;
}

export function validateMaxWords(value: unknown, max: number): string | null {
  const words = wordCount(value);
  if (words === null) {
    return null;
  }
  return words <= max ? null : `Como máximo ${max} palabras.`;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** Conteo de palabras; `null` si el valor no es texto o está vacío. */
function wordCount(value: unknown): number | null {
  if (isEmpty(value) || typeof value !== 'string') {
    return null;
  }
  return value.trim().split(/\s+/).filter(Boolean).length;
}
