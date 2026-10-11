import { TestBed } from '@angular/core/testing';
import { Subject, map, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResourceEndpoints } from '../models/schema.model';
import { ApiService } from './api.service';
import { ConfigService } from './config.service';

const SITE: ResourceEndpoints = { get: '/admin/site' };
const PICKPASS: ResourceEndpoints = { get: '/admin/pickpass' };

describe('ConfigService', () => {
  const getSpy = vi.fn();

  const svc = (): ConfigService => TestBed.inject(ConfigService);

  /** Resuelve el último intento de `ensureLoaded` (o el `load` disparado). */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve));

  beforeEach(() => {
    getSpy.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: { get: getSpy } }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('load() mezcla los singletons en globalConfig', async () => {
    getSpy.mockImplementation((ep: ResourceEndpoints) =>
      ep.get === '/admin/site'
        ? of({ public_base_url: 'https://pasteleria.example' })
        : of({ share_message_template: 'Hola {customer_name}' }),
    );

    svc().load([SITE, PICKPASS]);
    await settle();

    expect(svc().globalConfig()['public_base_url']).toBe('https://pasteleria.example');
    expect(svc().globalConfig()['share_message_template']).toBe('Hola {customer_name}');
  });

  it('un singleton que falla no rompe la carga y deja la config parcial', async () => {
    getSpy.mockImplementation((ep: ResourceEndpoints) =>
      ep.get === '/admin/site'
        ? of({ public_base_url: 'https://pasteleria.example' })
        : throwError(() => new Error('401')),
    );

    svc().load([SITE, PICKPASS]);
    await settle();

    // El singleton vivo aporta sus claves…
    expect(svc().globalConfig()['public_base_url']).toBe('https://pasteleria.example');
    // …y el caído no tumba nada (comportamiento histórico intacto).
    expect(svc().globalConfig()['share_message_template']).toBeUndefined();
  });

  it('regresión R8.7: si el load del bootstrap falló, ensureLoaded reintenta y trae el template', async () => {
    // Escenario real: la app arrancó SIN sesión → los singletons responden
    // 401 → el catch silencia → sin `share_message_template` el mensaje de
    // `copy-share` salía «sólo la URL». Con sesión ya iniciada, el share
    // pide la config de nuevo.
    getSpy.mockImplementation(() => throwError(() => new Error('401')));

    const config = svc();
    config.load([SITE, PICKPASS]);
    await settle();
    expect(config.globalConfig()['share_message_template']).toBeUndefined();

    // …llega el login y `copy-share` llama a `ensureLoaded()`:
    getSpy.mockImplementation((ep: ResourceEndpoints) =>
      ep.get === '/admin/pickpass'
        ? of({ share_message_template: 'Hola {customer_name}, tu pedido {ref}' })
        : of({ public_base_url: 'https://pasteleria.example' }),
    );
    await config.ensureLoaded();

    expect(config.globalConfig()['share_message_template']).toBe(
      'Hola {customer_name}, tu pedido {ref}',
    );
  });

  it('tras una carga completa, ensureLoaded no vuelve a viajar', async () => {
    getSpy.mockImplementation(() => of({ marca: 'ok' }));

    const config = svc();
    config.load([SITE]);
    await settle();
    expect(getSpy).toHaveBeenCalledTimes(1);

    await config.ensureLoaded();
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('ensureLoaded concurrente comparte UN solo viaje', async () => {
    const gate = new Subject<void>();
    getSpy.mockImplementation(() => gate.pipe(map(() => ({ marca: 'ok' }))));

    const config = svc();
    // `load` dispara la primera carga y registra los endpoints; la llamada
    // concurrente debe apilarse en ese MISMO vuelo, no abrir otro.
    config.load([SITE]);
    const segundo = config.ensureLoaded();
    gate.next(undefined);
    gate.complete();
    await segundo;

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(config.globalConfig()['marca']).toBe('ok');
  });

  it('sin endpoints o sin api resolve sin viajar', async () => {
    const config = svc();
    config.load([]);
    await config.ensureLoaded();
    expect(getSpy).not.toHaveBeenCalled();
  });
});
