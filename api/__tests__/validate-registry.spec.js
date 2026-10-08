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

/** Mutación con restauración: cada caso deja el registro exactamente como estaba. */
function mutate(fn) {
  const before = JSON.parse(JSON.stringify(REGISTRY.resources));
  try {
    fn();
    return validateRegistry_();
  } finally {
    // El snapshot se toma ANTES de mutar: si se tomará en el finally ya
    // sería el estado sucio y el "restore" perpetuaría la mutación.
    REGISTRY.resources = before;
    resources_ = before;
  }
}

describe('R1.5 — validateRegistry_', () => {
  beforeEach(() => {
    REGISTRY = loadBackend();
    resources_ = REGISTRY.resources;
    snapshot = JSON.stringify(resources_);
  });

  afterEach(() => {
    REGISTRY.resources = JSON.parse(snapshot);
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

    it('relation apuntando a un recurso que no existe', () => {
      // La única relación real: products.category_slug → categories.
      const idx = resources_.products.fields.findIndex((f) => f.type === 'relation');
      expect(idx).toBeGreaterThanOrEqual(0);
      const key = resources_.products.fields[idx].key;

      const issues = mutate(() => {
        resources_.products.fields[idx].resource = 'fantasma';
      });
      expect(issues).toContain(
        `resources.products.fields[${idx}]: relation '${key}' apunta al recurso ` +
          "'fantasma', que no existe",
      );
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
  });
});
