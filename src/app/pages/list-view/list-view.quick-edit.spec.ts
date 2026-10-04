import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../../core/services/api.service';
import { categoriesSchema } from '../../schemas/categories.schema';
import { productsSchema } from '../../schemas/products.schema';
import { ListView } from './list-view';

/**
 * Edición rápida en drawer (plan 6.5, guía §5).
 *
 * El atajo sólo aparece si el schema lo declara: no se adivina qué campos
 * editar. `categories` declara dos; `products` no declara ninguno.
 */
describe('ListView — edición rápida', () => {
  async function create(schema: typeof categoriesSchema) {
    await TestBed.configureTestingModule({
      imports: [ListView],
      providers: [
        provideRouter([]),
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        {
          provide: ApiService,
          useValue: {
            list: vi.fn(() => of([{ slug: 'una', name: 'Una', active: true }])),
            get: vi.fn(() => of({ slug: 'una', name: 'Una', active: true })),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ListView);
    fixture.componentRef.setInput('schema', schema);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const buttonWith = (fixture: { nativeElement: HTMLElement }, text: string): HTMLElement | null =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(text),
    ) ?? null;

  it('ofrece el atajo cuando el schema declara quickEdit', async () => {
    const fixture = await create(categoriesSchema);

    const trigger = buttonWith(fixture, 'Edición rápida');
    expect(trigger).not.toBeNull();

    trigger!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog, 'el drawer debería abrirse').not.toBeNull();
    // Sólo los campos declarados en `quickEdit` (name y active)
    expect(dialog.querySelectorAll('app-field-host')).toHaveLength(2);
  });

  it('no ofrece el atajo si el schema no lo declara', async () => {
    const fixture = await create(productsSchema);

    expect(buttonWith(fixture, 'Edición rápida')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });
});
