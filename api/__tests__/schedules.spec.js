// api/__tests__/schedules — R9.5.6 · jobs programados declarativos (B14 · O5).
//
// Dos familias de garantías cubren acá:
//
//  1. **La validación al arranque** (validate-registry): `resource.schedules`
//     es vocabulario nuevo, así que cada forma de mentir debe ser ROJA al
//     cargar — arreglo malformado, claves de más, id vacío o duplicado (en
//     el recurso Y entre recursos), cron fuera de los patrones GAS que el
//     motor sabe instalar. Y el caso NEGATIVO explícito: un handler que no
//     existe NO rompe el arranque (se resuelve en setup/runtime, ruidoso).
//
//  2. **La resolución del dispatch** (RUN_SCHEDULE_JOB_): el trigger de GAS
//     aterriza con `e.triggerUid`, el mapa SCHEDULE_TRIGGERS traduce ese uid
//     a `{ resource, id }` y el job corre como `handler(args, ctx)`. Todo
//     eslabón roto es 500 ruidoso, y el dispatch JAMÁS toca ScriptApp (O3:
//     instalar triggers es cosa del editor, setup/07).
//
// Patrón de carga: mismo `loadBackend` que el resto de la suite — el backend
// son scripts planos compartiendo un scope global.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBackend } from './_harness.js';

let REGISTRY;
let resources_;
let snapshot;
let propsStore;

// ── Utilidades ─────────────────────────────────────────────────────────────

/** Mutación con restauración: cada caso deja el registro exactamente como estaba. */
function mutate(fn) {
  const before = JSON.parse(JSON.stringify(REGISTRY.resources));
  try {
    fn();
    return validateRegistry_();
  } finally {
    REGISTRY.resources = before;
    resources_ = REGISTRY.resources; // el restore REEMPLAZA el objeto: refrescar la referencia
  }
}

/** Schedule con forma válida; `extra` pisa o añade claves para el caso. */
function schedule(extra = {}) {
  return { id: 'nightly', cron: 'atHour(3)', handler: 'jobNightly', args: {}, ...extra };
}

/** Declara schedules en un recurso y fija el mapa trigger ↔ schedule. */
function declare_(resourceId, schedules, uid = 'uid-1') {
  REGISTRY.resources[resourceId].schedules = schedules;
  const map = {};
  schedules.forEach((decl, i) => {
    map[uid + (i > 0 ? '-' + i : '')] = { resource: resourceId, id: decl.id };
  });
  propsStore.SCHEDULE_TRIGGERS = JSON.stringify(map);
  globalThis.Props.clearCache();
}

/** Lanza y devuelve el error (o null). */
function catchError_(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

beforeAll(() => {
  REGISTRY = loadBackend();
  resources_ = REGISTRY.resources;
});

beforeEach(() => {
  snapshot = JSON.parse(JSON.stringify(REGISTRY.resources));
  propsStore = {};
  // PropertiesService real (fake): Props es el ÚNICO punto de acceso al
  // servicio, así que basta con fakearlo acá para los tests de dispatch.
  globalThis.PropertiesService = {
    getScriptProperties: () => ({
      getProperties: () => Object.assign({}, propsStore),
      setProperties: (values) => Object.assign(propsStore, values),
    }),
  };
  globalThis.Props.clearCache();
});

afterEach(() => {
  REGISTRY.resources = snapshot;
  resources_ = REGISTRY.resources; // el restore REEMPLAZA el objeto: refrescar la referencia
  delete REGISTRY.handlers.__scheduleJobTest;
  delete globalThis.__scheduleJobGlobal;
  globalThis.Props.clearCache();
});

// ── 1 · validación al arranque ─────────────────────────────────────────────

describe('R9.5.6 · validate-registry — schedules', () => {
  it('un recurso con schedules válidos no produce ningún issue', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = [
        schedule(),
        schedule({ id: 'heartbeat', cron: 'everyMinutes(5)', handler: 'jobHeartbeat' }),
      ];
    });
    expect(issues).toEqual([]);
  });

  it('los cuatro patrones de cron soportados pasan (y nada más)', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = [
        schedule({ id: 'j1', cron: 'everyMinutes(5)' }),
        schedule({ id: 'j2', cron: 'everyHours(6)' }),
        schedule({ id: 'j3', cron: 'atHour(3)' }),
        schedule({ id: 'j4', cron: 'atHour(9) onWeekDay(Monday)' }),
      ];
    });
    expect(issues).toEqual([]);
  });

  it('schedules que no es un arreglo se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = { id: 'nightly' };
    });
    expect(issues).toContain('resources.orders.schedules: debe ser un arreglo de jobs programados');
  });

  it('un item que no es un objeto se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = ['nightly'];
    });
    expect(issues).toContain(
      'resources.orders.schedules[0]: debe ser un objeto { id, cron, handler, args }',
    );
  });

  it('una clave fuera del vocabulario (typo) se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = [schedule({ time: '3am' })];
    });
    expect(issues).toContain("resources.orders.schedules[0]: clave desconocida 'time'");
  });

  it('id vacío o no-string se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = [schedule({ id: '' }), schedule({ id: 42 })];
    });
    expect(issues).toContain('resources.orders.schedules[0].id: debe ser un string no vacío');
    expect(issues).toContain('resources.orders.schedules[1].id: debe ser un string no vacío');
  });

  it('id duplicado DENTRO del recurso se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = [schedule(), schedule({ cron: 'everyHours(6)' })];
    });
    expect(issues).toContain(
      "resources.orders.schedules[1].id: 'nightly' ya se usa en otro schedule del recurso",
    );
  });

  it('id duplicado ENTRE recursos se rechaza (el trigger handler debe ser único en el proyecto)', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = [schedule({ id: 'daily-sync' })];
      resources_.categories.schedules = [schedule({ id: 'daily-sync' })];
    });
    expect(issues.join('\n')).toMatch(
      /id 'daily-sync' ya usado por resources\.(orders|categories)/,
    );
    expect(issues).toHaveLength(1); // el duplicado DENTRO del recurso no aplica: cada uno tiene el suyo
  });

  it('cron fuera de los patrones GAS se rechaza (error de arranque)', () => {
    const malos = [
      '* * * * *',
      'daily',
      'everyMinutes(0)',
      'everyMinutes(60)',
      'everyHours(25)',
      'atHour(24)',
      'atHour(3) onWeekDay(Lunes)',
    ];
    malos.forEach((cron, i) => {
      const issues = mutate(() => {
        resources_.orders.schedules = [schedule({ id: 'j' + i, cron })];
      });
      expect(issues.join('\n')).toMatch(
        new RegExp(
          `resources\\.orders\\.schedules\\[0\\]\\.cron: patrón no soportado '${cron.replace(/[*()]/g, '\\$&')}'`,
        ),
      );
    });
  });

  it('cron ausente se rechaza como patrón inválido, no se ignora', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = [schedule({ cron: undefined })];
    });
    expect(issues).toContain(
      'resources.orders.schedules[0].cron: debe ser un string con un patrón GAS soportado',
    );
  });

  it('handler vacío se rechaza', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = [schedule({ handler: '' })];
    });
    expect(issues).toContain(
      'resources.orders.schedules[0].handler: debe ser un nombre de función no vacío',
    );
  });

  it('handler que es una función sólo-de-editor se rechaza (el cron no es una puerta a setupAll)', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = [schedule({ handler: 'setupAll' })];
    });
    expect(issues).toContain(
      "resources.orders.schedules[0].handler: 'setupAll' es sólo ejecutable desde el editor",
    );
  });

  it('args debe ser objeto u omitirse (nunca array)', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = [schedule({ args: ['no'] })];
    });
    expect(issues).toContain('resources.orders.schedules[0].args: debe ser un objeto (o ausente)');

    const sinArgs = mutate(() => {
      resources_.orders.schedules = [schedule({ args: undefined })];
    });
    expect(sinArgs).toEqual([]);
  });

  it('un handler NO registrado NO rompe el arranque (se resuelve en setup/runtime)', () => {
    const issues = mutate(() => {
      resources_.orders.schedules = [schedule({ handler: 'aunNoExisteEnNingunaParte' })];
    });
    expect(issues).toEqual([]);
  });
});

// ── 2 · dispatch: RUN_SCHEDULE_JOB_ ────────────────────────────────────────

describe('R9.5.6 · RUN_SCHEDULE_JOB_ — resolución del trigger', () => {
  it('resuelve el schedule por triggerUid y ejecuta handler(args, ctx)', () => {
    const job = vi.fn(() => 'hecho');
    globalThis.__scheduleJobGlobal = job;
    declare_('orders', [
      schedule({ id: 'nightly', handler: '__scheduleJobGlobal', args: { days: 7 } }),
    ]);

    const out = globalThis.RUN_SCHEDULE_JOB_({ triggerUid: 'uid-1' });

    expect(out).toBe('hecho');
    expect(job).toHaveBeenCalledTimes(1);
    const [args, ctx] = job.mock.calls[0];
    expect(args).toEqual({ days: 7 });
    expect(ctx).toMatchObject({
      resource: 'orders',
      id: 'nightly',
      cron: 'atHour(3)',
      triggerUid: 'uid-1',
    });
    expect(ctx.firedAt).toBeInstanceOf(Date);
  });

  it('el handler resuelve desde REGISTRY.handlers antes que globalThis (escape hatch §6)', () => {
    const job = vi.fn();
    REGISTRY.handlers.__scheduleJobTest = job;
    globalThis.__scheduleJobGlobal = vi.fn();
    declare_('orders', [schedule({ handler: '__scheduleJobTest' })]);

    globalThis.RUN_SCHEDULE_JOB_({ triggerUid: 'uid-1' });

    expect(job).toHaveBeenCalledTimes(1);
    expect(globalThis.__scheduleJobGlobal).not.toHaveBeenCalled();
  });

  it('sin e.triggerUid es 500 ruidoso (el dispatch no adivina el job)', () => {
    const err = catchError_(() => globalThis.RUN_SCHEDULE_JOB_({}));
    expect(err.apiStatus).toBe(500);
    expect(err.message).toMatch(/sólo corre desde un trigger instalado/);
  });

  it('un uid sin registro en SCHEDULE_TRIGGERS es 500, no un job fantasma', () => {
    const err = catchError_(() => globalThis.RUN_SCHEDULE_JOB_({ triggerUid: 'borrado' }));
    expect(err.apiStatus).toBe(500);
    expect(err.message).toMatch(/no tiene schedule registrado/);
  });

  it('un recurso ya no existente en REGISTRY es 500', () => {
    propsStore.SCHEDULE_TRIGGERS = JSON.stringify({
      'uid-1': { resource: 'fantasma', id: 'x' },
    });
    globalThis.Props.clearCache();
    const err = catchError_(() => globalThis.RUN_SCHEDULE_JOB_({ triggerUid: 'uid-1' }));
    expect(err.apiStatus).toBe(500);
    expect(err.message).toMatch(/recurso inexistente 'fantasma'/);
  });

  it('un schedule borrado de la declaración es 500 (el trigger viejo no dispara nada)', () => {
    declare_('orders', [schedule({ id: 'nightly' })]);
    REGISTRY.resources.orders.schedules = []; // el schema lo borró; la prop quedó vieja
    const err = catchError_(() => globalThis.RUN_SCHEDULE_JOB_({ triggerUid: 'uid-1' }));
    expect(err.apiStatus).toBe(500);
    expect(err.message).toMatch(/ya no está declarado/);
  });

  it('un handler declarado que no existe es 500 ruidoso, nunca silencio', () => {
    declare_('orders', [schedule({ handler: 'noExisteEnNingunaParte' })]);
    const err = catchError_(() => globalThis.RUN_SCHEDULE_JOB_({ triggerUid: 'uid-1' }));
    expect(err.apiStatus).toBe(500);
    expect(err.message).toMatch(/handler no registrado 'noExisteEnNingunaParte'/);
  });

  it('una SCHEDULE_TRIGGERS corrupta es error ruidoso (un reset mudo duplicaría triggers)', () => {
    propsStore.SCHEDULE_TRIGGERS = '{ no es json';
    globalThis.Props.clearCache();
    expect(() => globalThis.RUN_SCHEDULE_JOB_({ triggerUid: 'uid-1' })).toThrow(/corrupta/);
  });

  it('el dispatch JAMÁS toca ScriptApp — instalar triggers es sólo del editor (O3)', () => {
    const forbidden = vi.fn(() => {
      throw new Error('ScriptApp no debe tocarse en runtime');
    });
    globalThis.ScriptApp = { getProjectTriggers: forbidden, newTrigger: forbidden };
    globalThis.__scheduleJobGlobal = vi.fn();
    declare_('orders', [schedule({ handler: '__scheduleJobGlobal' })]);

    globalThis.RUN_SCHEDULE_JOB_({ triggerUid: 'uid-1' });

    expect(forbidden).not.toHaveBeenCalled();
  });
});
