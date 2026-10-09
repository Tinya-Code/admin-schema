import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionService } from './action-service';
import { registerAction, type ActionContext, type ActionDescriptor } from './action-registry';
import { actionDescriptors } from './descriptors';
import type { ResourceAction } from '../core/models/schema.model';
import type { ApiService } from '../core/services/api.service';
import { ConfigService } from '../core/services/config.service';
import type { NotificationService } from '../core/services/notification.service';
import type { Router } from '@angular/router';

/** Notificador falso: sólo el contrato que `ActionService` usa. */
function fakeToast(): NotificationService & { confirm: ReturnType<typeof vi.fn> } {
  return {
    confirm: vi.fn().mockResolvedValue(true),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  } as unknown as NotificationService & { confirm: ReturnType<typeof vi.fn> };
}

function fakeRequest(toast: NotificationService) {
  return {
    record: { slug: 'tecla', ref: 'p1' },
    resource: 'productos',
    api: {} as ApiService,
    router: { navigate: async () => true } as unknown as Router,
    toast,
    user: null,
    keyField: 'ref',
  };
}

const COMPARTIR: ResourceAction = {
  id: 'compartir',
  label: 'Compartir',
  type: 'copy-share',
  urlTemplate: 'https://demo/p/{ref}',
};

describe('ActionService', () => {
  let service: ActionService;
  let toast: ReturnType<typeof fakeToast>;

  beforeEach(() => {
    toast = fakeToast();
    TestBed.configureTestingModule({
      providers: [
        // ConfigService real pediría HttpClient/API_URL; sólo aporta `vars`.
        {
          provide: ConfigService,
          useValue: {
            buildInterpolationContext: (record: Record<string, unknown>) => ({
              ...record,
              public_base_url: 'https://demo',
            }),
          },
        },
      ],
    });
    service = TestBed.inject(ActionService);
  });

  // El `Map` del registro es estado de módulo **compartido entre ficheros**
  // cuando vitest los ejecuta en el mismo worker: varios tests de éste
  // sobrescriben `copy-share` / `navigate` / `trigger` con dobles.
  // Sin restaurar aquí, `contract.spec` y `descriptors.spec` leen esos dobles
  // y la suite se pone flaka **según el orden de ficheros** (falló 4 tests de
  // `descriptors.spec` en una corrida y 0 en la siguiente, sin tocar código).
  // Quien ensucia es quien limpia: el estado por defecto es el catálogo real.
  afterEach(() => {
    for (const descriptor of actionDescriptors) registerAction(descriptor);
  });

  it('ejecuta el descriptor y le entrega la petición + vars de interpolación', async () => {
    const vistos: ActionContext[] = [];
    registerAction({
      type: 'copy-share',
      surfaces: ['row', 'post-create'],
      run: async (ctx) => {
        vistos.push(ctx);
        return { ok: true, reload: true };
      },
    });

    const resultado = await service.run(COMPARTIR, fakeRequest(toast));

    expect(resultado).toEqual({ ok: true, reload: true });
    expect(vistos).toHaveLength(1);
    expect(vistos[0].record).toEqual({ slug: 'tecla', ref: 'p1' });
    expect(vistos[0].resource).toBe('productos');
    expect(vistos[0].vars).toEqual({ slug: 'tecla', ref: 'p1', public_base_url: 'https://demo' });
  });

  it('una acción sin type resuelve el descriptor navigate', async () => {
    const run = vi.fn<NonNullable<ActionDescriptor['run']>>();
    registerAction({ type: 'navigate', surfaces: ['row', 'detail'], run });

    await service.run({ id: 'ver', label: 'Ver', urlTemplate: '/p/{ref}' }, fakeRequest(toast));

    expect(run).toHaveBeenCalledOnce();
  });

  it('sin descriptor registrado rompe en lugar de ignorarse', async () => {
    // `ResourceAction` es una unión cerrada y el registro es estado de
    // módulo compartido entre tests: se fuerza un type que nadie registra
    // (el cast a `unknown` sólo salva al compilador, no cambia el código).
    const desconocida = { id: 'x', label: 'X', type: 'nadie' } as unknown as ResourceAction;
    await expect(service.run(desconocida, fakeRequest(toast))).rejects.toThrow(
      'no tiene descriptor registrado',
    );
  });

  it('con confirmación rechazada no ejecuta y devuelve ok false', async () => {
    toast.confirm.mockResolvedValue(false);
    const run = vi.fn<NonNullable<ActionDescriptor['run']>>();
    registerAction({
      type: 'trigger',
      surfaces: ['row'],
      confirm: true,
      run,
    });

    const resultado = await service.run(
      {
        id: 'publicar',
        label: 'Publicar',
        type: 'trigger',
        confirmMessage: 'Se publicará para todos.',
      },
      fakeRequest(toast),
    );

    expect(toast.confirm).toHaveBeenCalledWith({
      title: 'Publicar',
      message: 'Se publicará para todos.',
      confirmLabel: 'Confirmar',
      cancelLabel: 'Cancelar',
    });
    expect(run).not.toHaveBeenCalled();
    expect(resultado).toEqual({ ok: false });
  });

  it('con confirmación aceptada ejecuta el descriptor', async () => {
    const run = vi.fn<NonNullable<ActionDescriptor['run']>>().mockResolvedValue({ ok: true });
    registerAction({ type: 'trigger', surfaces: ['row'], confirm: true, run });

    const resultado = await service.run(
      { id: 'duplicar', label: 'Duplicar', type: 'trigger' },
      fakeRequest(toast),
    );

    expect(run).toHaveBeenCalledOnce();
    expect(resultado).toEqual({ ok: true });
  });

  it('un error del descriptor se notifica y no se devuelve como éxito', async () => {
    registerAction({
      type: 'copy-share',
      surfaces: ['row'],
      run: async () => {
        throw new Error('El backend respondió 500');
      },
    });

    const resultado = await service.run(COMPARTIR, fakeRequest(toast));

    expect(toast.error).toHaveBeenCalledWith('El backend respondió 500');
    expect(resultado).toEqual({ ok: false });
  });
});
