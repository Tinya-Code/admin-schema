/**
 * Configuración de build — valores COMMITTEADOS (vacíos por defecto).
 *
 * Los valores reales viven en `environment.local.ts` (gitignored) y se
 * aplican vía `fileReplacements` en `angular.json` (dev y prod). Nunca
 * pongas credenciales acá: baseapi §2.3 — el token no va al repo.
 */
export const environment = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbyxl79-s1aWqHNcHMFvZ07CWn2iDv-6dAfzKKzqL20EPbaQLu171mRvKuIRUfBVHrKhTQ/exec',
  adminToken:
    '20a19d2a-efdf-4be2-93e3-96a0f62955dad3618e2f-9e22-40e1-a58d-131b70143d2a',
};
