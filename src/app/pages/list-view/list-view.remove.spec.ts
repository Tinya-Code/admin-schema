import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { categoriesSchema } from '../../schemas/categories.schema';
import { ConfirmDialog } from '../../shared/components/confirm-dialog/confirm-dialog';
import { ListView } from './list-view';

/**
 * Fase 9.4 — borrado con confirmación.
 *
 * El diálogo no vive en `list-view`: lo monta `app.html` sobre
 * `NotificationService.confirmation`. Este host replica ese cableado para que
 * el test cubra el recorrido completo (clic en la fila → diálogo con el
 * nombre del registro → confirmación → borrado), y no sólo la llamada al
 * servicio.
 */
@Component({
  template: `
    <app-list-view [schema]="schema" />
    <app-confirm-dialog
      [options]="notifications.confirmation()"
      [danger]="true"
      (confirmed)="notifications.resolveConfirmation(true)"
      (cancelled)="notifications.resolveConfirmation(false)"
    />
  `,
  imports: [ListView, ConfirmDialog],
})
class RemoveHost {
  readonly schema = categoriesSchema;
  readonly notifications = inject(NotificationService);
}

describe('ListView — 9.4: borrado con confirmación', () => {
  let fixture: ComponentFixture<RemoveHost>;
  let api: { list: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    api = {
      list: vi.fn(() =>
        of([
          { slug: 'alfa', name: 'Alfa', active: true },
          { slug: 'beta', name: 'Beta', active: true },
        ]),
      ),
      remove: vi.fn(() => of(undefined)),
    };
    router = { navigate: vi.fn().mockResolvedValue(true) };

    await TestBed.configureTestingModule({
      imports: [RemoveHost],
      providers: [
        provideRouter([]),
        { provide: Router, useValue: router },
        { provide: ApiService, useValue: api },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RemoveHost);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const dialog = (): HTMLElement | null => root().querySelector('[role="dialog"]');

  /** Botón «Eliminar» de la fila que contiene `name` (fuera del diálogo). */
  const deleteButtonOf = (name: string): HTMLButtonElement | undefined => {
    const row = Array.from(root().querySelectorAll<HTMLTableRowElement>('tr')).find((candidate) =>
      candidate.textContent?.includes(name),
    );
    return Array.from(row?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Eliminar'),
    ) as HTMLButtonElement | undefined;
  };

  /** Botón «Eliminar» del diálogo de confirmación. */
  const confirmButton = (): HTMLButtonElement | undefined =>
    Array.from(dialog()?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Eliminar'),
    ) as HTMLButtonElement | undefined;

  const cancelLabel = (): HTMLButtonElement | undefined =>
    Array.from(dialog()?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Cancelar'),
    ) as HTMLButtonElement | undefined;

  /**
   * `removeRow` encadena promesas (confirmación → `api.remove` →
   * `rows.update`) y `whenStable` no garantiza drenar esas continuaciones:
   * un turno de macrotask las vacía antes de repintar.
   */
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('la confirmación nombra el registro y explica que no se puede deshacer', async () => {
    deleteButtonOf('Alfa')!.click();
    await settle();

    const panel = dialog();
    expect(panel, 'el diálogo de confirmación no se abrió').not.toBeNull();
    expect(panel!.textContent).toContain('Eliminar «Alfa»');
    expect(panel!.textContent).toContain('Esta acción no se puede deshacer.');
    // El nombre es el del registro clicado, no el de otro.
    expect(panel!.textContent).not.toContain('«Beta»');
  });

  it('cancelar cierra el diálogo y no borra nada', async () => {
    deleteButtonOf('Alfa')!.click();
    await settle();

    cancelLabel()!.click();
    await settle();

    expect(dialog(), 'el diálogo debería haberse cerrado').toBeNull();
    expect(api.remove).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Alfa');
    expect(fixture.nativeElement.textContent).toContain('Beta');
  });

  it('confirmar borra sólo esa fila sin recargar ni salir del listado', async () => {
    deleteButtonOf('Alfa')!.click();
    await settle();

    confirmButton()!.click();
    await settle();

    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(api.remove.mock.calls[0][1], 'la clave borrada no es la de Alfa').toBe('alfa');
    expect(dialog(), 'el diálogo debería haberse cerrado').toBeNull();

    const text = fixture.nativeElement.textContent as string;
    expect(text, 'la fila borrada sigue en pantalla').not.toContain('Alfa');
    expect(text, 'se borró de más: Beta sigue siendo un registro').toContain('Beta');

    // «Se conserva la página actual»: el listado no se vuelve a pedir ni se
    // navega a otra ruta (list-view no tiene paginación; ésta es la garantía
    // equivalente — ver la nota de concordancia del plan).
    expect(api.list, 'el listado se recargó tras el borrado').toHaveBeenCalledTimes(1);
    expect(router.navigate, 'se navegó fuera del listado').not.toHaveBeenCalled();
  });
});
