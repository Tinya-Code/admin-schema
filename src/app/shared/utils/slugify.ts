/**
 * Normaliza texto a slug: minúsculas, sin acentos, separados por guiones.
 * Ej.: `Lomo Saltado Ñoño` → `lomo-saltado-nonio`.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
