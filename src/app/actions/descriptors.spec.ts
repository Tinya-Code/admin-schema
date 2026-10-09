import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { of } from 'rxjs';

import { getAction, type ActionContext } from './action-registry';
import { resolveShare } from './descriptors';
import type { CopyShareAction, NavigateAction, TriggerAction } from '../core/models/schema.model';
import type { ApiService } from '../core/services/api.service';
import type { NotificationService } from '../core/services/notification.service';
import type { Router } from '@angular/router';

const VARS = { public_base_url: 'https://demo', ref: 'p1', customer_name: 'Ana' };

const COMPARTIR: CopyShareAction = {
  id: 'share',
  label: 'Compartir',
  type: 'copy-share',
  urlTemplate: '{public_base_url}/p/{ref}',
  shareTextTemplate: 'Hola {customer_name}, tu pedido {ref}',
};

function contexto(): ActionContext {
  return {
    record: { ref: 'p1' },
    resource: 'orders',
    api: { request: vi.fn().mockReturnValue(of({ ok: true })) } as unknown as ApiService,
    router: { navigateByUrl: vi.fn().mockResolvedValue(true) } as unknown as Router,
    toast: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      confirm: vi.fn(),
      dismiss: vi.fn(),
    } as unknown as NotificationService,
    user: null,
    keyField: 'ref',
    vars: VARS,
  };
}

/** El `run` de un tipo registrado; lanza si no existe (estado incoherente). */
function ejecutar(type: string, action: CopyShareAction | NavigateAction | TriggerAction) {
  const descriptor = getAction(type);
  if (!descriptor) throw new Error(`sin descriptor «${type}»`);
  return descriptor.run;
}

describe('resolveShare', () => {
  it('interpola enlace y mensaje con el contexto del registro', () => {
    expect(resolveShare(COMPARTIR, VARS)).toEqual({
      url: 'https://demo/p/p1',
      shareText: 'Hola Ana, tu pedido p1',
    });
  });

  it('sin shareTextTemplate cae a share_message_template (config global)', () => {
    const action: CopyShareAction = { ...COMPARTIR, shareTextTemplate: undefined };
    expect(resolveShare(action, { ...VARS, share_message_template: 'Hola {ref}' })).toEqual({
      url: 'https://demo/p/p1',
      shareText: 'Hola p1',
    });
  });

  it('sin plantilla ninguna el mensaje queda vacío', () => {
    const action: CopyShareAction = { ...COMPARTIR, shareTextTemplate: undefined };
    expect(resolveShare(action, VARS).shareText).toBe('');
  });
});

describe('descriptores de acción', () => {
  const escritor = vi.fn().mockResolvedValue(undefined);
  let abrir: MockInstance;

  beforeEach(() => {
    escritor.mockClear();
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: escritor },
      configurable: true,
    });
    abrir = vi.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copy-share copia el mensaje completo y lo anuncia', async () => {
    const ctx = contexto();
    const resultado = await ejecutar('copy-share', COMPARTIR)(ctx, COMPARTIR);

    expect(escritor).toHaveBeenCalledWith('Hola Ana, tu pedido p1 https://demo/p/p1');
    expect(ctx.toast.success).toHaveBeenCalledWith('Mensaje copiado al portapapeles.');
    expect(resultado).toEqual({ ok: true });
  });

  it('navigate abre una URL absoluta en otra pestaña', async () => {
    const action: NavigateAction = {
      id: 'ver',
      label: 'Ver público',
      urlTemplate: '{public_base_url}/p/{ref}',
    };
    const ctx = contexto();

    await ejecutar('navigate', action)(ctx, action);

    expect(abrir).toHaveBeenCalledWith('https://demo/p/p1', '_blank', 'noopener');
    expect(ctx.router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('navigate entrega una ruta interna al router', async () => {
    const action: NavigateAction = { id: 'editar', label: 'Editar', urlTemplate: '/orders/p1' };
    const ctx = contexto();

    await ejecutar('navigate', action)(ctx, action);

    expect(ctx.router.navigateByUrl).toHaveBeenCalledWith('/orders/p1');
    expect(abrir).not.toHaveBeenCalled();
  });

  it('trigger arma la ruta lógica de la acción declarada y pide recarga', async () => {
    const action: TriggerAction = {
      id: 'markDelivered',
      label: 'Marcar entregado',
      type: 'trigger',
    };
    const ctx = contexto();

    const resultado = await ejecutar('trigger', action)(ctx, action);

    expect(ctx.api.request).toHaveBeenCalledWith('POST', '/admin/orders/p1/actions/markDelivered');
    expect(resultado).toEqual({ ok: true, reload: true });
  });

  it('trigger usa `name` cuando en el back se llama distinto que el `id`', async () => {
    const action: TriggerAction = {
      id: 'reenviar',
      label: 'Reenviar pin',
      type: 'trigger',
      name: 'resendPin',
    };
    const ctx = contexto();

    await ejecutar('trigger', action)(ctx, action);

    expect(ctx.api.request).toHaveBeenCalledWith('POST', '/admin/orders/p1/actions/resendPin');
  });

  it('sin clave de registro no dispara nada y lo dice (fail-loud)', async () => {
    const action: TriggerAction = { id: 'markDelivered', label: 'Marcar', type: 'trigger' };
    const ctx = contexto();
    ctx.record = null;

    await expect(ejecutar('trigger', action)(ctx, action)).rejects.toThrow('necesita la clave ref');
    expect(ctx.api.request).not.toHaveBeenCalled();
  });
});
