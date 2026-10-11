// api/__tests__/endpoint-contract — B2 · R5.1: el contrato declarativo
// input/output de los endpoints y su validación EN EL ROUTER.
//
// Lo que éste archivo cubre y ninguna otra parte cubre:
//
//  1. **La entrada se valida ANTES del handler.** Un email mal formado en
//     `/auth/login` corta con 422 `errors[]` (el sobre que pinta el form,
//     base.md §5) y el handler nunca se entera. Un endpoint SIN `input`
//     no cambia: esa es la precondición de R5.1.
//  2. **Los grupos**: `params` sale de la ruta (`/…/:ref`) y el resto de
//     ese bloque del payload; lo plano va a la raíz. Sólo lo DECLARADO se
//     valida (whitelist), y `secret` — la contraseña — sólo comprueba
//     presencia: su contenido lo juzga el handler.
//  3. **La salida sólo en dev** (B2): en prod el contrato documenta, no
//     frená. Un handler que devuelve lo que su `output` niega es un 500
//     RUIDOSO en dev y un 200 en prod.
//  4. **La declaración se valida en el ARRANQUE** (schema/validate-registry):
//     tipo inexistente, `since` malo, `cache` mal formada y claves
//     desconocidas rompen el arranque, no la petición.
//
// Los endpoints temporales que se declaran acá se borran y además se
// reinicia `ROUTE_TABLE_`, que cachea la tabla por ejecución: sin ese
// reset el router seguiría resolviendo con la tabla vieja.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let REGISTRY;
let endpointsSnapshot;
let originalPropertiesService;

/** POST de verdad por la ruta que usa el front; devuelve el cuerpo JSON. */
function post(path, payload = {}, method = 'POST') {
  const raw = globalThis.doPost({
    postData: { contents: JSON.stringify({ method, path, payload }) },
  });
  return JSON.parse(raw.getContent());
}

/** Registra un endpoint temporal y fuerza el recálculo de la tabla. */
function addEndpoint(id, decl, handler) {
  REGISTRY.endpoints[id] = decl;
  globalThis[decl.handler] = handler;
  globalThis.ROUTE_TABLE_ = null;
}

function removeEndpoint(id, handlerName) {
  delete REGISTRY.endpoints[id];
  delete globalThis[handlerName];
  globalThis.ROUTE_TABLE_ = null;
}

describe('B2 · R5.1 — contrato declarativo de endpoints', () => {
  beforeEach(() => {
    REGISTRY = loadBackend();
    endpointsSnapshot = JSON.parse(JSON.stringify(REGISTRY.endpoints));
    originalPropertiesService = globalThis.PropertiesService;
    globalThis.ROUTE_TABLE_ = null;
  });

  afterEach(() => {
    REGISTRY.endpoints = endpointsSnapshot;
    globalThis.ROUTE_TABLE_ = null;
    globalThis.PropertiesService = originalPropertiesService;
    globalThis.Props && globalThis.Props.clearCache();
  });

  // ── 1. La entrada, antes del handler ────────────────────────────────────

  describe('entrada', () => {
    it('un campo mal formado corta con 422 y el handler no se entera', () => {
      // El login sólo devuelve 401/200: un 422 con errors[] viene SÓLO del
      // validador del router, así que ésta es la prueba de «antes del handler».
      const body = post('/auth/login', { email: 'no-es-correo', password: 'x' });
      expect(body.error.status).toBe(422);
      expect(body.error.errors).toEqual([
        { path: 'email', message: 'Correo inválido', code: 'VALIDATION_EMAIL' },
      ]);
    });

    it('un campo declarado sin `required` no lo exige el router', () => {
      // `password` está declarada como `secret` y NO es required: sin ella
      // el 422 lo sigue tirando el HANDLER con sus palabras ('Requerido',
      // sin `code`), no el validador del router ('Este campo es obligatorio'
      // + VALIDATION_REQUIRED). Ésa es la diferencia que éste test fija.
      const body = post('/auth/login', { email: 'ana@x.com' });
      expect(body.error.status).toBe(422);
      expect(body.error.errors).toEqual([{ path: 'password', message: 'Requerido' }]);
    });

    it('un endpoint SIN `input` no valida nada (precondición de R5.1)', () => {
      addEndpoint(
        '__sinInput',
        { route: '/__sin-input', method: 'POST', access: 'public', handler: '__sinInput' },
        () => ({ ok: true }),
      );
      try {
        // Payload absurdo: sin declaración no hay contra qué compararlo.
        expect(post('/__sin-input', { cualquier: 'cosa' })).toEqual({ ok: true });
      } finally {
        removeEndpoint('__sinInput', '__sinInput');
      }
    });

    it('la verificación pública exige el PIN antes de llamar al handler', () => {
      const body = post('/p/pin/ORD-123', {});
      expect(body.error.status).toBe(422);
      expect(body.error.errors.map(({ path, code }) => ({ path, code }))).toEqual([
        { path: 'pin', code: 'VALIDATION_REQUIRED' },
      ]);
    });

    it('el grupo `params` se valida contra la RUTA, no contra el payload', () => {
      addEndpoint(
        '__params',
        {
          route: '/__params/:ref',
          method: 'POST',
          access: 'public',
          handler: '__params',
          input: { params: { ref: { type: 'text', required: true, pattern: '^[A-Z]+$' } } },
        },
        (payload, request) => ({ ref: request.params.ref }),
      );
      try {
        const malo = post('/__params/abc');
        expect(malo.error.status).toBe(422);
        expect(malo.error.errors[0].path).toBe('params.ref');

        // El patrón sólo puede salir del grupo `params`: el payload va vacío.
        expect(post('/__params/ABC')).toEqual({ ref: 'ABC' });
      } finally {
        removeEndpoint('__params', '__params');
      }
    });

    it('un grupo del payload se valida con la ruta `<grupo>.<campo>`', () => {
      const issues = globalThis.validateEndpointInput_(
        { query: { ref: { type: 'text', required: true } } },
        {},
        {},
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toBe('query.ref');
      expect(issues[0].code).toBe('VALIDATION_REQUIRED');
    });

    it('`secret` sólo comprueba presencia: no juzga el contenido', () => {
      expect(
        globalThis.validateEndpointInput_({ password: { type: 'secret' } }, { password: 'x' }, {}),
      ).toEqual([]);
      expect(
        globalThis.validateEndpointInput_({ password: { type: 'secret', required: true } }, {}, {}),
      ).toHaveLength(1);
    });

    it('una declaración mal formada es 500 (el schema manda), no 422', () => {
      expect(() => globalThis.validateEndpointInput_(['no', 'es', 'objeto'], {}, {})).toThrow(
        /mal declarado/,
      );
      expect(() => globalThis.validateEndpointInput_({ k: 'campo suelto' }, {}, {})).toThrow(
        /mal declarado/,
      );
      expect(() =>
        globalThis.validateEndpointInput_({ params: { ref: 'sin type' } }, {}, {}),
      ).toThrow(/no es un campo declarado/);
    });
  });

  // ── 2. La salida, sólo en dev ───────────────────────────────────────────

  describe('salida', () => {
    it('lo que el contrato niega es issue; lo que cumple, no', () => {
      const output = { ok: { type: 'boolean', required: true } };
      expect(globalThis.validateEndpointOutput_(output, { ok: true })).toEqual([]);

      const faltan = globalThis.validateEndpointOutput_(output, {});
      expect(faltan).toHaveLength(1);
      expect(faltan[0].path).toBe('ok');

      const malo = globalThis.validateEndpointOutput_(output, { ok: 'si' });
      expect(malo).toHaveLength(1);
      expect(malo[0].path).toBe('ok');
    });

    it('en DEV una salida fuera de contrato es 500 y nombra el campo', () => {
      addEndpoint(
        '__salida',
        {
          route: '/__salida',
          method: 'GET',
          access: 'public',
          handler: '__salida',
          output: { ok: { type: 'boolean', required: true } },
        },
        () => ({ ok: 'si' }), // el contrato pide boolean
      );
      try {
        const body = post('/__salida', {}, 'GET');
        expect(body.error.status).toBe(500);
        expect(body.error.message).toMatch(/Salida fuera de contrato en \/__salida/);
        expect(body.error.message).toMatch(/ok:/);
      } finally {
        removeEndpoint('__salida', '__salida');
      }
    });

    it('en PROD esa misma salida pasa: el contrato documenta, no frena', () => {
      globalThis.PropertiesService = {
        getScriptProperties: () => ({ getProperties: () => ({ ENV: 'prod' }) }),
      };
      globalThis.Props.clearCache();
      expect(globalThis.Props.isDev()).toBe(false);

      addEndpoint(
        '__salidaProd',
        {
          route: '/__salida-prod',
          method: 'GET',
          access: 'public',
          handler: '__salidaProd',
          output: { ok: { type: 'boolean', required: true } },
        },
        () => ({ ok: 'si' }),
      );
      try {
        expect(post('/__salida-prod', {}, 'GET')).toEqual({ ok: 'si' });
      } finally {
        removeEndpoint('__salidaProd', '__salidaProd');
      }
    });

    it('`output` sin declarar no mira nada, aunque la salida sea rara', () => {
      expect(globalThis.validateEndpointOutput_(null, { lo: 'que sea' })).toEqual([]);
      expect(globalThis.validateEndpointOutput_(undefined, 'texto')).toEqual([]);
    });
  });

  // ── 3. La declaración, al ARRANQUE ──────────────────────────────────────

  describe('declaración (validate-registry)', () => {
    /** Mutación con restauración sobre endpoints (mismo patrón que resources). */
    function mutateEndpoint(id, decl) {
      const antes = REGISTRY.endpoints[id];
      try {
        REGISTRY.endpoints[id] = decl;
        return globalThis.validateRegistry_();
      } finally {
        REGISTRY.endpoints[id] = antes;
      }
    }

    it('la declaración real de los 10 endpoints no tiene ni un problema', () => {
      expect(globalThis.validateRegistry_()).toEqual([]);
    });

    it('un tipo de campo inexistente en `input` rompe el arranque', () => {
      const issues = mutateEndpoint('authLogin', {
        route: '/auth/login',
        method: 'POST',
        access: 'public',
        handler: 'handleAuthLogin',
        input: { email: { type: 'correoo' } },
      });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/endpoints\.authLogin\.input\.email: tipo de campo inexistente/);
    });

    it('`since`, `cache` y las claves desconocidas se detectan', () => {
      expect(
        mutateEndpoint('dashboard', {
          route: '/admin/dashboard',
          method: 'GET',
          access: 'admin',
          handler: 'handleDashboard',
          since: 'v1',
        }),
      ).toHaveLength(1);

      expect(
        mutateEndpoint('schema', {
          route: '/admin/schema',
          method: 'GET',
          access: 'admin',
          handler: 'handleSchema',
          cache: { ttl: -5, key: [] },
        }),
      ).toHaveLength(2);

      expect(
        mutateEndpoint('sheetDrift', {
          route: '/admin/sheet-drift',
          method: 'GET',
          access: 'admin',
          handler: 'handleSheetDrift',
          inpput: {},
        }),
      ).toHaveLength(1);
    });

    it('los errores declarados requieren status válido y descripción', () => {
      const issues = mutateEndpoint('pinVerify', {
        ...REGISTRY.endpoints.pinVerify,
        errors: [
          { status: 399, description: '' },
          { status: 401, description: 'Uno' },
          { status: 401, description: 'Duplicado' },
        ],
      });

      expect(issues).toEqual([
        expect.stringContaining('status: debe ser un entero entre 400 y 599'),
        expect.stringContaining('description: debe ser texto no vacío'),
        expect.stringContaining('status: no debe repetirse'),
      ]);
    });

    it('un `resource` inexistente es referencia rota, no descubierta en producción', () => {
      const issues = mutateEndpoint('pinVerify', {
        route: '/p/pin/:ref',
        method: 'POST',
        access: 'public',
        handler: 'handlePinVerify',
        resource: 'noExiste',
      });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/resource inexistente 'noExiste'/);
    });

    it('los 10 endpoints declaran `since` y sólo 5 llevan contrato de salida', () => {
      const endpoints = Object.values(REGISTRY.endpoints);
      expect(endpoints).toHaveLength(10);
      for (const ep of endpoints) expect(ep.since).toBe('1.0');
      expect(Object.keys(REGISTRY.endpoints).filter((id) => REGISTRY.endpoints[id].output)).toEqual(
        ['authLogin', 'authMe', 'authLogout', 'events', 'pinVerify'],
      );
      expect(REGISTRY.endpoints.authLogin.input).toEqual({
        email: { type: 'email' },
        password: { type: 'secret' },
      });
      expect(REGISTRY.endpoints.pinVerify.input).toEqual({
        params: { ref: { type: 'text', required: true } },
        pin: { type: 'secret', required: true },
      });
    });
  });
});
