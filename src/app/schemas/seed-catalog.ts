import { setSchemaCatalog } from '@tinya-code/gas-admin-ui';

import { authSchema } from './auth.schema';
import { schemas } from './registry';

/**
 * Siembra el catálogo del motor para los specs del consumidor (espejo de
 * `provideGasAdmin({ schemas, auth })` en `app.config.ts`). Los componentes
 * del motor resuelven `getSchema`/`allSchemas` contra este catálogo
 * módulo-level; sin la siembra, los specs ven el catálogo vacío.
 */
setSchemaCatalog(schemas, authSchema);
