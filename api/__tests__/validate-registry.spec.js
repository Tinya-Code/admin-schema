// api/__tests__/validate-registry — schema/validate-registry (R1.5, B12).
//
// El meta-schema corre AL CARGAR: si el registro está mal, GAS no arranca y
// `npm run api:check` sale en rojo. Este spec protege las DOS cosas que esa
// garantía necesita:
//
//   1. que el registro REAL siga siendo válido (si alguien añade una clave
//      o una referencia sin actualizar el vocabulario, esto se pone rojo);
//   2. que cada familia de fallo siga siendo DETECTADA — si el validador se
//      rompe en silencio deja de ser una red de seguridad y pasa a ser
//      decoración.
//
// `validateRegistry_()` es el corazón: devuelve TODOS los problemas en vez
// de cortar en el primero, para que un refactor sucio se arregle de una.

import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let REGISTRY;
let resources_;
let snapshot;

function registrySnapshot() {
  return {
    resources: JSON.parse(JSON.stringify(REGISTRY.resources)),
    endpoints: JSON.parse(JSON.stringify(REGISTRY.endpoints)),
    grantProfiles: JSON.parse(JSON.stringify(REGISTRY.grantProfiles)),
    uploadProfiles: JSON.parse(JSON.stringify(REGISTRY.uploadProfiles)),
    adapters: Object.fromEntries(
      Object.entries(REGISTRY.capabilities.adapters).map(([id, adapter]) => [
        id,
        Object.assign({}, adapter),
      ]),
    ),
  };
}

function restoreRegistry(before) {
  REGISTRY.resources = before.resources;
  REGISTRY.endpoints = before.endpoints;
  REGISTRY.grantProfiles = before.grantProfiles;
  REGISTRY.uploadProfiles = before.uploadProfiles;
  REGISTRY.capabilities.adapters = before.adapters;
  resources_ = REGISTRY.resources;
}

/** Mutación con restauración: cada caso deja el registro exactamente como estaba. */
function mutate(fn) {
  const before = registrySnapshot();
  try {
    fn();
    return validateRegistry_();
  } finally {
    restoreRegistry(before);
  }
}

describe('R1.5 — validateRegistry_', () => {
  beforeEach(() => {
    REGISTRY = loadBackend();
    resources_ = REGISTRY.resources;
    snapshot = registrySnapshot();
  });

  afterEach(() => {
    restoreRegistry(snapshot);
  });

  it('el registro real no tiene ni un problema', () => {
    expect(validateRegistry_()).toEqual([]);
  });

  it('afecta a todos los recursos, no sólo al primero', () => {
    const issues = mutate(() => {
      resources_.categories.titleField = 'no_existe';
      resources_.site.titleField = 'tampoco';
    });
    // Dos recursos tocados ⇒ DOS problemas (no corta en el primero).
    expect(issues).toHaveLength(2);
  });

  describe('1 · claves desconocidas (typos)', () => {
    it('detecta una clave mal escrita en el recurso', () => {
      const issues = mutate(() => {
        resources_.categories.titlefiled = 'name';
        delete resources_.categories.titleField;
      });
      expect(issues).toContain("resources.categories: clave desconocida 'titlefiled'");
    });

    it('detecta una clave desconocida en policies y en operations', () => {
      const issues = mutate(() => {
        resources_.site.policies.acces = { read: 'admin' };
        delete resources_.site.policies.access;
        resources_.products.operations.builk = {};
        delete resources_.products.operations.create;
      });
      expect(issues).toContain("resources.site.policies: clave desconocida 'acces'");
      expect(issues).toContain("resources.products: operación desconocida 'builk'");
    });

    it('detecta una clave desconocida dentro de un campo', () => {
      const issues = mutate(() => {
        resources_.products.fields[1].requird = true;
      });
      expect(issues.join('\n')).toContain("clave desconocida 'requird'");
    });
  });

  describe('2 · referencias rotas', () => {
    it('titleField / activeField / keyField que no son campos del recurso', () => {
      const issues = mutate(() => {
        resources_.categories.titleField = 'inventado';
        resources_.categories.activeField = 'otro_invento';
        resources_.categories.keyField = 'slugueo';
      });
      expect(issues).toContain(
        "resources.categories: titleField 'inventado' no es un campo del recurso",
      );
      expect(issues).toContain(
        "resources.categories: activeField 'otro_invento' no es un campo del recurso",
      );
      expect(issues).toContain(
        "resources.categories: keyField 'slugueo' no es un campo del recurso",
      );
    });

    it('listProjection apuntando a un campo inexistente', () => {
      const issues = mutate(() => {
        resources_.categories.listProjection = ['slugs', 'name'];
      });
      expect(issues).toContain(
        "resources.categories: listProjection apunta a 'slugs', que no es un campo",
      );
    });

    it('dependents apuntando a un recurso que no existe', () => {
      const issues = mutate(() => {
        resources_.categories.dependents = ['productz'];
      });
      expect(issues).toContain(
        "resources.categories: dependents apunta a 'productz', que no es un recurso",
      );
    });

    it('hasMany exige una relación inversa al recurso padre y un límite acotado', () => {
      const wrongRelation = mutate(() => {
        resources_.categories.hasMany.products.field = 'name';
      });
      expect(wrongRelation).toContain(
        "resources.categories.hasMany.products.field: debe ser una relación del recurso 'products' que apunte a 'categories'",
      );

      const invalidLimit = mutate(() => {
        resources_.categories.hasMany.products.limit = 101;
      });
      expect(invalidLimit).toContain(
        'resources.categories.hasMany.products.limit: debe ser un entero entre 1 y 100',
      );
    });

    it('view.expand sólo acepta relaciones o alias hasMany declarados', () => {
      const issues = mutate(() => {
        resources_.categories.views = {
          invalidExpand: { expand: ['missing_relation'] },
        };
      });
      expect(issues).toContain(
        "resources.categories.views.invalidExpand.expand: campo o hasMany inexistente 'missing_relation'",
      );
    });

    it('hasMany exige que la clave padre esté en la proyección del listado', () => {
      const issues = mutate(() => {
        resources_.categories.listProjection = ['name'];
        resources_.categories.views = { withProducts: { expand: ['products'] } };
      });
      expect(issues).toContain(
        "resources.categories.views.withProducts.expand: hasMany 'products' requiere incluir 'slug' en el listado",
      );
    });

    it('rechaza alias hasMany ambiguos para la misma relación', () => {
      const issues = mutate(() => {
        resources_.categories.hasMany.duplicate_products = {
          resource: 'products',
          field: 'category_slug',
          limit: 10,
        };
      });
      expect(issues).toContain(
        'resources.categories.hasMany.duplicate_products: relación inversa ya declarada como products',
      );
    });

    it('nullify no permite limpiar relaciones required', () => {
      const issues = mutate(() => {
        resources_.categories.onDelete = 'nullify';
      });
      expect(issues.join('\n')).toContain(
        "onDelete 'nullify' no puede limpiar la relación required 'products.category_slug'",
      );
    });

    it('no permite borrar con none si hay relaciones entrantes', () => {
      const issues = mutate(() => {
        resources_.categories.onDelete = 'none';
      });
      expect(issues).toContain(
        "resources.categories: onDelete 'none' no resuelve relaciones entrantes; usa restrict, cascade o nullify",
      );
    });

    it('rechaza ciclos entre políticas cascade', () => {
      const issues = mutate(() => {
        resources_.categories.onDelete = 'cascade';
        resources_.products.onDelete = 'cascade';
        resources_.categories.fields.push({
          key: 'featured_product',
          type: 'relation',
          required: false,
          source: { resource: 'products' },
        });
      });
      expect(issues.join('\n')).toContain('ciclo de políticas onDelete cascade');
    });

    it('relation apuntando a un recurso que no existe', () => {
      // La única relación real: products.category_slug → categories.
      const idx = resources_.products.fields.findIndex((f) => f.type === 'relation');
      expect(idx).toBeGreaterThanOrEqual(0);
      const key = resources_.products.fields[idx].key;

      const issues = mutate(() => {
        resources_.products.fields[idx].source.resource = 'fantasma';
      });
      expect(issues).toContain(
        `resources.products.fields[${idx}]: relation '${key}' apunta al recurso ` +
          "'fantasma', que no existe",
      );
    });

    it('relation exige UN objeto `source` (F8 · R6.5)', () => {
      // La única relación real: products.category_slug → categories.
      const idx = resources_.products.fields.findIndex((f) => f.type === 'relation');
      const at = `resources.products.fields[${idx}]`;
      const key = resources_.products.fields[idx].key;

      expect(
        mutate(() => {
          delete resources_.products.fields[idx].source;
        }),
      ).toContain(`${at}: relation '${key}' sin source declarado`);

      expect(
        mutate(() => {
          resources_.products.fields[idx].source = 'categories';
        }),
      ).toContain(`${at}: \`source\` debe ser un objeto { resource, view?, params? }`);

      expect(
        mutate(() => {
          resources_.products.fields[idx].source = { view: 'activos' };
        }),
      ).toContain(`${at}: \`source.resource\` debe ser el id de un recurso`);
    });

    it('el vocabulario viejo de relación (claves planas) ya no es válido', () => {
      const idx = resources_.products.fields.findIndex((f) => f.type === 'relation');

      // `resource`, `valueField` y `labelField` dejaron de ser claves de
      // field: viven dentro de `source`. Que la clave vieja se reporte como
      // DESCONOCIDA es lo que impide convivir con las dos formas.
      const issues = mutate(() => {
        const field = resources_.products.fields[idx];
        field.resource = 'categories';
        field.valueField = 'slug';
        field.labelField = 'name';
      });
      expect(issues).toContain(`resources.products.fields[${idx}]: clave desconocida 'resource'`);
      expect(issues).toContain(`resources.products.fields[${idx}]: clave desconocida 'valueField'`);
      expect(issues).toContain(`resources.products.fields[${idx}]: clave desconocida 'labelField'`);
      // Con `source` válido, la única queja es la clave vieja (no un
      // «sin source»): las dos formas no se aceptan a la vez.
      expect(issues.filter((i) => i.includes('sin source')).length).toBe(0);
    });

    it('un SINGLETÓN compara keyField contra kvColumns, no contra fields', () => {
      // keyField de singleton es la columna `key` del KV (24-crud:116), así
      // que NO es un campo del schema — regresión si se "corrigiera" igual
      // que en una collection.
      expect(validateRegistry_()).toEqual([]);

      const issues = mutate(() => {
        resources_.site.keyField = 'id';
      });
      expect(issues).toContain("resources.site: keyField 'id' no está en kvColumns");
    });

    it('el descriptor sin storage (dashboard) no exige campos', () => {
      // dashboard tiene sheet: null y fields: [] — sus keyField/titleField
      // son etiquetas del front, no columnas. Regresión si la validación
      // empezara a exigirles campos.
      expect(validateRegistry_()).toEqual([]);
      expect(resources_.dashboard.sheet).toBeNull();
      expect(resources_.dashboard.fields).toEqual([]);
    });
  });

  describe('3 · identificadores inexistentes', () => {
    it('tipo de campo que el motor no conoce', () => {
      const issues = mutate(() => {
        resources_.categories.fields[1].type = 'txt';
      });
      expect(issues).toContain("resources.categories.fields[1]: tipo de campo inexistente 'txt'");
    });

    it('transform declarado en computed que no existe', () => {
      const issues = mutate(() => {
        resources_.categories.operations.create.computed[0].transform = 'slugifyy';
      });
      expect(issues).toContain(
        "resources.categories.operations.create.computed[0]: transform inexistente 'slugifyy'",
      );
    });

    it('check declarado en el recurso que no está en REGISTRY.checks', () => {
      const issues = mutate(() => {
        resources_.site.checks[0].check = 'not-in-sheeth';
      });
      expect(issues).toContain("resources.site.checks[0]: check inexistente 'not-in-sheeth'");
    });

    it('hook declarado en el recurso que no está en REGISTRY.hooks', () => {
      const issues = mutate(() => {
        resources_.orders.hooks.create[0] = 'pinHashh';
      });
      expect(issues).toContain("resources.orders.hooks.create[0]: hook inexistente 'pinHashh'");
    });

    it('computed de columna que no es un generador declarado', () => {
      const i = resources_.legal.fields.findIndex((f) => f.computed !== undefined);
      expect(i).toBeGreaterThanOrEqual(0);
      const issues = mutate(() => {
        resources_.legal.fields[i].computed = 'noww';
      });
      expect(issues).toContain(`resources.legal.fields[${i}]: computed inexistente 'noww'`);
    });

    it('computed de columna que no es un string', () => {
      const i = resources_.legal.fields.findIndex((f) => f.computed !== undefined);
      const issues = mutate(() => {
        resources_.legal.fields[i].computed = 42;
      });
      expect(issues).toContain(
        `resources.legal.fields[${i}]: \`computed\` debe ser el id de un generador`,
      );
    });
  });

  describe('4 · args contra argsSchema (R3.15)', () => {
    it('argumento desconocido en un check', () => {
      const issues = mutate(() => {
        resources_.site.checks[0].de_nada = 'x';
      });
      expect(issues).toContain("resources.site.checks[0]: argumento desconocido 'de_nada'");
    });

    it('obligatorio ausente en un check', () => {
      const issues = mutate(() => {
        delete resources_.legal.checks[1].pattern;
      });
      expect(issues).toContain(
        "resources.legal.checks[1]: falta el argumento obligatorio 'pattern'",
      );
    });

    it('argumento mal tipado en un check', () => {
      const issues = mutate(() => {
        resources_.legal.checks[1].negate = 'sí';
      });
      expect(issues).toContain("resources.legal.checks[1]: el argumento 'negate' debe ser boolean");
    });

    it('params de computed mal tipados', () => {
      const issues = mutate(() => {
        resources_.orders.operations.create.computed[0].params = { length: 'seis' };
      });
      expect(issues).toContain(
        "resources.orders.operations.create.computed[0].params: el argumento 'length' debe ser number",
      );
    });

    it('params de computed con un argumento que el generador no conoce', () => {
      const issues = mutate(() => {
        resources_.orders.operations.create.computed[0].params = { sinSentido: 1 };
      });
      expect(issues).toContain(
        "resources.orders.operations.create.computed[0].params: argumento desconocido 'sinSentido'",
      );
    });
  });

  // F7 · R7.2 (auth §4.8): `audiences` declara qué viaja a cada frontend y
  // handlePublicOrder lo LEE — declarar mentira acá es una fuga de datos en
  // producción, por eso cada familia de fallo tiene su rojo al arranque.
  describe('5 · audiencias (F7 · R7.2)', () => {
    it('forma válida: la audiencia pública real pasa limpia', () => {
      const issues = mutate(() => {
        resources_.orders.audiences.public.operations = ['get', 'list'];
      });
      expect(issues).toEqual([]);
    });

    it('audiencia con nombre que no es admin ni public', () => {
      const issues = mutate(() => {
        resources_.orders.audiences.cliente = { operations: ['get'] };
      });
      expect(issues).toContain(
        "resources.orders.audiences.cliente: audiencia desconocida (admite 'admin' y 'public')",
      );
    });

    it('clave mal escrita dentro de la audiencia', () => {
      const issues = mutate(() => {
        resources_.orders.audiences.public.listProjectionn = ['ref'];
      });
      expect(issues).toContain(
        "resources.orders.audiences.public: clave desconocida 'listProjectionn'",
      );
    });

    it('la audiencia pública no admite operaciones de escritura', () => {
      const issues = mutate(() => {
        resources_.orders.audiences.public.operations = ['get', 'update'];
      });
      expect(issues).toContain(
        "resources.orders.audiences.public: la audiencia 'public' es de sólo lectura ('update')",
      );
    });

    it('listProjection de audiencia con un campo que el recurso no tiene', () => {
      const issues = mutate(() => {
        resources_.orders.audiences.public.listProjection = ['ref', 'coste'];
      });
      expect(issues).toContain(
        "resources.orders.audiences.public.listProjection 'coste' no es un campo del recurso",
      );
    });

    it('views de audiencia con una vista que el recurso no tiene', () => {
      const issues = mutate(() => {
        resources_.orders.audiences.public.views = ['activos'];
      });
      expect(issues).toContain(
        "resources.orders.audiences.public.views 'activos' no es una vista del recurso",
      );
    });

    it('la audiencia no puede prometer una operación apagada en el recurso', () => {
      const issues = mutate(() => {
        resources_.orders.audiences.admin = { operations: ['reorder'] };
      });
      expect(issues).toContain(
        "resources.orders.audiences.admin: 'reorder' no está encendida en operations del recurso",
      );
    });

    it("la audiencia 'admin' exige exposeToFront: true", () => {
      const issues = mutate(() => {
        resources_.site.exposeToFront = false;
        resources_.site.audiences = { admin: { operations: ['get'] } };
      });
      expect(issues).toContain(
        "resources.site.audiences.admin: la audiencia 'admin' exige exposeToFront: true en el recurso",
      );
    });

    it('un recurso interno nunca declara audiencia pública', () => {
      const issues = mutate(() => {
        resources_._credenciales = {
          id: '_credenciales',
          kind: 'dashboard',
          sheet: null,
          operations: { get: true },
          audiences: { public: { operations: ['get'] } },
          fields: [],
        };
      });
      expect(issues).toContain(
        "resources._credenciales: recurso interno '_credenciales' no puede declarar audiencia 'public'",
      );
    });
  });

  // B8 · R7.4 — políticas por operación. El router sólo ve read|write; el
  // override fino lo exige 24-crud y su DECLARACIÓN se juzga acá: un mapa
  // que miente es un 403/401 de más o de menos en producción.
  describe('6 · políticas por operación (R7.4)', () => {
    it('forma válida: override apretado sobre el umbral del grupo', () => {
      const issues = mutate(() => {
        resources_.orders.policies = {
          access: {
            read: 'role:staff',
            write: 'admin',
            operations: { list: 'role:staff', remove: 'role:admin' },
          },
        };
      });
      expect(issues).toEqual([]);
    });

    it('nivel fuera del vocabulario en un override', () => {
      const issues = mutate(() => {
        resources_.orders.policies = { access: { operations: { list: 'sucribirse' } } };
      });
      expect(issues).toContain(
        "resources.orders.policies.access.operations.list: nivel inválido 'sucribirse'",
      );
    });

    it('operación con el vocabulario viejo (delete) en el mapa', () => {
      const issues = mutate(() => {
        resources_.orders.policies = { access: { operations: { delete: 'role:admin' } } };
      });
      expect(issues).toContain(
        'resources.orders.policies.access.operations.delete: operación desconocida ' +
          '(el motor habla list, get, create, update, remove, reorder, bulk, export, import)',
      );
    });

    it('override para una operación apagada en el recurso', () => {
      const issues = mutate(() => {
        resources_.orders.policies = { access: { operations: { reorder: 'role:admin' } } };
      });
      expect(issues).toContain(
        "resources.orders.policies.access.operations.reorder: 'reorder' no está encendida " +
          'en operations del recurso — la política nunca se aplica',
      );
    });

    it('override más suelto que el umbral de su grupo', () => {
      const issues = mutate(() => {
        resources_.orders.policies = { access: { operations: { list: 'session' } } };
      });
      expect(issues).toContain(
        "resources.orders.policies.access.operations.list: 'session' es más suelto que el " +
          'umbral read — en tráfico real el router ya lo exige, el override no afloja nada',
      );
    });

    it('nivel inválido en el umbral read del grupo', () => {
      const issues = mutate(() => {
        resources_.orders.policies = { access: { read: 'gerente' } };
      });
      expect(issues).toContain("resources.orders.policies.access.read: nivel inválido 'gerente'");
    });
  });

  // R9.5.1 · auditoría configurable (B14). `policies.audit` acepta el
  // booleano de siempre o `{ fields, retention }`. Todo lo malo acá muere en
  // ARRANQUE (R1.5), no en la poda: un `fields` con un typo auditaría en
  // silencio nada — exactamente el tipo de fallo silencioso que este
  // registro existe para impedir — y un `retention: 0` vaciaría la traza en
  // la primera corrida de `npm run audit:prune`.
  describe('6b · auditoría configurable (R9.5.1)', () => {
    const at = 'resources.orders.policies.audit';

    it('la forma histórica (true) sigue siendo válida', () => {
      const issues = mutate(() => {
        resources_.orders.policies.audit = true;
      });
      expect(issues).toEqual([]);
    });

    it('forma válida: fields + retention', () => {
      const issues = mutate(() => {
        resources_.orders.policies.audit = { fields: ['status', 'ref'], retention: 90 };
      });
      expect(issues).toEqual([]);
    });

    it('campo inexistente en fields (typo)', () => {
      const issues = mutate(() => {
        resources_.orders.policies.audit = { fields: ['statuss'] };
      });
      expect(issues).toContain(`${at}.fields[0]: campo inexistente 'statuss'`);
    });

    it('campo anidado en fields: no está en el registro plano de la traza', () => {
      const issues = mutate(() => {
        resources_.orders.policies.audit = { fields: ['action'] }; // itemFields de history
      });
      expect(issues).toContain(
        `${at}.fields[0]: 'action' no es un campo top-level ` +
          '(los anidados no están en el registro plano de la traza)',
      );
    });

    it('campo secret no se audita (sólo presencia)', () => {
      const issues = mutate(() => {
        resources_.users.policies = Object.assign({}, resources_.users.policies, {
          audit: { fields: ['pass_hash'] },
        });
      });
      expect(issues).toContain(
        `resources.users.policies.audit.fields[0]: 'pass_hash' es secret ` +
          '— no se audita (sólo presencia)',
      );
    });

    it('retention 0 vaciaría la traza ⇒ se rechaza en el arranque', () => {
      const issues = mutate(() => {
        resources_.orders.policies.audit = { retention: 0 };
      });
      expect(issues).toContain(
        `${at}.retention: mínimo 1 día — 0 vaciaría la traza en la primera poda`,
      );
    });

    it('retention que no es un entero', () => {
      const issues = mutate(() => {
        resources_.orders.policies.audit = { retention: '90' };
      });
      expect(issues).toContain(`${at}.retention: debe ser un entero de días`);
    });

    it('clave desconocida dentro del objeto audit (typo)', () => {
      const issues = mutate(() => {
        resources_.orders.policies.audit = { retentions: 30 };
      });
      expect(issues).toContain(`${at}: clave desconocida 'retentions'`);
    });

    it('audit que no es booleano ni objeto', () => {
      const issues = mutate(() => {
        resources_.orders.policies.audit = 'si';
      });
      expect(issues).toContain(`${at}: debe ser true, false o un objeto { fields, retention }`);
    });
  });

  describe('6c · formatos por campo (R9.5.3)', () => {
    // El campo inyectado va al final del arreglo ⇒ su índice es el largo
    // vigente (restaurado tras cada mutate).
    function at() {
      return `resources.orders.fields[${resources_.orders.fields.length}].formats`;
    }

    function withFormats(type, formats) {
      return mutate(() => {
        resources_.orders.fields.push({ key: 'adjunto', type, formats });
      });
    }

    it('formats en un campo `file` es válido', () => {
      expect(withFormats('file', 'pdf,docx')).toEqual([]);
    });

    it('formats en un campo `image` es válido (extensión vacía al final)', () => {
      expect(withFormats('image', 'jpg,png')).toEqual([]);
    });

    it('formats en un campo que no es de archivo se rechaza', () => {
      expect(withFormats('text', 'pdf')).toContain(
        `${at()}: sólo existe en campos tipo 'file' o 'image'`,
      );
    });

    it('formats vacío se rechaza', () => {
      expect(withFormats('file', '  ')).toContain(
        `${at()}: debe ser una lista de extensiones, p. ej. 'pdf,docx'`,
      );
    });

    it('formats que no es string se rechaza', () => {
      expect(withFormats('file', 42)).toContain(
        `${at()}: debe ser una lista de extensiones, p. ej. 'pdf,docx'`,
      );
    });

    it('una extensión mal formada se rechaza', () => {
      expect(withFormats('file', 'pdf,do cx')).toContain(`${at()}: extensión inválida 'do cx'`);
    });

    it('una extensión duplicada (aun en distinto casing) se rechaza', () => {
      expect(withFormats('file', 'pdf,PDF')).toContain(`${at()}: extensión duplicada 'pdf'`);
    });
  });

  describe('6d · import/export declarativo (R9.5.4)', () => {
    const orders = () => resources_.orders;
    const at = (op) => `resources.orders.operations.${op}`;

    /** orders.operations tiene create/update/remove/list/get ya declarados. */
    function withIo(extra) {
      return mutate(() => {
        orders().operations = Object.assign({}, orders().operations, extra);
      });
    }

    it('forma válida: export con fields escalares', () => {
      expect(withIo({ export: { fields: ['ref', 'customer_name', 'status'] } })).toEqual([]);
    });

    it('forma válida: import con fields', () => {
      expect(withIo({ import: { fields: ['ref', 'customer_name'] } })).toEqual([]);
    });

    it('format fuera de csv | json se rechaza', () => {
      expect(withIo({ export: { format: 'xml' } })).toContain(
        `${at('export')}.format: inválido 'xml' (csv | json)`,
      );
    });

    it('format en import se rechaza: el volcado entra como objetos', () => {
      expect(withIo({ import: { fields: ['ref'], format: 'json' } })).toContain(
        `${at('import')}.format: no existe en import — el volcado entra como objetos`,
      );
    });

    it('export que lista un campo inexistente (typo) se rechaza', () => {
      expect(withIo({ export: { fields: ['ref', 'customer_nam'] } })).toContain(
        `${at('export')}.fields: campo inexistente 'customer_nam'`,
      );
    });

    it('export que lista un campo que vive en hoja hija se rechaza', () => {
      expect(withIo({ export: { fields: ['history'] } })).toContain(
        `${at('export')}.fields: 'history' vive en la hoja hija: exporta sólo escalares`,
      );
    });

    it('export que lista un campo system/computed SÍ se permite (es dato)', () => {
      expect(withIo({ export: { fields: ['created_at'] } })).toEqual([]);
    });

    it('import que lista un campo system/computed se rechaza (lo pone el motor)', () => {
      expect(withIo({ import: { fields: ['created_at'] } })).toContain(
        `${at('import')}.fields: 'created_at' es system/computed: lo pone el motor, no se importa`,
      );
    });

    it('un campo duplicado en la lista blanca se rechaza', () => {
      expect(withIo({ export: { fields: ['ref', 'ref'] } })).toContain(
        `${at('export')}.fields: clave duplicada 'ref'`,
      );
    });

    it('una lista vacía o no-array se rechaza', () => {
      expect(withIo({ export: { fields: [] } })).toContain(
        `${at('export')}.fields: debe ser un arreglo de claves de campo`,
      );
      expect(withIo({ export: { fields: 'ref' } })).toContain(
        `${at('export')}.fields: debe ser un arreglo de claves de campo`,
      );
    });

    it('export/import sólo en colecciones', () => {
      const issues = mutate(() => {
        resources_.site.operations = Object.assign({}, resources_.site.operations, {
          export: { fields: ['key'] },
        });
      });
      // site es singleton ⇒ export/import no existen acá.
      expect(issues).toContain(
        "resources.site.operations.export: 'export' sólo existe en colecciones",
      );
    });

    it('un export/import con claves fuera del vocabulario (shape/computed) se rechaza', () => {
      expect(withIo({ export: { fields: ['ref'], shape: {} } })).toContain(
        `${at('export')}: clave desconocida 'shape'`,
      );
      expect(withIo({ import: { computed: [] } })).toContain(
        `${at('import')}: clave desconocida 'computed'`,
      );
    });

    it('el override access.operations.export obedece el umbral de READ', () => {
      // orders: read admin, write admin ⇒ un override 'session' es más
      // suelto que el umbral de read y también se rechaza (fail-closed).
      const issues = mutate(() => {
        orders().operations = Object.assign({}, orders().operations, {
          export: { fields: ['ref'] },
        });
        orders().policies.access.operations = { export: 'session' };
      });
      expect(issues.join('\n')).toContain('resources.orders.policies.access.operations.export');
    });
  });

  describe('7 · access por campo (R7.4b)', () => {
    // walkFields_ numera por índice (el nombre del campo no viaja en `at`).
    function at() {
      const i = resources_.orders.fields.findIndex((f) => f.key === 'customer_notes');
      return `resources.orders.fields[${i}].access`;
    }

    function fieldNamed(key) {
      return resources_.orders.fields.find((f) => f.key === key);
    }

    it('clave typo en access', () => {
      const issues = mutate(() => {
        fieldNamed('customer_notes').access = { reed: 'role:admin' };
      });
      expect(issues).toContain(`${at()}: clave desconocida 'reed'`);
    });

    it('nivel inválido en read', () => {
      const issues = mutate(() => {
        fieldNamed('customer_notes').access = { read: 'gerente' };
      });
      expect(issues).toContain(`${at()}.read: nivel inválido 'gerente'`);
    });

    it('access que no es objeto', () => {
      const issues = mutate(() => {
        fieldNamed('customer_notes').access = 'role:admin';
      });
      expect(issues).toContain(`${at()}: debe ser un objeto { read?, write? }`);
    });

    it('forma válida: read y write con alias admin', () => {
      const issues = mutate(() => {
        fieldNamed('customer_notes').access = { read: 'role:admin', write: 'admin' };
      });
      expect(issues).toEqual([]);
    });

    it('access asimétrico: sólo write', () => {
      const issues = mutate(() => {
        fieldNamed('customer_notes').access = { write: 'role:admin' };
      });
      expect(issues).toEqual([]);
    });
  });

  describe('8 · scope por fila (R7.4c)', () => {
    function setScope(scope) {
      resources_.orders.policies = {
        access: { read: 'admin', write: 'admin', scope },
        lock: false,
      };
    }

    it('nivel inválido como clave del scope', () => {
      const issues = mutate(() => {
        setScope({ gerente: [] });
      });
      expect(issues).toContain(
        "resources.orders.policies.access.scope.gerente: nivel inválido 'gerente'",
      );
    });

    it('scope que no es un mapa', () => {
      const issues = mutate(() => {
        setScope([{ field: 'status', op: 'eq', value: 'x' }]);
      });
      expect(issues).toContain(
        'resources.orders.policies.access.scope: debe ser un mapa nivel ⇒ where',
      );
    });

    it('scope vacío: todo quedaría fuera de alcance', () => {
      const issues = mutate(() => {
        setScope({});
      });
      expect(issues).toContain(
        'resources.orders.policies.access.scope: scope vacío — declara al menos un nivel o quítalo',
      );
    });

    it('scope en un singleton no tiene filas que filtrar', () => {
      const issues = mutate(() => {
        resources_.site.policies = {
          access: { read: 'public', write: 'admin', scope: { 'role:admin': [] } },
        };
      });
      expect(issues).toContain(
        'resources.site.policies.access.scope: scope no aplica a un singleton (no hay filas que filtrar)',
      );
    });

    it('condición con campo inexistente', () => {
      const issues = mutate(() => {
        setScope({ 'role:admin': [{ field: 'nope', op: 'eq', value: 'x' }] });
      });
      expect(issues).toContain(
        "resources.orders.policies.access.scope.role:admin[0]: campo inexistente 'nope'",
      );
    });

    it('condición con op inexistente', () => {
      const issues = mutate(() => {
        setScope({ 'role:admin': [{ field: 'status', op: 'zzz', value: 'x' }] });
      });
      expect(issues).toContain(
        "resources.orders.policies.access.scope.role:admin[0]: op desconocida 'zzz'",
      );
    });

    it('forma válida: plano y grupo or anidado', () => {
      const issues = mutate(() => {
        setScope({
          'role:admin': [],
          'role:staff': [
            { field: 'status', op: 'eq', value: 'pending' },
            {
              or: [
                { field: 'status', op: 'eq', value: 'ready' },
                { all: [{ field: 'status', op: 'eq', value: 'draft' }] },
              ],
            },
          ],
        });
      });
      expect(issues).toEqual([]);
    });
  });

  describe('9 · comandos, grants y cargas (F1)', () => {
    function addGrantCommand() {
      resources_.orders.fields
        .find((field) => field.key === 'history')
        .itemFields.push({
          key: 'operation_id',
          type: 'readonly-text',
          system: true,
        });
      REGISTRY.endpoints.pinVerify.issuesGrant = 'pickupGrant';
      REGISTRY.grantProfiles.pickupGrant = {
        purpose: 'register-pickup-person',
        issuedBy: 'pinVerify',
        resource: 'orders',
        command: 'registerPickupPerson',
        keyParam: 'ref',
        ttlSeconds: 900,
        maxUses: 1,
        consume: 'on-success',
      };
      resources_.orders.commands = {
        registerPickupPerson: {
          input: { authorized_name: { type: 'text', required: true, maxLength: 80 } },
          output: { ok: { type: 'boolean', required: true } },
          access: 'public',
          grant: 'pickupGrant',
          limits: '5/min',
          preconditions: [{ field: 'status', op: 'eq', value: 'PENDIENTE' }],
          changes: {
            authorized_name: { from: 'input.authorized_name' },
            auth_state: { value: 'ACTIVA' },
          },
          events: [
            {
              appendTo: 'history',
              operationIdField: 'operation_id',
              values: {
                action: { value: 'AUTORIZADO' },
                detail: { from: 'input.authorized_name' },
              },
            },
          ],
          errors: [{ status: 409, code: 'ALREADY_DONE', message: 'Comando ya completado.' }],
          idempotency: 'required',
        },
      };
    }

    it('acepta un comando declarado y un grant limitado, ligado a endpoint y key', () => {
      const issues = mutate(addGrantCommand);
      expect(issues).toEqual([]);
    });

    it('valida el prefijo explícito de commands y evita colisiones', () => {
      const invalidRouteIssues = mutate(() => {
        addGrantCommand();
        resources_.orders.commandsRoute = '/p/orders/:ref';
      });
      expect(invalidRouteIssues).toContain(
        'resources.orders.commandsRoute: debe ser una ruta base absoluta sin parámetros',
      );

      const duplicateRouteIssues = mutate(() => {
        addGrantCommand();
        resources_.products.commands = resources_.orders.commands;
        resources_.products.commandsRoute = '/p/orders';
      });
      expect(duplicateRouteIssues).toContain(
        'resources.products.commandsRoute: ruta de commands ya usada por orders',
      );
    });

    it('rechaza typos, referencias de input y campos de destino desconocidos', () => {
      const issues = mutate(() => {
        addGrantCommand();
        const command = resources_.orders.commands.registerPickupPerson;
        command.preconditions[0].op = 'eqx';
        command.changes.unknown_field = { from: 'input.no_such_field' };
        command.changes.updated_at = { value: 'not-generated' };
        command.undocumented = true;
      });
      expect(issues).toContain(
        "resources.orders.commands.registerPickupPerson: clave desconocida 'undocumented'",
      );
      expect(issues).toContain(
        "resources.orders.commands.registerPickupPerson.preconditions[0]: op inexistente 'eqx'",
      );
      expect(issues).toContain(
        'resources.orders.commands.registerPickupPerson.changes.unknown_field: campo inexistente',
      );
      expect(issues).toContain(
        'resources.orders.commands.registerPickupPerson.changes.updated_at: campo generado sólo admite su generador declarado',
      );
    });

    it('valida emisor mutuo, TTL/usos y grants asociados al comando exacto', () => {
      const issues = mutate(() => {
        addGrantCommand();
        REGISTRY.grantProfiles.pickupGrant.maxUses = 0;
        REGISTRY.grantProfiles.pickupGrant.keyParam = 'missing';
        REGISTRY.grantProfiles.pickupGrant.command = 'anotherCommand';
      });
      expect(issues).toContain(
        'grantProfiles.pickupGrant.keyParam: debe ser un parámetro de la ruta del endpoint emisor',
      );
      expect(issues).toContain('grantProfiles.pickupGrant.maxUses: debe ser un entero >= 1');
      expect(issues).toContain("grantProfiles.pickupGrant: command inexistente 'anotherCommand'");
      expect(issues).toContain(
        'resources.orders.commands.registerPickupPerson.grant: el perfil no está vinculado a este recurso y comando',
      );
    });

    it('valida perfiles de carga contra adaptadores, grant, límites y MIME types', () => {
      const issues = mutate(() => {
        addGrantCommand();
        REGISTRY.capabilities.adapters.cloudinary = {
          id: 'cloudinary',
          signUpload: () => ({}),
          verifyUpload: () => ({}),
        };
        REGISTRY.uploadProfiles.pickupPhoto = {
          provider: 'cloudinary',
          resource: 'orders',
          grant: 'pickupGrant',
          mimeTypes: ['image/jpeg', 'image/png'],
          maxBytes: 10 * 1024 * 1024,
          ttlSeconds: 300,
          namespace: 'pickup-person',
        };
        const command = resources_.orders.commands.registerPickupPerson;
        command.input.photo = { type: 'upload', profile: 'pickupPhoto', required: true };
        command.changes.authorized_photo = { from: 'input.photo' };
        expect(validateRegistry_()).toEqual([]);
        REGISTRY.uploadProfiles.pickupPhoto.provider = 'missing';
        REGISTRY.uploadProfiles.pickupPhoto.mimeTypes = ['not a mime'];
      });
      expect(issues).toContain("uploadProfiles.pickupPhoto: adapter inexistente 'missing'");
      expect(issues).toContain(
        'uploadProfiles.pickupPhoto.mimeTypes: debe ser un array no vacío de MIME types',
      );
    });
  });
});
