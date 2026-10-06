import { defineConfig } from 'vitest/config';

// Vitest cubre SÓLO el backend de Apps Script (carpeta api/).
//
// El frontend se prueba con `npm test` (ng test, sobre los spec de src/);
// las dos suites viven en mundos distintos y no se mezclan. El backend no
// tenía NINGÚN test hasta ahora: `npm run api:check` sólo verifica reglas
// estáticas (nombres, registry vs ficheros, contract back vs front), de
// modo que los bugs de runtime quedaban sin red.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['api/**/*.spec.js'],
    exclude: ['node_modules', 'src'],
  },
});
